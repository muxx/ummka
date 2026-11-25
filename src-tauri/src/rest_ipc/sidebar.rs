use super::{exchange::ExchangeError, session};
use crate::{
    history::{HistoryError, SidebarData, SidebarLoad, SidebarSnapshot},
    sessions::AccountSessions,
};
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};

struct PendingSidebar(SidebarLoad);
impl Resource for PendingSidebar {}

#[tauri::command]
pub(crate) async fn read_team_sidebar<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<Option<SidebarSnapshot>, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.read_sidebar(&team_id)
        })
        .await
}
#[tauri::command]
pub(crate) async fn select_sidebar_channel<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
    channel_id: String,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.select_sidebar_channel(&team_id, &channel_id)
        })
        .await
}
#[tauri::command]
pub(crate) async fn begin_sidebar_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    team_id: String,
) -> Result<Option<ResourceId>, ExchangeError> {
    let account = session(&webview, rid)?;
    let pending = account
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.begin_sidebar_load(&team_id)
        })
        .await?;
    let mut resources = account.open_resources()?;
    Ok(pending.map(|load| resources.add(PendingSidebar(load))))
}
#[tauri::command]
pub(crate) async fn store_team_sidebar<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
    data: serde_json::Value,
) -> Result<bool, ExchangeError> {
    let account = session(&webview, rid)?;
    let pending =
        account.take_pending::<PendingSidebar>(load, ExchangeError::UnknownDirectoryLoad)?;
    account
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            let data: SidebarData =
                serde_json::from_value(data).map_err(|_| HistoryError::InvalidDirectory)?;
            db.store_sidebar(pending.0, &data)
        })
        .await
}
#[tauri::command]
pub(crate) fn cancel_sidebar_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .take_pending::<PendingSidebar>(load, ExchangeError::UnknownDirectoryLoad)?;
    Ok(())
}
