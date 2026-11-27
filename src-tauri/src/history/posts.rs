use super::attachments::{self, PostAttachments};
use super::thread_summary::{LAST_OBSERVATION, ThreadSummary};
use super::{AccountHistory, ChannelHistoryPage, HistoryError, HistoryOwner, windows};
use crate::rest::is_mattermost_id;
use rusqlite::{
    OptionalExtension, Row, Transaction, TransactionBehavior, params,
    types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef},
};
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
    /// None is a legacy row or a read that did not confirm either origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_webhook: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_priority: Option<DisplayPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_attribution: Option<AiAttribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_summary: Option<Box<ThreadSummary>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) attachments: Option<Box<PostAttachments>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisplayPriority {
    Standard,
    Important,
    Urgent,
    Other,
}

impl FromSql for DisplayPriority {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "standard" => Ok(Self::Standard),
            "important" => Ok(Self::Important),
            "urgent" => Ok(Self::Urgent),
            "other" => Ok(Self::Other),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

impl ToSql for DisplayPriority {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Self::Standard => "standard",
            Self::Important => "important",
            Self::Urgent => "urgent",
            Self::Other => "other",
        }
        .into())
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AiAttribution {
    None,
    Source { user_id: String, has_username: bool },
}

impl AiAttribution {
    fn columns(&self) -> (&str, bool) {
        match self {
            Self::None => ("", false),
            Self::Source {
                user_id,
                has_username,
            } => (user_id, *has_username),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PostChange {
    Save(Box<StoredPost>),
    Remove { id: String, channel_id: String },
}

/// Obtained before dispatching a read. Carries no open SQLite transaction.
pub struct ChannelPostLoad {
    owner: HistoryOwner,
    channel_id: String,
    revision: i64,
    observed_summary: i64,
    observed_attachments: i64,
    priority_order: i64,
}

pub(crate) struct CachedPostObservation {
    load: ChannelPostLoad,
    post_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PostObservation {
    pub channel_id: String,
    pub update_at: i64,
    pub display_priority: Option<DisplayPriority>,
    pub ai_attribution: Option<AiAttribution>,
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
              s.reply_count, s.last_reply_at, s.participant_ids, a.payload, p.from_webhook,
              p.display_priority, p.ai_source, p.ai_has_username
       FROM history_post p LEFT JOIN history_thread_summary s ON s.post_id=p.id AND p.root_id IS NULL
       LEFT JOIN history_post_attachment a ON a.post_id=p.id
       WHERE p.id=?1";
pub(super) const REMOVE: &str =
    "DELETE FROM history_post WHERE channel_id = ?1 AND (id = ?2 OR root_id = ?2)";
const SAVE: &str = "INSERT INTO history_post
    (id, channel_id, user_id, root_id, create_at, update_at, edit_at, type, message, message_source, hashtags, is_pinned,
     from_webhook, display_priority, priority_observation, ai_source, ai_has_username)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, root_id=excluded.root_id,
    create_at=excluded.create_at, update_at=excluded.update_at, edit_at=excluded.edit_at,
    type=excluded.type, message=excluded.message, message_source=excluded.message_source,
    hashtags=excluded.hashtags, is_pinned=excluded.is_pinned,
    from_webhook=COALESCE(excluded.from_webhook,history_post.from_webhook),
    display_priority=COALESCE(excluded.display_priority,history_post.display_priority),
    priority_observation=COALESCE(excluded.priority_observation,history_post.priority_observation),
    ai_source=COALESCE(excluded.ai_source,history_post.ai_source),
    ai_has_username=COALESCE(excluded.ai_has_username,history_post.ai_has_username)";
const CONFIRM_OBSERVATIONS: &str = "UPDATE history_post SET
    from_webhook=COALESCE(from_webhook,?2),
    display_priority=CASE WHEN COALESCE(priority_observation,0) < ?4
                              THEN ?3 ELSE display_priority END,
    priority_observation=CASE WHEN COALESCE(priority_observation,0) < ?4
                              THEN ?4 ELSE priority_observation END,
    ai_source=COALESCE(ai_source,?5),
    ai_has_username=COALESCE(ai_has_username,?6)
    WHERE id=?1 AND channel_id=?7 AND update_at=?8 AND
      (COALESCE(priority_observation,0) < ?4 OR
       (from_webhook IS NULL AND ?2 IS NOT NULL) OR
       (ai_source IS NULL AND ?5 IS NOT NULL))";
const ADVANCE_PRIORITY_OBSERVATION: &str =
    "INSERT INTO history_post_observation(owner,priority) VALUES(1,1)
     ON CONFLICT(owner) DO UPDATE SET priority=history_post_observation.priority+1
     RETURNING priority";

struct PreviousPost {
    channel_id: String,
    update_at: i64,
    create_at: i64,
}

impl StoredPost {
    pub(super) fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let ai_attribution = match row.get::<_, Option<String>>(18)? {
            None => None,
            Some(id) if id.is_empty() => Some(AiAttribution::None),
            Some(user_id) => Some(AiAttribution::Source {
                user_id,
                has_username: row.get(19)?,
            }),
        };
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
            from_webhook: row.get(16)?,
            display_priority: row.get(17)?,
            ai_attribution,
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
                    || matches!(&post.ai_attribution, Some(AiAttribution::Source {user_id, ..}) if !is_mattermost_id(user_id))
                {
                    return Err(HistoryError::InvalidPost);
                }
                Ok((&post.id, &post.channel_id))
            }
            Self::Remove { id, channel_id } => Ok((id, channel_id)),
        }
    }
}

pub(super) fn advance_deletion_revision(
    tx: &Transaction<'_>,
    channel: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO history_channel_deletion (channel_id, revision) VALUES (?1, 1)
         ON CONFLICT(channel_id) DO UPDATE SET revision = revision + 1",
        [channel],
    )?;
    Ok(())
}

fn deletion_revision(tx: &Transaction<'_>, channel: &str) -> rusqlite::Result<i64> {
    tx.prepare("SELECT revision FROM history_channel_deletion WHERE channel_id = ?1")?
        .query_row([channel], |row| row.get(0))
        .optional()
        .map(Option::unwrap_or_default)
}

impl ChannelPostLoad {
    fn begin(
        tx: &Transaction<'_>,
        owner: HistoryOwner,
        channel_id: String,
    ) -> rusqlite::Result<Self> {
        Ok(Self {
            owner,
            revision: deletion_revision(tx, &channel_id)?,
            channel_id,
            observed_summary: tx.query_row(LAST_OBSERVATION, [], |row| row.get(0))?,
            observed_attachments: tx
                .query_row(attachments::LAST_OBSERVATION, [], |row| row.get(0))?,
            // Reserve before dispatch; responses may commit in either order.
            priority_order: tx
                .prepare_cached(ADVANCE_PRIORITY_OBSERVATION)?
                .query_row([], |row| row.get(0))?,
        })
    }

    fn is_current(&self, tx: &Transaction<'_>) -> rusqlite::Result<bool> {
        Ok(deletion_revision(tx, &self.channel_id)? == self.revision
            && !super::departure::is_departed(tx, &self.channel_id)?)
    }
}

impl AccountHistory {
    pub fn begin_channel_load(
        &mut self,
        channel_id: &str,
    ) -> Result<ChannelPostLoad, HistoryError> {
        if !is_mattermost_id(channel_id) {
            return Err(HistoryError::InvalidPost);
        }
        let owner = self.owner.clone();
        self.write(|tx| ChannelPostLoad::begin(tx, owner, channel_id.to_owned()))
    }

    pub(crate) fn begin_cached_post_observation(
        &mut self,
        post_id: String,
    ) -> Result<Option<CachedPostObservation>, HistoryError> {
        if !is_mattermost_id(&post_id) {
            return Err(HistoryError::InvalidPost);
        }
        let owner = self.owner.clone();
        self.write(|tx| {
            let channel = tx
                .prepare_cached("SELECT channel_id FROM history_post WHERE id=?1")?
                .query_row([&post_id], |row| row.get(0))
                .optional()?;
            channel
                .map(|channel_id| {
                    Ok(CachedPostObservation {
                        load: ChannelPostLoad::begin(tx, owner, channel_id)?,
                        post_id,
                    })
                })
                .transpose()
        })
    }

    pub(crate) fn observe_cached_post(
        &mut self,
        ticket: CachedPostObservation,
        observation: PostObservation,
    ) -> Result<bool, HistoryError> {
        let CachedPostObservation { load, post_id } = ticket;
        if load.owner != self.owner {
            return Err(HistoryError::StaleOwner);
        }
        let ai = observation.ai_attribution.as_ref();
        if observation.channel_id != load.channel_id
            || observation.update_at <= 0
            || matches!(ai, Some(AiAttribution::Source {user_id, ..}) if !is_mattermost_id(user_id))
        {
            return Err(HistoryError::InvalidPost);
        }
        self.write(|tx| {
            if !load.is_current(tx)? {
                return Ok(false);
            }
            // Point navigation may confirm current metadata. A page owns post versions and position.
            let (ai_source, ai_has_username) = ai.map(AiAttribution::columns).unzip();
            let count = tx.prepare_cached(CONFIRM_OBSERVATIONS)?.execute(params![
                post_id,
                None::<bool>,
                observation.display_priority,
                observation.display_priority.map(|_| load.priority_order),
                ai_source,
                ai_has_username,
                load.channel_id,
                observation.update_at,
            ])?;
            Ok(count != 0)
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
                if !load.is_current(tx)? {
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
                Ok(PreviousPost {
                    channel_id: r.get(0)?,
                    update_at: r.get(1)?,
                    create_at: r.get(2)?,
                })
            })
            .optional()?;
        if stored.as_ref().is_some_and(|row| row.channel_id != channel) {
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
                let old_version = stored.as_ref().map(|row| row.update_at);
                if old_version.is_some_and(|version| version > p.update_at) {
                    continue;
                }
                let newer = old_version != Some(p.update_at);
                let priority = p.display_priority;
                let stamp = priority.map(|_| load.priority_order);
                let (ai_source, ai_has_username) = p
                    .ai_attribution
                    .as_ref()
                    .map(AiAttribution::columns)
                    .unzip();
                if newer {
                    if stored
                        .as_ref()
                        .is_some_and(|row| row.create_at != p.create_at)
                    {
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
                        p.is_pinned,
                        p.from_webhook,
                        priority,
                        stamp,
                        ai_source,
                        ai_has_username,
                    ])?;
                } else if priority.is_some() || p.from_webhook.is_some() || ai_source.is_some() {
                    tx.prepare_cached(CONFIRM_OBSERVATIONS)?.execute(params![
                        id,
                        p.from_webhook,
                        priority,
                        stamp,
                        ai_source,
                        ai_has_username,
                        channel,
                        p.update_at,
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
        advance_deletion_revision(tx, channel)?;
    }
    Ok(removed)
}
