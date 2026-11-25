use super::{exchange::ExchangeError, session};
use crate::{
    history::{PendingPost, StagePost},
    sessions::AccountSessions,
};
use tauri::{Manager, ResourceId, Runtime, Webview};

#[tauri::command]
pub(crate) async fn stage_composer_post<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
    root_id: Option<String>,
    revision: String,
) -> Result<StagePost, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.stage_post(&channel_id, root_id.as_deref(), &revision)
        })
        .await
}

#[tauri::command]
pub(crate) async fn read_pending_posts<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
    root_id: Option<String>,
    after: i64,
    limit: u8,
) -> Result<Vec<PendingPost>, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.pending_posts(&channel_id, root_id.as_deref(), after, limit)
        })
        .await
}
