use super::{exchange::ExchangeError, session};
use crate::{
    history::{DeliveryPost, DeliverySource, PendingPost, PostRefusal, RetryPost, StagePost},
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

#[tauri::command]
pub(crate) async fn record_post_refusal<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    pending_id: String,
    attempt: u32,
    refusal: PostRefusal,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.record_post_refusal(&pending_id, attempt, &refusal)
        })
        .await
}

#[tauri::command]
pub(crate) async fn retry_pending_post<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    pending_id: String,
    attempt: u32,
    choice: RetryPost,
) -> Result<Option<PendingPost>, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.retry_post(&pending_id, attempt, choice)
        })
        .await
}

#[tauri::command]
pub(crate) async fn dismiss_pending_post<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    pending_id: String,
    attempt: u32,
) -> Result<bool, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.dismiss_pending_post(&pending_id, attempt)
        })
        .await
}
