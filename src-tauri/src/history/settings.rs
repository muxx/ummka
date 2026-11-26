use super::{AccountHistory, HistoryError, HistoryOwner};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::BTreeMap;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum NameFormat {
    Username,
    NicknameFullName,
    FullName,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ThreadMode {
    Disabled,
    DefaultOff,
    DefaultOn,
    AlwaysOn,
}

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SidebarPreferences {
    #[serde(skip_serializing_if = "Option::is_none")]
    composer_keys: Option<ComposerKeys>,
    name_format: Option<NameFormat>,
    collapsed_threads: Option<bool>,
    separate_unreads: Option<bool>,
    limit: Option<u64>,
    direct_shown: BTreeMap<String, bool>,
    group_shown: BTreeMap<String, bool>,
    view_times: BTreeMap<String, u64>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ComposerKeys {
    send_on_ctrl_enter: bool,
    code_block_on_ctrl_enter: bool,
}

impl SidebarPreferences {
    pub(super) fn valid(&self) -> bool {
        self.direct_shown
            .iter()
            .chain(&self.group_shown)
            .all(|(id, shown)| *shown && is_mattermost_id(id))
            && self
                .view_times
                .iter()
                .all(|(id, value)| is_mattermost_id(id) && *value < (1 << 53))
            && self.limit.is_none_or(|value| value < (1 << 53))
    }
    pub(super) fn publish(&self, tx: &Transaction<'_>) -> rusqlite::Result<()> {
        let data = serde_json::to_string(self)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        tx.execute(
            "INSERT INTO workspace_settings(owner,preferences) VALUES(1,?1)
            ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences",
            [data],
        )?;
        Ok(())
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchSettings {
    all_teams: bool,
    files: bool,
    archived_channels: bool,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum RecipientScope {
    Any,
    Team,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    dm_recipient_scope: Option<RecipientScope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    search: Option<SearchSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unique_reaction_limit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    post_edit_limit_seconds: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mentions: Option<MentionSettings>,
    collapsed_threads: ThreadMode,
    separate_unreads: bool,
    name_format: NameFormat,
    lock_name_format: bool,
    #[serde(rename = "sharedChannelDMs", skip_serializing_if = "Option::is_none")]
    shared_channel_dms: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MentionSettings {
    confirm_notifications: bool,
    max_notifications_per_channel: String,
    custom_groups: bool,
    ldap_groups: bool,
}

fn canonical_i64(raw: &str) -> Option<i64> {
    raw.parse::<i64>()
        .ok()
        .filter(|value| value.to_string() == raw)
}

impl MentionSettings {
    fn valid(&self) -> bool {
        canonical_i64(&self.max_notifications_per_channel).is_some_and(|limit| limit > 0)
    }
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub preferences: Option<SidebarPreferences>,
    pub server: Option<ServerPolicy>,
}

pub struct ServerPolicyLoad {
    owner: HistoryOwner,
    id: [u8; 16],
}

const READ: &str = "SELECT preferences, server FROM workspace_settings WHERE owner=1";
fn stored<T: DeserializeOwned>(row: &Row<'_>, column: usize) -> rusqlite::Result<Option<T>> {
    let raw: Option<String> = row.get(column)?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                column,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
    .transpose()
}

impl AccountHistory {
    pub fn read_workspace_settings(&mut self) -> Result<WorkspaceSettings, HistoryError> {
        self.read(|tx| {
            Ok(tx
                .query_row(READ, [], |row| {
                    Ok(WorkspaceSettings {
                        preferences: stored(row, 0)?,
                        server: stored(row, 1)?,
                    })
                })
                .optional()?
                .unwrap_or_default())
        })
    }

    pub fn begin_server_policy_load(&mut self) -> Result<ServerPolicyLoad, HistoryError> {
        let id = self.write(|tx| {
            tx.query_row(
                "INSERT INTO workspace_settings(owner,pending) VALUES(1,randomblob(16))
                ON CONFLICT(owner) DO UPDATE SET pending=excluded.pending RETURNING pending",
                [],
                |row| row.get(0),
            )
        })?;
        Ok(ServerPolicyLoad {
            owner: self.owner.clone(),
            id,
        })
    }

    pub fn store_server_policy(
        &mut self,
        load: ServerPolicyLoad,
        value: &ServerPolicy,
    ) -> Result<bool, HistoryError> {
        if load.owner != self.owner {
            return Err(HistoryError::StaleOwner);
        }
        if value
            .mentions
            .as_ref()
            .is_some_and(|settings| !settings.valid())
            || value
                .unique_reaction_limit
                .iter()
                .chain(&value.post_edit_limit_seconds)
                .any(|raw| canonical_i64(raw).is_none())
        {
            return Err(HistoryError::InvalidDirectory);
        }
        let data = serde_json::to_string(value).map_err(|_| HistoryError::InvalidDirectory)?;
        self.write(|tx| Ok(tx.execute("UPDATE workspace_settings SET server=?1, pending=NULL WHERE owner=1 AND pending=?2", params![data,load.id])? == 1))
    }
}

#[cfg(test)]
mod tests;
