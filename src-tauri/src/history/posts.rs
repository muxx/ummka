use super::attachments::{self, PostAttachments};
use super::thread_summary::{LAST_OBSERVATION, ThreadSummary};
use super::{AccountHistory, ChannelHistoryPage, HistoryError, HistoryOwner, windows};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// The text and identifying fields stored for a channel post, independent of its timeline position.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPost {
    pub id: String,
    pub channel_id: String,
    pub user_id: String,
    pub root_id: Option<String>,
    pub create_at: i64,
    pub update_at: i64,
    pub edit_at: i64,
    #[serde(rename = "type")]
    pub post_type: String,
    pub message: String,
    pub message_source: Option<String>,
    pub hashtags: String,
    pub is_pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_summary: Option<Box<ThreadSummary>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) attachments: Option<Box<PostAttachments>>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PostChange {
    Save(StoredPost),
    Remove { id: String, channel_id: String },
}

/// Obtained before dispatching a read. Carries no open SQLite transaction.
pub struct ChannelPostLoad {
    owner: HistoryOwner,
    channel_id: String,
    revision: i64,
    observed_summary: i64,
    observed_attachments: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PageWrite {
    Applied,
    /// A removal was accepted in this channel since the load began. Retain the caller's cursor.
    Superseded,
    Inaccessible {
        first_inaccessible_post_time: i64,
    },
}

pub(super) const READ: &str =
     "SELECT p.id, p.channel_id, p.user_id, p.root_id, p.create_at, p.update_at, p.edit_at,
              p.type, p.message, p.message_source, p.hashtags, p.is_pinned,
              s.reply_count, s.last_reply_at, s.participant_ids, a.payload
       FROM history_post p LEFT JOIN history_thread_summary s ON s.post_id=p.id AND p.root_id IS NULL
       LEFT JOIN history_post_attachment a ON a.post_id=p.id
       WHERE p.id=?1";
pub(super) const REMOVE: &str =
    "DELETE FROM history_post WHERE channel_id = ?1 AND (id = ?2 OR root_id = ?2)";
const SAVE: &str = "INSERT INTO history_post
    (id, channel_id, user_id, root_id, create_at, update_at, edit_at, type, message, message_source, hashtags, is_pinned)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, root_id=excluded.root_id,
    create_at=excluded.create_at, update_at=excluded.update_at, edit_at=excluded.edit_at,
    type=excluded.type, message=excluded.message, message_source=excluded.message_source,
    hashtags=excluded.hashtags, is_pinned=excluded.is_pinned";

impl StoredPost {
    pub(super) fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            channel_id: row.get(1)?,
            user_id: row.get(2)?,
            root_id: row.get(3)?,
            create_at: row.get(4)?,
            update_at: row.get(5)?,
            edit_at: row.get(6)?,
            post_type: row.get(7)?,
            message: row.get(8)?,
            message_source: row.get(9)?,
            hashtags: row.get(10)?,
            is_pinned: row.get(11)?,
            thread_summary: ThreadSummary::from_row(row)?.map(Box::new),
            attachments: PostAttachments::from_row(row)?,
        })
    }
}

impl PostChange {
    fn identity(&self) -> Result<(&str, &str), HistoryError> {
        match self {
            Self::Save(post) => {
                if !is_mattermost_id(&post.user_id)
                    || post
                        .root_id
                        .as_deref()
                        .is_some_and(|id| !is_mattermost_id(id) || id == post.id)
                    || post.create_at <= 0
                    || post.update_at <= 0
                    || post.edit_at < 0
                {
                    return Err(HistoryError::InvalidPost);
                }
                Ok((&post.id, &post.channel_id))
            }
            Self::Remove { id, channel_id } => Ok((id, channel_id)),
        }
    }
}

fn deletion_revision(tx: &Transaction<'_>, channel: &str) -> rusqlite::Result<i64> {
    tx.prepare("SELECT revision FROM history_channel_deletion WHERE channel_id = ?1")?
        .query_row([channel], |row| row.get(0))
        .optional()
        .map(Option::unwrap_or_default)
}

impl AccountHistory {
    pub fn begin_channel_load(
        &mut self,
        channel_id: &str,
    ) -> Result<ChannelPostLoad, HistoryError> {
        if !is_mattermost_id(channel_id) {
            return Err(HistoryError::InvalidPost);
        }
        let (revision, observed_summary, observed_attachments) = self.read(|tx| {
            Ok((
                deletion_revision(tx, channel_id)?,
                tx.query_row(LAST_OBSERVATION, [], |row| row.get(0))?,
                tx.query_row(attachments::LAST_OBSERVATION, [], |row| row.get(0))?,
            ))
        })?;
        Ok(ChannelPostLoad {
            owner: self.owner.clone(),
            channel_id: channel_id.to_owned(),
            revision,
            observed_summary,
            observed_attachments,
        })
    }

    pub fn read_post(&mut self, id: &str) -> Result<Option<StoredPost>, HistoryError> {
        if !is_mattermost_id(id) {
            return Err(HistoryError::InvalidPost);
        }
        self.read(|tx| {
            tx.prepare(READ)?
                .query_row([id], StoredPost::from_row)
                .optional()
        })
    }

    pub fn apply_channel_page(
        &mut self,
        load: ChannelPostLoad,
        changes: &[PostChange],
    ) -> Result<PageWrite, HistoryError> {
        self.store_page(load, changes, None)
    }

    pub fn apply_channel_window(
        &mut self,
        load: ChannelPostLoad,
        page: &ChannelHistoryPage,
    ) -> Result<PageWrite, HistoryError> {
        self.store_page(load, &page.changes, Some(page))
    }

    fn store_page(
        &mut self,
        load: ChannelPostLoad,
        changes: &[PostChange],
        page: Option<&ChannelHistoryPage>,
    ) -> Result<PageWrite, HistoryError> {
        if load.owner != self.owner {
            return Err(HistoryError::StaleOwner);
        }
        self.database
            .access(&self.owner, TransactionBehavior::Immediate, |tx| {
                if deletion_revision(tx, &load.channel_id)? != load.revision {
                    return Ok(PageWrite::Superseded);
                }
                let removed = write_changes(
                    tx,
                    &load,
                    changes,
                    page.is_some_and(|page| page.collapsed_threads),
                )?;
                if let Some(page) = page {
                    page.validate(&load.channel_id)?;
                    return windows::record(tx, page, &removed);
                }
                Ok(PageWrite::Applied)
            })
    }
}

fn write_changes(
    tx: &Transaction<'_>,
    load: &ChannelPostLoad,
    changes: &[PostChange],
    collapsed: bool,
) -> Result<HashSet<String>, HistoryError> {
    let channel = load.channel_id.as_str();
    let mut previous = tx.prepare_cached(
        "SELECT channel_id, update_at, create_at FROM history_post WHERE id = ?1",
    )?;
    let mut save = tx.prepare_cached(SAVE)?;
    let mut ids = HashSet::with_capacity(changes.len());
    let mut removals = Vec::new();
    for change in changes {
        let (id, incoming_channel) = change.identity()?;
        if incoming_channel != channel || !is_mattermost_id(id) || !ids.insert(id) {
            return Err(HistoryError::InvalidPost);
        }
        let stored = previous
            .query_row([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .optional()?;
        if stored
            .as_ref()
            .is_some_and(|(old_channel, _, _)| old_channel != channel)
        {
            return Err(HistoryError::InvalidPost);
        }
        match change {
            PostChange::Save(p) => {
                if let Some(summary) = &p.thread_summary {
                    if !collapsed || p.root_id.is_some() {
                        return Err(HistoryError::InvalidPost);
                    }
                    summary.validate()?;
                }
                if let Some(attachments) = &p.attachments {
                    attachments.validate()?;
                }
                let old_version = stored.as_ref().map(|(_, version, _)| *version);
                if old_version.is_some_and(|version| version > p.update_at) {
                    continue;
                }
                if old_version != Some(p.update_at) {
                    if stored.is_some_and(|(_, _, created)| created != p.create_at) {
                        windows::move_post_time(tx, id, p.create_at)?;
                    }
                    save.execute(params![
                        p.id,
                        p.channel_id,
                        p.user_id,
                        p.root_id,
                        p.create_at,
                        p.update_at,
                        p.edit_at,
                        p.post_type,
                        p.message,
                        p.message_source,
                        p.hashtags,
                        p.is_pinned
                    ])?;
                }
                attachments::store(tx, p, load.observed_attachments)?;
                if let Some(summary) = &p.thread_summary {
                    summary.store(tx, p, load.observed_summary)?;
                }
            }
            PostChange::Remove { .. } => removals.push(id),
        }
    }
    let mut removed = HashSet::new();
    if !removals.is_empty() {
        // Remember affected IDs only for this transaction, including replies to a deleted root.
        let mut affected = tx.prepare_cached(
            "SELECT id FROM history_post WHERE channel_id = ?1 AND (id = ?2 OR root_id = ?2)",
        )?;
        let mut remove = tx.prepare_cached(REMOVE)?;
        for &id in &removals {
            removed.insert(id.to_owned());
            for affected_id in affected.query_map(params![channel, id], |r| r.get(0))? {
                removed.insert(affected_id?);
            }
        }
        windows::forget_posts(tx, channel, &removed)?;
        for id in removals {
            remove.execute(params![channel, id])?;
            super::confirmation::remove_confirmed(tx, channel, id)?;
        }
        tx.execute(
            "INSERT INTO history_channel_deletion (channel_id, revision) VALUES (?1, 1)
            ON CONFLICT(channel_id) DO UPDATE SET revision = revision + 1",
            [channel],
        )?;
    }
    Ok(removed)
}
