use super::{exchange::ExchangeError, session};
use crate::{
    history::{ChannelProfile, HistoryError, ProfileLookup, ProfileQuery},
    sessions::AccountSessions,
};
use tauri::{Manager, ResourceId, Runtime, Webview};

#[tauri::command]
pub(crate) async fn read_saved_profiles<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    query: ProfileQuery,
) -> Result<ProfileLookup, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            db.read_profiles(&query)
        })
        .await
}

#[tauri::command]
pub(crate) async fn store_channel_profiles<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    profiles: serde_json::Value,
) -> Result<(), ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |db| {
            let rows: Vec<ChannelProfile> =
                serde_json::from_value(profiles).map_err(|_| HistoryError::InvalidDirectory)?;
            db.store_profiles(&rows)
        })
        .await
}
