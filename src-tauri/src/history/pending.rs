use super::{AccountHistory, ComposerDraft, HistoryError, PostRefusal, drafts};
use rusqlite::{Row, params};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPost {
    pub sequence: i64,
    pub pending_id: String,
    pub channel_id: String,
    pub root_id: Option<String>,
    pub message: String,
    pub created_at: i64,
    pub previous_login: bool,
    pub confirmed_post_id: Option<String>,
    pub attempt: u32,
    pub refusal: Option<PostRefusal>,
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

const LIST: &str = "SELECT sequence,pending_id,channel_id,NULLIF(root_id,''),message,created_at,login_generation<>?5,post_id,
        COALESCE(attempt,1),CASE WHEN post_id IS NULL THEN refusal_status END,refusal_code,refusal_message
    FROM pending_post LEFT JOIN post_confirmation USING(pending_id) LEFT JOIN post_attempt USING(pending_id)
    WHERE channel_id=?1 AND root_id=?2 AND sequence>?3 ORDER BY sequence LIMIT ?4";
const INSERT: &str = "INSERT INTO pending_post(pending_id,channel_id,root_id,message,login_generation)
    VALUES (?1,?2,?3,?4,?5) RETURNING sequence,pending_id,channel_id,NULLIF(root_id,''),message,created_at,0,NULL,1,NULL,NULL,NULL";

fn post(row: &Row<'_>) -> rusqlite::Result<PendingPost> {
    let refusal = match row.get(9)? {
        Some(status) => Some(PostRefusal {
            status,
            code: row.get(10)?,
            message: row.get(11)?,
        }),
        None => None,
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
    })
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
            // Match the official editor's JavaScript String.trim() for text-only posts.
            let blank = draft
                .message
                .chars()
                .all(|c| c == '\u{feff}' || (c.is_whitespace() && c != '\u{0085}'));
            if draft.revision.as_deref() != Some(revision) || blank {
                return Ok(StagePost::NotStaged { draft });
            }
            let pending_id = format!("{user_id}:{}", Uuid::new_v4());
            let post = tx.query_row(
                INSERT,
                params![pending_id, channel, root, draft.message, generation],
                post,
            )?;
            let draft = drafts::write_draft(tx, channel, root, "")?;
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
        let root = drafts::root_key(channel, root)?;
        if after < 0 || limit == 0 {
            return Err(HistoryError::InvalidDraft);
        }
        let generation = self.owner.generation;
        self.read(|tx| {
            tx.prepare_cached(LIST)?
                .query_map(params![channel, root, after, limit, generation], post)?
                .collect()
        })
    }
}

#[cfg(test)]
mod tests;
