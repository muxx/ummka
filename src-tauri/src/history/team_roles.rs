use super::{AccountHistory, HistoryError, HistoryOwner};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoleDefinition {
    pub name: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamRoleSnapshot {
    pub system_roles: String,
    pub definitions: Vec<RoleDefinition>,
}

impl TeamRoleSnapshot {
    fn valid(&self) -> bool {
        let mut names = HashSet::new();
        self.definitions.iter().all(|role| {
            !role.name.is_empty()
                && !role.name.contains(char::is_whitespace)
                && names.insert(role.name.as_str())
                && role
                    .permissions
                    .iter()
                    .all(|permission| !permission.is_empty())
        }) && self
            .system_roles
            .split(' ')
            .filter(|name| !name.is_empty())
            .all(|name| names.contains(name))
    }
}

pub struct TeamRoleLoad {
    owner: HistoryOwner,
    team: String,
    id: [u8; 16],
}

const READ: &str = "SELECT payload FROM team_role_snapshot WHERE team_id=?1 AND generation=?2";
const BEGIN: &str = "INSERT INTO team_role_snapshot(team_id,pending)
    SELECT team_id,randomblob(16) FROM sidebar_team WHERE team_id=?1 AND published=1
    ON CONFLICT(team_id) DO UPDATE SET pending=excluded.pending RETURNING pending";
// The team assignment applies only when a regular channel exists in that team.
const ASSIGNMENTS: &str = "SELECT roles FROM sidebar_channel WHERE team_id=?1
    UNION SELECT roles FROM joined_team WHERE team_id=?1 AND EXISTS
    (SELECT 1 FROM sidebar_channel WHERE team_id=?1 AND kind IN ('O','P'))";
const STORE: &str = "UPDATE team_role_snapshot SET pending=NULL,generation=?3,payload=?4
    WHERE team_id=?1 AND pending=?2";

impl AccountHistory {
    pub fn read_team_roles(
        &mut self,
        team: &str,
    ) -> Result<Option<TeamRoleSnapshot>, HistoryError> {
        if !is_mattermost_id(team) {
            return Err(HistoryError::InvalidDirectory);
        }
        let generation = self.owner.generation;
        let payload: Option<String> = self.read(|tx| {
            tx.query_row(READ, params![team, generation], |row| row.get(0))
                .optional()
        })?;
        payload
            .map(|json| serde_json::from_str(&json).map_err(|_| HistoryError::Storage))
            .transpose()
    }

    pub fn begin_team_roles(
        &mut self,
        team: &str,
    ) -> Result<Option<(TeamRoleLoad, Vec<String>)>, HistoryError> {
        if !is_mattermost_id(team) {
            return Err(HistoryError::InvalidDirectory);
        }
        let request = self.write(|tx| {
            let mut assignments = tx.prepare_cached(ASSIGNMENTS)?;
            let mut rows = assignments.query([team])?;
            let mut names = BTreeSet::new();
            let mut has_channels = false;
            while let Some(row) = rows.next()? {
                has_channels = true;
                if let Some(roles) = row.get::<_, Option<String>>(0)? {
                    names.extend(
                        roles
                            .split(' ')
                            .filter(|name| !name.is_empty())
                            .map(str::to_owned),
                    );
                }
            }
            if !has_channels {
                return Ok(None);
            }
            let id = tx.query_row(BEGIN, [team], |row| row.get(0)).optional()?;
            Ok(id.map(|id| (id, names.into_iter().collect())))
        })?;
        Ok(request.map(|(id, names)| {
            (
                TeamRoleLoad {
                    owner: self.owner.clone(),
                    team: team.to_owned(),
                    id,
                },
                names,
            )
        }))
    }

    pub fn store_team_roles(
        &mut self,
        load: TeamRoleLoad,
        data: &TeamRoleSnapshot,
    ) -> Result<bool, HistoryError> {
        if load.owner != self.owner {
            return Err(HistoryError::StaleOwner);
        }
        if !data.valid() {
            return Err(HistoryError::InvalidDirectory);
        }
        let json = serde_json::to_string(data).map_err(|_| HistoryError::Storage)?;
        self.write(|tx| {
            Ok(tx.execute(
                STORE,
                params![load.team, load.id, load.owner.generation, json],
            )? == 1)
        })
    }
}

#[cfg(test)]
mod tests;
