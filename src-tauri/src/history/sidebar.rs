use super::{AccountHistory, HistoryError, HistoryOwner};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SidebarChannel {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub display_name: String,
    pub header: String,
    pub purpose: String,
    pub create_at: Option<i64>,
    pub delete_at: i64,
    pub last_post_at: Option<i64>,
    pub last_root_post_at: Option<i64>,
    pub total_msg_count: Option<i64>,
    pub total_msg_count_root: Option<i64>,
    pub last_viewed_at: Option<i64>,
    pub msg_count: Option<i64>,
    pub msg_count_root: Option<i64>,
    pub mention_count: Option<i64>,
    pub mention_count_root: Option<i64>,
    pub urgent_mention_count: Option<i64>,
    pub muted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roles: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_constrained: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SidebarCategory {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    pub sorting: String,
    pub collapsed: bool,
    pub muted: bool,
    pub channel_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SidebarData {
    pub channels: Vec<SidebarChannel>,
    pub categories: Vec<SidebarCategory>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSnapshot {
    pub data: SidebarData,
    pub selected_channel: Option<String>,
}

pub struct SidebarLoad {
    owner: HistoryOwner,
    team: String,
    id: [u8; 16],
}

const READ_CHANNELS: &str = "SELECT channel_id, kind, name, display_name, header, purpose, delete_at,
    last_post_at, last_root_post_at, total_msg_count, total_msg_count_root, last_viewed_at, msg_count,
    msg_count_root, mention_count, mention_count_root, urgent_mention_count, muted, create_at, roles, shared, group_constrained FROM sidebar_channel
    WHERE team_id = ?1 ORDER BY position";
const READ_CATEGORIES: &str =
    "SELECT category_id, kind, display_name, sorting, collapsed, muted FROM sidebar_category
    WHERE team_id = ?1 ORDER BY position";
const READ_ITEMS: &str = "SELECT category_position, channel_id FROM sidebar_item
    WHERE team_id = ?1 ORDER BY category_position, position";
const KNOWN_CHANNEL: &str =
    "SELECT EXISTS(SELECT 1 FROM sidebar_channel WHERE team_id = ?1 AND channel_id = ?2)";

impl SidebarData {
    fn valid(&self) -> bool {
        let mut channels = HashSet::with_capacity(self.channels.len());
        let mut categories = HashSet::with_capacity(self.categories.len());
        self.channels.iter().all(|c| {
            is_mattermost_id(&c.id)
                && channels.insert(c.id.as_str())
                && matches!(c.kind.as_str(), "O" | "P" | "D" | "G")
                && [
                    c.create_at,
                    Some(c.delete_at),
                    c.last_post_at,
                    c.last_root_post_at,
                    c.total_msg_count,
                    c.total_msg_count_root,
                    c.last_viewed_at,
                    c.msg_count,
                    c.msg_count_root,
                    c.mention_count,
                    c.mention_count_root,
                    c.urgent_mention_count,
                ]
                .into_iter()
                .flatten()
                .all(|number| (0..(1i64 << 53)).contains(&number))
        }) && self.categories.iter().all(|c| {
            !c.id.is_empty()
                && categories.insert(c.id.as_str())
                && c.channel_ids
                    .iter()
                    .all(|id| channels.contains(id.as_str()))
        })
    }

    fn read(tx: &Transaction<'_>, team: &str) -> rusqlite::Result<Self> {
        let channels = tx
            .prepare_cached(READ_CHANNELS)?
            .query_map([team], |r| {
                Ok(SidebarChannel {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    display_name: r.get(3)?,
                    header: r.get(4)?,
                    purpose: r.get(5)?,
                    delete_at: r.get(6)?,
                    last_post_at: r.get(7)?,
                    last_root_post_at: r.get(8)?,
                    total_msg_count: r.get(9)?,
                    total_msg_count_root: r.get(10)?,
                    last_viewed_at: r.get(11)?,
                    msg_count: r.get(12)?,
                    msg_count_root: r.get(13)?,
                    mention_count: r.get(14)?,
                    mention_count_root: r.get(15)?,
                    urgent_mention_count: r.get(16)?,
                    muted: r.get(17)?,
                    create_at: r.get(18)?,
                    roles: r.get(19)?,
                    shared: r.get(20)?,
                    group_constrained: r.get(21)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut categories = tx
            .prepare_cached(READ_CATEGORIES)?
            .query_map([team], |r| {
                Ok(SidebarCategory {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    display_name: r.get(2)?,
                    sorting: r.get(3)?,
                    collapsed: r.get(4)?,
                    muted: r.get(5)?,
                    channel_ids: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut query = tx.prepare_cached(READ_ITEMS)?;
        let mut rows = query.query([team])?;
        while let Some(row) = rows.next()? {
            let index = usize::try_from(row.get::<_, i64>(0)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let category = categories
                .get_mut(index)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            category.channel_ids.push(row.get(1)?);
        }
        Ok(Self {
            channels,
            categories,
        })
    }

    fn replace(&self, tx: &Transaction<'_>, team: &str) -> rusqlite::Result<()> {
        tx.execute("DELETE FROM sidebar_category WHERE team_id = ?1", [team])?;
        tx.execute("DELETE FROM sidebar_channel WHERE team_id = ?1", [team])?;
        let mut channel = tx.prepare_cached("INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,
            delete_at,last_post_at,last_root_post_at,total_msg_count,total_msg_count_root,last_viewed_at,msg_count,msg_count_root,
            mention_count,mention_count_root,urgent_mention_count,muted,create_at,roles,shared,group_constrained)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)")?;
        for (position, c) in (0_i64..).zip(&self.channels) {
            channel.execute(params![
                team,
                position,
                c.id,
                c.kind,
                c.name,
                c.display_name,
                c.header,
                c.purpose,
                c.delete_at,
                c.last_post_at,
                c.last_root_post_at,
                c.total_msg_count,
                c.total_msg_count_root,
                c.last_viewed_at,
                c.msg_count,
                c.msg_count_root,
                c.mention_count,
                c.mention_count_root,
                c.urgent_mention_count,
                c.muted,
                c.create_at,
                c.roles,
                c.shared,
                c.group_constrained
            ])?;
        }
        let mut category = tx.prepare_cached("INSERT INTO sidebar_category(team_id,position,category_id,kind,display_name,sorting,collapsed,muted)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)")?;
        let mut item = tx.prepare_cached("INSERT INTO sidebar_item(team_id,category_position,position,channel_id) VALUES(?1,?2,?3,?4)")?;
        for (position, c) in (0_i64..).zip(&self.categories) {
            category.execute(params![
                team,
                position,
                c.id,
                c.kind,
                c.display_name,
                c.sorting,
                c.collapsed,
                c.muted
            ])?;
            for (order, id) in (0_i64..).zip(&c.channel_ids) {
                item.execute(params![team, position, order, id])?;
            }
        }
        Ok(())
    }
}

impl AccountHistory {
    pub fn read_sidebar(&mut self, team: &str) -> Result<Option<SidebarSnapshot>, HistoryError> {
        if !is_mattermost_id(team) {
            return Err(HistoryError::InvalidDirectory);
        }
        self.read(|tx| {
            let selected: Option<Option<String>> = tx.query_row("SELECT selected_channel FROM sidebar_team WHERE team_id = ?1 AND published = 1", [team], |row| row.get(0)).optional()?;
            selected.map(|selected_channel| Ok(SidebarSnapshot {data:SidebarData::read(tx,team)?, selected_channel})).transpose()
        })
    }

    /// Permission is issued only for a currently joined team. A later load in this team supersedes it.
    pub fn begin_sidebar_load(&mut self, team: &str) -> Result<Option<SidebarLoad>, HistoryError> {
        if !is_mattermost_id(team) {
            return Err(HistoryError::InvalidDirectory);
        }
        let id = self.write(|tx| {
            tx.query_row(
                "INSERT INTO sidebar_team(team_id,pending)
            SELECT team_id,randomblob(16) FROM joined_team WHERE team_id = ?1
            ON CONFLICT(team_id) DO UPDATE SET pending = excluded.pending RETURNING pending",
                [team],
                |row| row.get(0),
            )
            .optional()
        })?;
        Ok(id.map(|id| SidebarLoad {
            owner: self.owner.clone(),
            team: team.to_owned(),
            id,
        }))
    }

    pub fn store_sidebar(
        &mut self,
        load: SidebarLoad,
        data: &SidebarData,
    ) -> Result<bool, HistoryError> {
        if self.owner != load.owner {
            return Err(HistoryError::StaleOwner);
        }
        if !data.valid() {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            let changed = tx.execute("UPDATE sidebar_team SET pending = NULL, published = 1 WHERE team_id = ?1 AND pending = ?2",params![load.team,load.id])?;
            if changed == 0 { return Ok(false); }
            data.replace(tx,&load.team)?;
            tx.execute("UPDATE sidebar_team SET selected_channel = NULL WHERE team_id = ?1 AND selected_channel IS NOT NULL
                AND NOT EXISTS(SELECT 1 FROM sidebar_channel WHERE team_id = ?1 AND channel_id = sidebar_team.selected_channel)",[load.team])?;
            Ok(true)
        })
    }

    pub fn select_sidebar_channel(
        &mut self,
        team: &str,
        channel: &str,
    ) -> Result<bool, HistoryError> {
        if !is_mattermost_id(team) || !is_mattermost_id(channel) {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            let known: bool = tx.query_row(KNOWN_CHANNEL, [team, channel], |row| row.get(0))?;
            if known {
                tx.execute(
                    "UPDATE sidebar_team SET selected_channel = ?2 WHERE team_id = ?1",
                    [team, channel],
                )?;
            }
            Ok(known)
        })
    }
}

#[cfg(test)]
mod tests;
