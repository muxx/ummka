use super::{AccountHistory, HistoryError, StoredPost};
use crate::rest::is_mattermost_id;
use rusqlite::{Transaction, params};

/// The authenticated response belongs to one request. An unsolicited posted event needs its own key.
pub enum DeliverySource<'a> {
    Response { request_pending_id: &'a str },
    Posted,
}

const ATTACH: &str = "INSERT INTO post_confirmation(pending_id,post_id)
    SELECT pending_id,?2 FROM pending_post WHERE pending_id=?1 AND channel_id=?3 AND root_id=?4
    ON CONFLICT DO NOTHING";
const MATCHED: &str =
    "SELECT EXISTS(SELECT 1 FROM post_confirmation JOIN pending_post USING(pending_id)
    WHERE pending_id=?1 AND post_id=?2 AND channel_id=?3 AND root_id=?4)";
const RETIRE: &str = "DELETE FROM pending_post WHERE pending_id=(
    SELECT c.pending_id FROM post_confirmation c
    JOIN pending_post p ON p.pending_id=c.pending_id
    JOIN history_post h ON h.id=c.post_id
    WHERE c.post_id=?1 AND h.user_id=?2 AND h.channel_id=p.channel_id AND COALESCE(h.root_id,'')=p.root_id)";
const REMOVED: &str = "DELETE FROM pending_post WHERE channel_id=?1 AND pending_id IN (
    SELECT pending_id FROM post_confirmation WHERE post_id=?2
    UNION ALL
    SELECT pending_id FROM pending_post JOIN post_confirmation USING(pending_id)
    WHERE channel_id=?1 AND root_id=?2)";

impl AccountHistory {
    /// Attaches the first authoritative server post ID. Independent posts enter history by their own IDs.
    pub fn confirm_delivery(
        &mut self,
        source: DeliverySource<'_>,
        wire_pending_id: Option<&str>,
        post: &StoredPost,
    ) -> Result<bool, HistoryError> {
        if post.user_id != self.owner.account.user_id()
            || !is_mattermost_id(&post.id)
            || !is_mattermost_id(&post.channel_id)
            || post
                .root_id
                .as_deref()
                .is_some_and(|id| !is_mattermost_id(id) || id == post.id)
        {
            return Ok(false);
        }
        let pending_id = match source {
            DeliverySource::Response { request_pending_id } => {
                if wire_pending_id.is_some_and(|actual| actual != request_pending_id) {
                    return Ok(false);
                }
                request_pending_id
            }
            DeliverySource::Posted => {
                let Some(id) = wire_pending_id else {
                    return Ok(false);
                };
                id
            }
        };
        self.write(|tx| {
            let key = params![
                pending_id,
                post.id,
                post.channel_id,
                post.root_id.as_deref().unwrap_or("")
            ];
            tx.execute(ATTACH, key)?;
            tx.query_row(MATCHED, key, |row| row.get(0))
        })
    }

    /// Retire a visible batch only after its canonical identities have reached local history.
    pub fn retire_delivered_posts(&mut self, post_ids: &[&str]) -> Result<usize, HistoryError> {
        let author = self.owner.account.user_id().to_owned();
        self.write(|tx| {
            let mut remove = tx.prepare_cached(RETIRE)?;
            let mut retired = 0;
            for id in post_ids {
                retired += remove.execute(params![id, author])?;
            }
            Ok(retired)
        })
    }
}

pub(super) fn remove_confirmed(
    tx: &Transaction<'_>,
    channel: &str,
    id: &str,
) -> rusqlite::Result<()> {
    tx.execute(REMOVED, [channel, id])?;
    Ok(())
}

#[cfg(test)]
mod tests;
