use super::{EventConnectionError, ServerEvent};
use crate::history::{AccountHistory, DeliveryPost, DeliverySource};
use serde::Deserialize;

#[derive(Deserialize)]
struct Posted {
    id: String,
    user_id: String,
    channel_id: String,
    #[serde(default)]
    root_id: String,
    #[serde(default)]
    pending_post_id: String,
    #[serde(default)]
    delete_at: i64,
}

impl ServerEvent {
    /// Match a receipt against the history opened for this stream's login.
    /// A match includes replays. The caller owns the shared stream checkpoint.
    pub fn confirm_delivery(
        &self,
        history: &mut AccountHistory,
    ) -> Result<bool, EventConnectionError> {
        if self.name != "posted" {
            return Ok(false);
        }
        let post: Posted = self.decode_post()?;
        let channel = self.broadcast_address("channel_id")?;
        let recipient = self.broadcast_address("user_id")?;
        if post.pending_post_id.is_empty()
            || post.delete_at != 0
            || (channel.is_empty() && recipient.is_empty())
            || (!channel.is_empty() && channel != post.channel_id)
            || (!recipient.is_empty() && recipient != post.user_id)
        {
            return Ok(false);
        }
        history
            .confirm_delivery(
                DeliverySource::Posted,
                Some(&post.pending_post_id),
                &DeliveryPost {
                    id: post.id,
                    user_id: post.user_id,
                    channel_id: post.channel_id,
                    root_id: (!post.root_id.is_empty()).then_some(post.root_id),
                },
            )
            .map_err(EventConnectionError::History)
    }
}
