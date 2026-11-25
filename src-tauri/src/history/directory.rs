use super::{AccountHistory, HistoryError, HistoryOwner, SidebarPreferences};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryTeam {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub preference_rank: Option<u32>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamDirectory {
    pub teams: Vec<DirectoryTeam>,
    pub selected_team: Option<String>,
}

/// Held by the calling connection. Another refresh, even in another process, supersedes it.
pub struct TeamDirectoryLoad {
    owner: HistoryOwner,
    id: [u8; 16],
}

const ORDERED: &str = "SELECT team_id, name, display_name, preference_rank, selected FROM joined_team ORDER BY position";
const SELECTED: &str = "SELECT team_id FROM joined_team WHERE selected = 1";
const HAS_TEAM: &str = "SELECT EXISTS(SELECT 1 FROM joined_team WHERE team_id = ?1)";

impl AccountHistory {
    pub fn read_team_directory(&mut self) -> Result<Option<TeamDirectory>, HistoryError> {
        self.read(|tx| {
            let published: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM team_directory WHERE owner = 1 AND published = 1)",
                [],
                |row| row.get(0),
            )?;
            if !published {
                return Ok(None);
            }
            let mut result = TeamDirectory {
                teams: Vec::new(),
                selected_team: None,
            };
            let mut query = tx.prepare_cached(ORDERED)?;
            let mut rows = query.query([])?;
            while let Some(row) = rows.next()? {
                let team = DirectoryTeam {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2)?,
                    preference_rank: row.get(3)?,
                };
                if row.get::<_, bool>(4)? {
                    result.selected_team = Some(team.id.clone());
                }
                result.teams.push(team);
            }
            Ok(Some(result))
        })
    }

    pub fn begin_team_directory_load(&mut self) -> Result<TeamDirectoryLoad, HistoryError> {
        let id = self.write(|tx| {
            tx.query_row(
                "INSERT INTO team_directory(owner, pending) VALUES (1, randomblob(16))
                 ON CONFLICT(owner) DO UPDATE SET pending = excluded.pending RETURNING pending",
                [],
                |row| row.get(0),
            )
        })?;
        Ok(TeamDirectoryLoad {
            owner: self.owner.clone(),
            id,
        })
    }

    /// Returns false when a newer refresh already owns the next snapshot.
    pub fn store_team_directory(
        &mut self,
        load: TeamDirectoryLoad,
        teams: &[DirectoryTeam],
        preferences: Option<&SidebarPreferences>,
    ) -> Result<bool, HistoryError> {
        if self.owner != load.owner {
            return Err(HistoryError::StaleOwner);
        }
        let mut ids = HashSet::with_capacity(teams.len());
        let mut ranks = HashSet::new();
        if preferences.is_some_and(|prefs| !prefs.valid())
            || teams.iter().any(|team| {
                !is_mattermost_id(&team.id)
                    || !ids.insert(&team.id)
                    || team.preference_rank.is_some_and(|rank| !ranks.insert(rank))
            })
        {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            let changed = tx.execute(
                "UPDATE team_directory SET pending = NULL, published = 1 WHERE owner = 1 AND pending = ?1",
                [load.id],
            )?;
            if changed == 0 {
                return Ok(false);
            }
            if let Some(prefs) = preferences {
                prefs.publish(tx)?;
            }
            let selected: Option<String> = tx.query_row(SELECTED, [], |row| row.get(0)).optional()?;
            // Opening the sole joined team is implicit. Record it in this same transaction
            // so a renderer cannot overwrite a concurrent choice using an older snapshot.
            let selected = match teams {
                [only] => Some(only.id.as_str()),
                _ => selected.as_deref(),
            };
            tx.execute("DELETE FROM joined_team", [])?;
            let mut insert = tx.prepare_cached(
                "INSERT INTO joined_team(position, team_id, name, display_name, preference_rank, selected)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for (position, team) in (0_i64..).zip(teams) {
                insert.execute(params![position, team.id, team.name, team.display_name, team.preference_rank, selected == Some(team.id.as_str())])?;
            }
            tx.execute(
                "DELETE FROM sidebar_team WHERE NOT EXISTS
                 (SELECT 1 FROM joined_team WHERE joined_team.team_id = sidebar_team.team_id)",
                [],
            )?;
            Ok(true)
        })
    }

    /// An unknown team leaves the current choice intact.
    pub fn select_team(&mut self, id: &str) -> Result<bool, HistoryError> {
        if !is_mattermost_id(id) {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            let known: bool = tx.query_row(HAS_TEAM, [id], |row| row.get(0))?;
            if known {
                tx.execute("UPDATE joined_team SET selected = 0 WHERE selected = 1", [])?;
                tx.execute(
                    "UPDATE joined_team SET selected = 1 WHERE team_id = ?1",
                    [id],
                )?;
            }
            Ok(known)
        })
    }
}

#[cfg(test)]
mod tests;
