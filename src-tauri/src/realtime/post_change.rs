use super::{EventConnectionError, ServerEvent, StreamError};
use crate::rest::is_mattermost_id;
use serde::{Deserialize, Serialize};

/// An authenticated invalidation of published history. Carries no server-controlled diagnostics.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPostChange {
    pub kind: PostChangeKind,
    pub channel_id: String,
    pub post_id: String,
    pub root_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PostChangeKind {
    Created,
    Edited,
    Deleted,
}

#[derive(Deserialize)]
struct Address {
    id: String,
    #[serde(default)]
    channel_id: String,
    #[serde(default)]
    root_id: String,
    #[serde(default, rename = "type")]
    post_type: String,
}

fn malformed() -> EventConnectionError {
    EventConnectionError::Protocol(StreamError::InvalidFrame)
}

impl ServerEvent {
    pub(super) fn decode_post<'a, T: Deserialize<'a>>(&'a self) -> Result<T, EventConnectionError> {
        let text = self
            .data
            .get("post")
            .and_then(|v| v.as_str())
            .ok_or_else(malformed)?;
        // Serde also accepts a positional array for a struct. The server sends an object.
        if !text.trim_start().starts_with('{') {
            return Err(malformed());
        }
        serde_json::from_str(text).map_err(|_| malformed())
    }

    pub(super) fn broadcast_address(&self, key: &str) -> Result<&str, EventConnectionError> {
        self.broadcast
            .get(key)
            .map_or(Ok(""), |v| v.as_str().ok_or_else(malformed))
    }

    pub fn channel_post_change(
        &self,
        account_user: &str,
    ) -> Result<Option<ChannelPostChange>, EventConnectionError> {
        let kind = match self.name.as_str() {
            "posted" => PostChangeKind::Created,
            "post_edited" => PostChangeKind::Edited,
            "post_deleted" => PostChangeKind::Deleted,
            _ => return Ok(None),
        };
        let channel = self.broadcast_address("channel_id")?;
        let recipient = self.broadcast_address("user_id")?;
        if !is_mattermost_id(account_user)
            || (!recipient.is_empty() && !is_mattermost_id(recipient))
        {
            return Err(malformed());
        }
        if !recipient.is_empty() && recipient != account_user {
            return Ok(None);
        }
        let post: Address = self.decode_post()?;
        if post.post_type == "system_ephemeral" {
            return Ok(None);
        }
        if (channel.is_empty() && recipient.is_empty())
            || (!channel.is_empty() && channel != post.channel_id)
            || !is_mattermost_id(&post.channel_id)
            || !is_mattermost_id(&post.id)
            || (!post.root_id.is_empty()
                && (!is_mattermost_id(&post.root_id) || post.root_id == post.id))
        {
            return Err(malformed());
        }
        Ok(Some(ChannelPostChange {
            kind,
            channel_id: post.channel_id,
            post_id: post.id,
            root_id: (!post.root_id.is_empty()).then_some(post.root_id),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const CHANNEL: &str = "cccccccccccccccccccccccccc";
    const USER: &str = "uuuuuuuuuuuuuuuuuuuuuuuuuu";
    const POST: &str = "pppppppppppppppppppppppppp";
    const ROOT: &str = "rrrrrrrrrrrrrrrrrrrrrrrrrr";
    fn frame(name: &str, post: Value, route: Value) -> ServerEvent {
        ServerEvent {
            name: name.into(),
            data: json!({"post":post.to_string()})
                .as_object()
                .unwrap()
                .clone(),
            broadcast: route.as_object().unwrap().clone(),
        }
    }

    #[test]
    fn all_three_events_expose_only_the_address_and_kind() {
        for (name, kind) in [
            ("posted", "created"),
            ("post_edited", "edited"),
            ("post_deleted", "deleted"),
        ] {
            for root in ["", ROOT] {
                let post = json!({"id":POST,"channel_id":CHANNEL,"root_id":root,"message":"private body","props":{"arbitrary":true}});
                let e = frame(name, post, json!({"channel_id":CHANNEL}));
                let value = serde_json::to_value(e.channel_post_change(USER).unwrap()).unwrap();
                assert_eq!(
                    value,
                    json!({"kind":kind,"channelId":CHANNEL,"postId":POST,"rootId":(!root.is_empty()).then_some(root)})
                );
            }
        }
    }

    #[test]
    fn distinguishes_personal_delivery_from_transient_posts() {
        let post = json!({"id":POST,"channel_id":CHANNEL});
        assert!(
            frame("posted", post.clone(), json!({"user_id":USER}))
                .channel_post_change(USER)
                .unwrap()
                .is_some()
        );
        assert!(
            frame("posted", post.clone(), json!({"user_id":ROOT}))
                .channel_post_change(USER)
                .unwrap()
                .is_none()
        );
        assert!(
            frame(
                "post_deleted",
                json!({"id":POST,"user_id":USER,"type":"system_ephemeral"}),
                json!({"user_id":USER})
            )
            .channel_post_change(USER)
            .unwrap()
            .is_none()
        );
        assert!(
            frame("ephemeral_message", Value::Null, json!({}))
                .channel_post_change(USER)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            frame("post_edited", post, json!({"channel_id":ROOT})).channel_post_change(USER),
            Err(malformed())
        );
    }

    #[test]
    fn rejects_malformed_published_addresses_before_application() {
        for (post, route) in [
            (
                json!({"id":"x","channel_id":CHANNEL}),
                json!({"channel_id":CHANNEL}),
            ),
            (
                json!({"id":POST,"channel_id":CHANNEL,"root_id":POST}),
                json!({"channel_id":CHANNEL}),
            ),
            (
                json!({"id":POST,"channel_id":CHANNEL,"root_id":"bad"}),
                json!({"channel_id":CHANNEL}),
            ),
            (json!({"id":POST,"channel_id":""}), json!({"user_id":USER})),
            (json!({"id":POST}), json!({"user_id":USER})),
            (json!({"id":POST,"channel_id":CHANNEL}), json!({})),
            (
                json!({"id":POST,"channel_id":CHANNEL}),
                json!({"channel_id":null}),
            ),
            (json!([POST, CHANNEL]), json!({"channel_id":CHANNEL})),
        ] {
            assert_eq!(
                frame("posted", post, route).channel_post_change(USER),
                Err(malformed())
            );
        }
    }
}
