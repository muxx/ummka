use super::{HistoryError, StoredPost};
use crate::rest::is_mattermost_id;
use rusqlite::{Row, Transaction, params, types::Type};
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub reply_count: i64,
    pub last_reply_at: i64,
    pub participant_ids: Option<Vec<String>>,
}

pub(super) const LAST_OBSERVATION: &str =
    "SELECT COALESCE(MAX(observation),0) FROM history_thread_summary";

impl ThreadSummary {
    pub(super) fn validate(&self) -> Result<(), HistoryError> {
        if self.reply_count < 0
            || self.last_reply_at < 0
            || self
                .participant_ids
                .iter()
                .flatten()
                .any(|id| !is_mattermost_id(id))
        {
            return Err(HistoryError::InvalidPost);
        }
        Ok(())
    }

    pub(super) fn from_row(row: &Row<'_>) -> rusqlite::Result<Option<Self>> {
        let Some(reply_count) = row.get(12)? else {
            return Ok(None);
        };
        let ids: Option<String> = row.get(14)?;
        let participant_ids = ids
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(14, Type::Text, Box::new(error))
            })?;
        Ok(Some(Self {
            reply_count,
            last_reply_at: row.get(13)?,
            participant_ids,
        }))
    }

    pub(super) fn store(
        &self,
        tx: &Transaction<'_>,
        post: &StoredPost,
        observed: i64,
    ) -> Result<(), HistoryError> {
        let participants = self
            .participant_ids
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| HistoryError::InvalidPost)?;
        // At equal server milliseconds only a request started after the stored change can replace it.
        tx.prepare_cached(
            "INSERT OR REPLACE INTO history_thread_summary
                (post_id, root_version, reply_count, last_reply_at, participant_ids)
             SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (
                SELECT 1 FROM history_thread_summary WHERE post_id=?1 AND
                (root_version>?2 OR (root_version=?2 AND (observation>?6 OR
                 (reply_count=?3 AND last_reply_at=?4 AND participant_ids IS ?5))))
             )",
        )?
        .execute(params![
            post.id,
            post.update_at,
            self.reply_count,
            self.last_reply_at,
            participants,
            observed
        ])?;
        Ok(())
    }
}
