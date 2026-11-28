use super::{AccountHistory, ComposerDraft, HistoryError, PostRefusal, departure, drafts};
use crate::rest::{file_upload::UploadedFile, is_mattermost_id};
use rusqlite::{Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize, Serializer};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const JS_MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;
const MAX_FILES: usize = 10;

#[derive(Deserialize)]
#[serde(untagged)]
pub enum PendingCursor {
    Number(i64),
    Decimal(String),
}

impl PendingCursor {
    pub fn sequence(self) -> Result<i64, HistoryError> {
        match self {
            Self::Number(n) if (0..=JS_MAX_SAFE_INTEGER).contains(&n) => Ok(n),
            Self::Decimal(value) => value
                .parse::<i64>()
                .ok()
                .filter(|n| *n >= 0 && n.to_string() == value)
                .ok_or(HistoryError::InvalidDraft),
            Self::Number(_) => Err(HistoryError::InvalidDraft),
        }
    }
}

fn serialize_sequence<S: Serializer>(sequence: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    if (0..=JS_MAX_SAFE_INTEGER).contains(sequence) {
        serializer.serialize_i64(*sequence)
    } else {
        serializer.collect_str(sequence)
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PendingPostFile {
    pub id: String,
    pub name: String,
    pub size: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPost {
    #[serde(serialize_with = "serialize_sequence")]
    pub sequence: i64,
    pub pending_id: String,
    pub channel_id: String,
    pub root_id: Option<String>,
    pub message: String,
    pub created_at: i64,
    pub previous_login: bool,
    pub confirmed_post_id: Option<String>,
    pub attempt: u32,
    pub files: Vec<PendingPostFile>,
    pub refusal: Option<Box<PostRefusal>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_refusal: Option<Box<PostRefusal>>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StagePost {
    Created {
        post: PendingPost,
        draft: ComposerDraft,
    },
    NotStaged {
        draft: ComposerDraft,
    },
}

macro_rules! pending_list {
    ($range:literal) => {
        concat!("SELECT sequence,pending_id,channel_id,NULLIF(root_id,''),message,created_at,login_generation<>?5,post_id,
        COALESCE(attempt,1),CASE WHEN post_id IS NULL THEN refusal_status END,refusal_code,refusal_message,COALESCE(prior_uncertain,0)
    FROM pending_post LEFT JOIN post_confirmation USING(pending_id) LEFT JOIN post_attempt USING(pending_id)
        WHERE channel_id=?1 AND root_id=?2 AND ", $range, " LIMIT ?4")
    };
}
const LIST: &str = pending_list!("sequence>?3 ORDER BY sequence");
const RECENT: &str = pending_list!("sequence<=?3 ORDER BY sequence DESC");
const INSERT: &str = "INSERT INTO pending_post(pending_id,channel_id,root_id,message,login_generation)
    VALUES (?1,?2,?3,?4,?5) RETURNING sequence,pending_id,channel_id,NULLIF(root_id,''),message,created_at,0,NULL,1,NULL,NULL,NULL,0";
const INSERT_FILE: &str = "INSERT INTO pending_post_file(pending_id,position,file_id,name,size)
    VALUES (?1,?2,?3,?4,?5)";
pub(super) const FILES_FOR_PAGE: &str = "SELECT pending_id,file_id,name,size FROM pending_post_file
    WHERE pending_id IN (SELECT value FROM json_each(?1)) ORDER BY pending_id,position";

pub(super) fn post(row: &Row<'_>) -> rusqlite::Result<PendingPost> {
    let refusal = match row.get(9)? {
        Some(status) => Some(Box::new(PostRefusal {
            status,
            code: row.get(10)?,
            message: row.get(11)?,
        })),
        None => None,
    };
    let (refusal, retry_refusal) = if row.get::<_, bool>(12)? {
        (None, refusal)
    } else {
        (refusal, None)
    };
    Ok(PendingPost {
        sequence: row.get(0)?,
        pending_id: row.get(1)?,
        channel_id: row.get(2)?,
        root_id: row.get(3)?,
        message: row.get(4)?,
        created_at: row.get(5)?,
        previous_login: row.get(6)?,
        confirmed_post_id: row.get(7)?,
        attempt: row.get(8)?,
        files: Vec::new(),
        refusal,
        retry_refusal,
    })
}

pub(super) fn load_files(tx: &Transaction<'_>, posts: &mut [PendingPost]) -> rusqlite::Result<()> {
    if posts.is_empty() {
        return Ok(());
    }
    let mut by_id: HashMap<_, _> = posts
        .iter_mut()
        .map(|post| (post.pending_id.as_str(), &mut post.files))
        .collect();
    let ids = serde_json::json!(by_id.keys().collect::<Vec<_>>()).to_string();
    let mut query = tx.prepare_cached(FILES_FOR_PAGE)?;
    let mut rows = query.query([ids])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let files = by_id
            .get_mut(id.as_str())
            .ok_or(rusqlite::Error::InvalidQuery)?;
        files.push(PendingPostFile {
            id: row.get(1)?,
            name: row.get(2)?,
            size: row.get(3)?,
        });
    }
    Ok(())
}

/// Text-only posts use the official editor's JavaScript String.trim() semantics.
pub(super) fn has_text(message: &str) -> bool {
    message
        .chars()
        .any(|c| c != '\u{feff}' && (!c.is_whitespace() || c == '\u{0085}'))
}

impl AccountHistory {
    /// Only the caller that obtains Created can start the request. Reading the list is passive.
    pub fn stage_post(
        &mut self,
        channel: &str,
        root: Option<&str>,
        revision: &str,
    ) -> Result<StagePost, HistoryError> {
        self.stage_post_with_files(channel, root, Some(revision), &[])
    }

    /// Save the successful uploads for this draft in selection order.
    pub fn stage_post_with_files(
        &mut self,
        channel: &str,
        root: Option<&str>,
        revision: Option<&str>,
        files: &[UploadedFile],
    ) -> Result<StagePost, HistoryError> {
        self.stage_post_with_files_guarded(channel, root, revision, files, || Ok(()))
    }

    /// Ask the caller to claim the operation after the writer is acquired.
    /// Keep the claim alive until the transaction commits.
    pub(crate) fn stage_post_with_files_guarded<G>(
        &mut self,
        channel: &str,
        root: Option<&str>,
        revision: Option<&str>,
        files: &[UploadedFile],
        claim: impl FnOnce() -> Result<G, HistoryError>,
    ) -> Result<StagePost, HistoryError> {
        let root = drafts::root_key(channel, root)?;
        if let Some(revision) = revision {
            drafts::validate_revision(revision)?;
        }
        if files.len() > MAX_FILES {
            return Err(HistoryError::InvalidPost);
        }
        let mut seen = HashSet::with_capacity(files.len());
        let files = files
            .iter()
            .map(|file| {
                if !is_mattermost_id(&file.id) || !seen.insert(file.id.as_str()) {
                    return Err(HistoryError::InvalidPost);
                }
                Ok(PendingPostFile {
                    id: file.id.clone(),
                    name: file.name.clone(),
                    size: i64::try_from(file.size).map_err(|_| HistoryError::InvalidPost)?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let user_id = self.owner.account.user_id().to_owned();
        let generation = self.owner.generation;
        let (staged, _claim) =
            self.database
                .access(&self.owner, TransactionBehavior::Immediate, |tx| {
                    let claim = claim()?;
                    let draft = drafts::draft(tx, channel, root)?;
                    if draft.command_pending
                        || draft.revision.as_deref() != revision
                        || (files.is_empty() && !has_text(&draft.message))
                        || (!files.is_empty() && departure::is_departed(tx, channel)?)
                    {
                        return Ok((StagePost::NotStaged { draft }, claim));
                    }
                    let pending_id = format!("{user_id}:{}", Uuid::new_v4());
                    let mut post = tx.query_row(
                        INSERT,
                        params![pending_id, channel, root, draft.message, generation],
                        post,
                    )?;
                    if !files.is_empty() {
                        let mut store = tx.prepare_cached(INSERT_FILE)?;
                        for (position, file) in (0_i64..).zip(&files) {
                            store.execute(params![
                                pending_id, position, file.id, file.name, file.size
                            ])?;
                        }
                    }
                    post.files = files;
                    let draft = drafts::write_draft(tx, channel, root, "", Some(true), false)?;
                    Ok((StagePost::Created { post, draft }, claim))
                })?;
        Ok(staged)
    }

    pub fn pending_posts(
        &mut self,
        channel: &str,
        root: Option<&str>,
        after: i64,
        limit: u8,
    ) -> Result<Vec<PendingPost>, HistoryError> {
        self.pending_page(channel, root, LIST, after, limit)
    }

    pub fn recent_pending_posts(
        &mut self,
        channel: &str,
        root: Option<&str>,
        before: Option<i64>,
        limit: u8,
    ) -> Result<Vec<PendingPost>, HistoryError> {
        let upper = match before {
            None => i64::MAX,
            Some(sequence) if sequence > 0 => sequence - 1,
            Some(_) => return Err(HistoryError::InvalidDraft),
        };
        self.pending_page(channel, root, RECENT, upper, limit)
    }

    fn pending_page(
        &mut self,
        channel: &str,
        root: Option<&str>,
        query: &str,
        bound: i64,
        limit: u8,
    ) -> Result<Vec<PendingPost>, HistoryError> {
        let root = drafts::root_key(channel, root)?;
        if bound < 0 || limit == 0 {
            return Err(HistoryError::InvalidDraft);
        }
        let generation = self.owner.generation;
        self.read(|tx| {
            let mut posts = tx
                .prepare_cached(query)?
                .query_map(params![channel, root, bound, limit, generation], post)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            load_files(tx, &mut posts)?;
            Ok(posts)
        })
    }
}

#[cfg(test)]
mod tests;
