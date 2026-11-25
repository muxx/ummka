use super::{exchange::ExchangeError, session};
use crate::{
    history::{HistoryError, TeamRoleLoad, TeamRoleSnapshot},
    sessions::AccountSessions,
};
use serde::Serialize;
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamRoleRequest {
    load: ResourceId,
    role_names: Vec<String>,
}

struct PendingTeamRoles(TeamRoleLoad);
impl Resource for PendingTeamRoles {}

#[tauri::command]
pub(crate) async fn read_team_roles<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<Option<TeamRoleSnapshot>, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.read_team_roles(&team_id)
        })
        .await
}

#[tauri::command]
pub(crate) async fn begin_team_role_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<Option<TeamRoleRequest>, ExchangeError> {
    let account = session(&webview, rid)?;
    let pending = account
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.begin_team_roles(&team_id)
        })
        .await?;
    let mut resources = account.open_resources()?;
    Ok(pending.map(|(load, role_names)| TeamRoleRequest {
        load: resources.add(PendingTeamRoles(load)),
        role_names,
    }))
}

#[tauri::command]
pub(crate) async fn store_team_roles<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
    data: serde_json::Value,
) -> Result<bool, ExchangeError> {
    let account = session(&webview, rid)?;
    let pending =
        account.take_pending::<PendingTeamRoles>(load, ExchangeError::UnknownDirectoryLoad)?;
    account
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            let data: TeamRoleSnapshot =
                serde_json::from_value(data).map_err(|_| HistoryError::InvalidDirectory)?;
            db.store_team_roles(pending.0, &data)
        })
        .await
}

#[tauri::command]
pub(crate) fn cancel_team_role_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .take_pending::<PendingTeamRoles>(load, ExchangeError::UnknownDirectoryLoad)?;
    Ok(())
}
