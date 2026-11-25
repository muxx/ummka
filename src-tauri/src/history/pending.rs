use super::{AccountHistory, ComposerDraft, HistoryError, PostRefusal, drafts};
use rusqlite::{Row, params};
use serde::{Deserialize, Serialize, Serializer};
use uuid::Uuid;

const JS_MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

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
        refusal,
        retry_refusal,
    })
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
        let root = drafts::root_key(channel, root)?;
        drafts::validate_revision(revision)?;
        let user_id = self.owner.account.user_id().to_owned();
        let generation = self.owner.generation;
        self.write(|tx| {
            let draft = drafts::draft(tx, channel, root)?;
            if draft.command_pending
                || draft.revision.as_deref() != Some(revision)
                || !has_text(&draft.message)
            {
                return Ok(StagePost::NotStaged { draft });
            }
            let pending_id = format!("{user_id}:{}", Uuid::new_v4());
            let post = tx.query_row(
                INSERT,
                params![pending_id, channel, root, draft.message, generation],
                post,
            )?;
            let draft = drafts::write_draft(tx, channel, root, "", Some(true), false)?;
            Ok(StagePost::Created { post, draft })
        })
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
            tx.prepare_cached(query)?
                .query_map(params![channel, root, bound, limit, generation], post)?
                .collect()
        })
    }
}

#[cfg(test)]
mod tests;
