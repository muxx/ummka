use super::{exchange::ExchangeError, session};
use crate::{
    history::{AccountHistory, HistoryError, ServerPolicyLoad, WorkspaceSettings},
    sessions::AccountSessions,
};
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};

struct PendingPolicy(ServerPolicyLoad);
impl Resource for PendingPolicy {}

#[tauri::command]
pub(crate) async fn read_workspace_settings<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<WorkspaceSettings, ExchangeError> {
    session(&webview, rid)?
        .with_history(
            &webview.state::<AccountSessions>(),
            AccountHistory::read_workspace_settings,
        )
        .await
}

#[tauri::command]
pub(crate) async fn begin_workspace_policy_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<ResourceId, ExchangeError> {
    let session = session(&webview, rid)?;
    let load = session
        .with_history(
            &webview.state::<AccountSessions>(),
            AccountHistory::begin_server_policy_load,
        )
        .await?;
    Ok(session.open_resources()?.add(PendingPolicy(load)))
}

#[tauri::command]
pub(crate) async fn store_workspace_policy<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
    server: serde_json::Value,
) -> Result<bool, ExchangeError> {
    let account = session(&webview, rid)?;
    let ticket =
        account.take_pending::<PendingPolicy>(load, ExchangeError::UnknownDirectoryLoad)?;
    account
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            let policy =
                serde_json::from_value(server).map_err(|_| HistoryError::InvalidDirectory)?;
            view.store_server_policy(ticket.0, &policy)
        })
        .await
}

#[tauri::command]
pub(crate) fn cancel_workspace_policy_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .take_pending::<PendingPolicy>(load, ExchangeError::UnknownDirectoryLoad)
        .map(drop)
}
