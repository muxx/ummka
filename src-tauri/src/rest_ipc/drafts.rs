use super::{exchange::ExchangeError, session};
use crate::{
    history::{ComposerDraft, DraftCommandAction, DraftSave},
    sessions::AccountSessions,
};
use tauri::{Manager, ResourceId, Runtime, Webview};

#[tauri::command]
pub(crate) async fn read_composer_draft<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
    root_id: Option<String>,
) -> Result<ComposerDraft, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.read_draft(&channel_id, root_id.as_deref())
        })
        .await
}

#[tauri::command]
pub(crate) async fn save_composer_draft<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
    root_id: Option<String>,
    expected_revision: Option<String>,
    message: String,
) -> Result<DraftSave, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.save_draft(
                &channel_id,
                root_id.as_deref(),
                expected_revision.as_deref(),
                &message,
            )
        })
        .await
}

#[tauri::command]
pub(crate) async fn transition_draft_command<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
    root_id: Option<String>,
    revision: String,
    action: DraftCommandAction,
) -> Result<DraftSave, ExchangeError> {
    session(&webview, rid)?
        .with_history(&webview.state::<AccountSessions>(), move |view| {
            view.transition_draft_command(&channel_id, root_id.as_deref(), &revision, action)
        })
        .await
}
