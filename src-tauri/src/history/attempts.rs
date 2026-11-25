use super::{AccountHistory, HistoryError, PendingPost, pending};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostRefusal {
    pub status: u16,
    pub code: String,
    pub message: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RetryPost {
    AfterRefusal { message: String },
    DespiteUnknownDelivery,
}

const REFUSE: &str = "INSERT INTO post_attempt(pending_id,attempt,refusal_status,refusal_code,refusal_message)
    SELECT p.pending_id,?2,?4,?5,?6 FROM pending_post p LEFT JOIN post_attempt a USING(pending_id)
    WHERE p.pending_id=?1 AND p.login_generation=?3 AND COALESCE(a.attempt,1)=?2 AND COALESCE(a.prior_uncertain,0)=0
      AND NOT EXISTS(SELECT 1 FROM post_confirmation WHERE pending_id=p.pending_id)
      AND (a.refusal_status IS NULL OR (a.refusal_status=?4 AND a.refusal_code=?5 AND a.refusal_message IS ?6))
    ON CONFLICT(pending_id) DO UPDATE SET refusal_status=excluded.refusal_status,
        refusal_code=excluded.refusal_code,refusal_message=excluded.refusal_message";

// An implicit first attempt has no post_attempt row. Once reserved, a retry always has one.
const RESERVE_RETRY: &str = "INSERT INTO post_attempt(pending_id,attempt,prior_uncertain)
    SELECT p.pending_id,?3,?5 FROM pending_post p LEFT JOIN post_attempt a USING(pending_id)
    WHERE p.pending_id=?1 AND COALESCE(a.attempt,1)=?2 AND p.login_generation=?4
      AND (a.refusal_status IS NULL)=?5 AND NOT EXISTS(SELECT 1 FROM post_confirmation WHERE pending_id=p.pending_id)
    ON CONFLICT(pending_id) DO UPDATE SET attempt=excluded.attempt,prior_uncertain=excluded.prior_uncertain,
        refusal_status=NULL,refusal_code=NULL,refusal_message=NULL";
const RETRY_POST: &str = "UPDATE pending_post SET message=COALESCE(?2,message) WHERE pending_id=?1
    RETURNING sequence,pending_id,channel_id,NULLIF(root_id,''),message,created_at,0,NULL,?3,NULL,NULL,NULL";
const DISMISS: &str = "DELETE FROM pending_post WHERE pending_id=?1
    AND COALESCE((SELECT attempt FROM post_attempt WHERE pending_id=?1),1)=?2
    AND NOT EXISTS(SELECT 1 FROM post_confirmation WHERE pending_id=?1)";

impl AccountHistory {
    /// An explicit refusal of this request cannot settle an earlier missing response.
    pub fn record_post_refusal(
        &mut self,
        pending_id: &str,
        attempt: u32,
        refusal: &PostRefusal,
    ) -> Result<bool, HistoryError> {
        if attempt == 0
            || !(400..500).contains(&refusal.status)
            || refusal.status == 401
            || refusal.code.trim().is_empty()
        {
            return Err(HistoryError::InvalidPost);
        }
        let generation = self.owner.generation;
        self.write(|tx| {
            Ok(tx.execute(
                REFUSE,
                params![
                    pending_id,
                    attempt,
                    generation,
                    refusal.status,
                    refusal.code,
                    refusal.message
                ],
            )? == 1)
        })
    }

    /// The updated attempt can be sent only by the caller that reserved it in this transaction.
    pub fn retry_post(
        &mut self,
        pending_id: &str,
        expected: u32,
        choice: RetryPost,
    ) -> Result<Option<PendingPost>, HistoryError> {
        if expected == 0 {
            return Err(HistoryError::InvalidPost);
        }
        let next = expected.checked_add(1).ok_or(HistoryError::InvalidPost)?;
        let edited = match &choice {
            RetryPost::AfterRefusal { message } if pending::has_text(message) => {
                Some(message.as_str())
            }
            RetryPost::AfterRefusal { .. } => return Err(HistoryError::InvalidDraft),
            RetryPost::DespiteUnknownDelivery => None,
        };
        let generation = self.owner.generation;
        self.write(|tx| {
            if tx.execute(
                RESERVE_RETRY,
                params![pending_id, expected, next, generation, edited.is_none()],
            )? == 0
            {
                return Ok(None);
            }
            tx.query_row(RETRY_POST, params![pending_id, edited, next], pending::post)
                .map(Some)
        })
    }

    /// Forget a local row. A later confirmation or retry may already have superseded this choice.
    pub fn dismiss_pending_post(
        &mut self,
        pending_id: &str,
        expected: u32,
    ) -> Result<bool, HistoryError> {
        if expected == 0 {
            return Err(HistoryError::InvalidPost);
        }
        self.write(|tx| Ok(tx.execute(DISMISS, params![pending_id, expected])? == 1))
    }
}

#[cfg(test)]
mod tests;
