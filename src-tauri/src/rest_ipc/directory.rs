use super::{exchange::ExchangeError, session};
use crate::{
    history::{AccountHistory, DirectoryTeam, TeamDirectory, TeamDirectoryLoad},
    sessions::AccountSessions,
};
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};

struct PendingDirectory(TeamDirectoryLoad);
impl Resource for PendingDirectory {}

#[tauri::command]
pub(crate) async fn read_joined_teams<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<Option<TeamDirectory>, ExchangeError> {
    session(&webview, rid)?
        .with_history(
            &webview.state::<AccountSessions>(),
            AccountHistory::read_team_directory,
        )
        .await
}

#[tauri::command]
pub(crate) async fn select_joined_team<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.select_team(&team_id)
        })
        .await
}

#[tauri::command]
pub(crate) async fn read_recent_team_searches<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<Vec<String>, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.recent_team_searches(&team_id)
        })
        .await
}

#[tauri::command]
pub(crate) async fn remember_team_search<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
    term: String,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.remember_team_search(&team_id, &term)
        })
        .await
}

#[tauri::command]
pub(crate) async fn forget_team_search<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
    term: String,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.forget_team_search(&team_id, &term)
        })
        .await
}

#[tauri::command]
pub(crate) async fn begin_team_directory_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<ResourceId, ExchangeError> {
    let account = session(&webview, rid)?;
    let ticket = account
        .with_history(
            &webview.state::<AccountSessions>(),
            AccountHistory::begin_team_directory_load,
        )
        .await?;
    Ok(account.open_resources()?.add(PendingDirectory(ticket)))
}

#[tauri::command]
pub(crate) async fn store_team_directory<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
    teams: serde_json::Value,
    preferences: serde_json::Value,
) -> Result<bool, ExchangeError> {
    let account = session(&webview, rid)?;
    let ticket =
        account.take_pending::<PendingDirectory>(load, ExchangeError::UnknownDirectoryLoad)?;
    account
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            let teams: Vec<DirectoryTeam> = serde_json::from_value(teams)
                .map_err(|_| crate::history::HistoryError::InvalidDirectory)?;
            let preferences = serde_json::from_value(preferences)
                .map_err(|_| crate::history::HistoryError::InvalidDirectory)?;
            view.store_team_directory(ticket.0, &teams, Some(&preferences))
        })
        .await
}

#[tauri::command]
pub(crate) fn cancel_team_directory_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .take_pending::<PendingDirectory>(load, ExchangeError::UnknownDirectoryLoad)
        .map(drop)
}
