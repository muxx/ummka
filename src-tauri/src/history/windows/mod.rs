use super::{HistoryError, PostChange, StoredPost};
use crate::rest::is_mattermost_id;
use serde::Deserialize;
use std::collections::HashSet;

mod order;
pub(super) mod read;
mod write;
pub(super) use order::move_post_time;
pub(super) use write::{forget_posts, record};

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WindowSource {
    Latest,
    Before { post_id: String },
    After { post_id: String },
    Focused { post_id: String },
    Since { since: i64 },
}

/// A normalized page from the channel reader. Extra posts can be absent from the visible order.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHistoryPage {
    pub channel_id: String,
    pub collapsed_threads: bool,
    pub source: WindowSource,
    pub order: Vec<String>,
    pub changes: Vec<PostChange>,
    pub prev_post_id: Option<String>,
    pub next_post_id: Option<String>,
    pub first_inaccessible_post_time: Option<i64>,
}

impl ChannelHistoryPage {
    pub(super) fn validate(&self, channel: &str) -> Result<(), HistoryError> {
        if self.channel_id != channel
            || self
                .first_inaccessible_post_time
                .is_some_and(|time| time < 0)
            || [&self.next_post_id, &self.prev_post_id]
                .into_iter()
                .flatten()
                .any(|id| !id.is_empty() && !is_mattermost_id(id))
        {
            return Err(HistoryError::InvalidPost);
        }
        let entries: HashSet<&str> = self
            .changes
            .iter()
            .map(|c| match c {
                PostChange::Save(p) => p.id.as_str(),
                PostChange::Remove { id, .. } => id.as_str(),
            })
            .collect();
        let mut seen = HashSet::with_capacity(self.order.len());
        if self
            .order
            .iter()
            .any(|id| !entries.contains(id.as_str()) || !seen.insert(id))
        {
            return Err(HistoryError::InvalidPost);
        }
        let nonempty = |id: &Option<String>| id.as_deref().is_some_and(|value| !value.is_empty());
        if self.order.is_empty() {
            // The server echoes the anchor on the near side of an empty neighbor response.
            let invalid_edge = match self.source {
                WindowSource::Latest => {
                    nonempty(&self.prev_post_id) || nonempty(&self.next_post_id)
                }
                WindowSource::Before { .. } => nonempty(&self.prev_post_id),
                WindowSource::After { .. } => nonempty(&self.next_post_id),
                _ => false,
            };
            if invalid_edge {
                return Err(HistoryError::InvalidPost);
            }
        }
        match &self.source {
            WindowSource::Before { post_id }
                if self
                    .next_post_id
                    .as_ref()
                    .is_some_and(|next| next != post_id) =>
            {
                Err(HistoryError::InvalidPost)
            }
            WindowSource::After { post_id }
                if self
                    .prev_post_id
                    .as_ref()
                    .is_some_and(|previous| previous != post_id) =>
            {
                Err(HistoryError::InvalidPost)
            }
            WindowSource::Since { since } if *since <= 0 => Err(HistoryError::InvalidPost),
            WindowSource::Before { post_id } | WindowSource::After { post_id }
                if !is_mattermost_id(post_id) || seen.contains(post_id) =>
            {
                Err(HistoryError::InvalidPost)
            }
            WindowSource::Focused { post_id }
                if !is_mattermost_id(post_id)
                    || !(seen.contains(post_id)
                        || (self.order.is_empty()
                            && self.first_inaccessible_post_time.unwrap_or(0) > 0)) =>
            {
                Err(HistoryError::InvalidPost)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum WindowEdge {
    Unknown,
    End,
    More(String),
}

impl From<Option<String>> for WindowEdge {
    fn from(id: Option<String>) -> Self {
        match id {
            None => Self::Unknown,
            Some(id) if id.is_empty() => Self::End,
            Some(id) => Self::More(id),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct WindowSlice {
    pub posts: Vec<StoredPost>,
    pub newer: WindowEdge,
    pub older: WindowEdge,
    pub first_inaccessible_post_time: i64,
}
