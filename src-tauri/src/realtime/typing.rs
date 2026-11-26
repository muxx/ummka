use super::{ServerEvent, StreamError};
use crate::rest::is_mattermost_id;
use serde_json::Value;

#[derive(Debug, Eq, PartialEq)]
pub struct TypingEvent<'a> {
    pub channel_id: &'a str,
    pub user_id: &'a str,
    pub root_id: Option<&'a str>,
}

impl ServerEvent {
    pub fn typing(&self) -> Result<Option<TypingEvent<'_>>, StreamError> {
        if self.name != "typing" {
            return Ok(None);
        }
        fn id(value: Option<&Value>) -> Result<&str, StreamError> {
            value
                .and_then(Value::as_str)
                .filter(|s| is_mattermost_id(s))
                .ok_or(StreamError::InvalidFrame)
        }
        let parent = self
            .data
            .get("parent_id")
            .and_then(Value::as_str)
            .ok_or(StreamError::InvalidFrame)?;
        if !parent.is_empty() && !is_mattermost_id(parent) {
            return Err(StreamError::InvalidFrame);
        }
        Ok(Some(TypingEvent {
            channel_id: id(self.broadcast.get("channel_id"))?,
            user_id: id(self.data.get("user_id"))?,
            root_id: (!parent.is_empty()).then_some(parent),
        }))
    }
}
