use super::{exchange::ExchangeError, session};
use crate::{
    history::{DeliveryPost, DeliverySource, PendingPost, StagePost},
    rest::is_mattermost_id,
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

#[tauri::command]
pub(crate) async fn confirm_post_delivery<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    source: DeliverySource,
    wire_pending_id: Option<String>,
    post: DeliveryPost,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.confirm_delivery(source, wire_pending_id.as_deref(), &post)
        })
        .await
}

#[tauri::command]
pub(crate) async fn retire_delivered_posts<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    post_ids: Vec<String>,
) -> Result<usize, ExchangeError> {
    let account = session(&webview, rid)?;
    if post_ids.len() > super::history::MAX_POSTS as usize
        || post_ids.iter().any(|id| !is_mattermost_id(id))
    {
        return Err(ExchangeError::InvalidHistoryRequest);
    }
    account
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.retire_delivered_posts(&post_ids)
        })
        .await
}
