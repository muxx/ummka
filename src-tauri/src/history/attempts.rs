use super::{AccountHistory, HistoryError};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostRefusal {
    pub status: u16,
    pub code: String,
    pub message: Option<String>,
}

const REFUSE: &str = "INSERT INTO post_attempt(pending_id,attempt,refusal_status,refusal_code,refusal_message)
    SELECT p.pending_id,?2,?4,?5,?6 FROM pending_post p LEFT JOIN post_attempt a USING(pending_id)
    WHERE p.pending_id=?1 AND p.login_generation=?3 AND COALESCE(a.attempt,1)=?2 AND COALESCE(a.prior_uncertain,0)=0
      AND NOT EXISTS(SELECT 1 FROM post_confirmation WHERE pending_id=p.pending_id)
      AND (a.refusal_status IS NULL OR (a.refusal_status=?4 AND a.refusal_code=?5 AND a.refusal_message IS ?6))
    ON CONFLICT(pending_id) DO UPDATE SET refusal_status=excluded.refusal_status,
        refusal_code=excluded.refusal_code,refusal_message=excluded.refusal_message";

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
}

#[cfg(test)]
mod tests;
