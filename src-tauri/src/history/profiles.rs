use super::{AccountHistory, HistoryError};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelProfile {
    pub id: String,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub nickname: String,
    pub position: String,
    pub update_at: Option<i64>,
    pub delete_at: Option<i64>,
    pub last_picture_update: Option<i64>,
    pub is_bot: bool,
    pub is_guest: bool,
    pub remote_username: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileQuery {
    pub ids: Vec<String>,
    pub usernames: Vec<String>,
}

#[derive(Default, Debug, Serialize, PartialEq, Eq)]
pub struct ProfileLookup {
    /// Includes rows explicitly requested by ID and unambiguous rows requested by username.
    pub profiles: BTreeMap<String, ChannelProfile>,
    /// Only requested names with exactly one known owner appear here.
    pub usernames: BTreeMap<String, String>,
}

const BY_ID: &str = "SELECT id, username, first_name, last_name, nickname, position, update_at,
    delete_at, last_picture_update, is_bot, is_guest, remote_username FROM channel_profile WHERE id = ?1";
const BY_NAME: &str = "SELECT id FROM channel_profile WHERE username = ?1 LIMIT 2";
const UPSERT: &str = "INSERT INTO channel_profile(id, username, first_name, last_name, nickname, position,
    update_at, delete_at, last_picture_update, is_bot, is_guest, remote_username)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
    last_name=excluded.last_name, nickname=excluded.nickname, position=excluded.position,
    update_at=excluded.update_at, delete_at=excluded.delete_at, last_picture_update=excluded.last_picture_update,
    is_bot=excluded.is_bot, is_guest=excluded.is_guest, remote_username=excluded.remote_username
    WHERE excluded.update_at IS NOT NULL
      AND (channel_profile.update_at IS NULL OR excluded.update_at > channel_profile.update_at)";

impl ChannelProfile {
    fn valid(&self) -> bool {
        is_mattermost_id(&self.id)
            && !self.username.trim().is_empty()
            && [self.update_at, self.delete_at, self.last_picture_update]
                .into_iter()
                .flatten()
                .all(|n| (0..(1_i64 << 53)).contains(&n))
    }

    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            username: row.get(1)?,
            first_name: row.get(2)?,
            last_name: row.get(3)?,
            nickname: row.get(4)?,
            position: row.get(5)?,
            update_at: row.get(6)?,
            delete_at: row.get(7)?,
            last_picture_update: row.get(8)?,
            is_bot: row.get(9)?,
            is_guest: row.get(10)?,
            remote_username: row.get(11)?,
        })
    }
}

impl AccountHistory {
    pub fn store_profiles(&mut self, rows: &[ChannelProfile]) -> Result<(), HistoryError> {
        let mut seen = HashSet::with_capacity(rows.len());
        if !rows
            .iter()
            .all(|row| row.valid() && seen.insert(row.id.as_str()))
        {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            let mut insert = tx.prepare_cached(UPSERT)?;
            for profile in rows {
                insert.execute(params![
                    profile.id,
                    profile.username,
                    profile.first_name,
                    profile.last_name,
                    profile.nickname,
                    profile.position,
                    profile.update_at,
                    profile.delete_at,
                    profile.last_picture_update,
                    profile.is_bot,
                    profile.is_guest,
                    profile.remote_username
                ])?;
            }
            Ok(())
        })
    }

    pub fn read_profiles(&mut self, query: &ProfileQuery) -> Result<ProfileLookup, HistoryError> {
        if !query.ids.iter().all(|id| is_mattermost_id(id))
            || query.usernames.iter().any(|name| name.trim().is_empty())
        {
            return Err(HistoryError::InvalidDirectory);
        }
        self.read(|tx| {
            let mut result = ProfileLookup::default();
            let mut by_name = tx.prepare_cached(BY_NAME)?;
            for name in query.usernames.iter().collect::<HashSet<_>>() {
                let mut matches = by_name.query([name])?;
                if let Some(first) = matches.next()? {
                    let id: String = first.get(0)?;
                    if matches.next()?.is_none() {
                        result.usernames.insert(name.clone(), id);
                    }
                }
            }
            let mut by_id = tx.prepare_cached(BY_ID)?;
            let ids: HashSet<_> = query.ids.iter().chain(result.usernames.values()).collect();
            for id in ids {
                if let Some(profile) = by_id.query_row([id], ChannelProfile::from_row).optional()? {
                    result.profiles.insert(id.clone(), profile);
                }
            }
            Ok(result)
        })
    }
}

#[cfg(test)]
mod tests;
