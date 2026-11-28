use super::{
    DraftAddress, DraftFilesError, EntryState, MAX_FILES, Session, account, with_workspace,
};
use crate::{
    history::{HistoryError, StagePost},
    rest::TransportError,
    rest_ipc::exchange::ExchangeError,
    sessions::AccountSessions,
};
use std::sync::Arc;
use tauri::{Manager, ResourceId, Runtime, Webview};
use uuid::Uuid;

#[cfg(all(test, target_os = "macos"))]
mod tests;

/// Queue the draft with the exact ordered set of ready files seen by the editor.
pub async fn stage_post<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: DraftAddress,
    revision: Option<String>,
    selected: Vec<Uuid>,
) -> Result<StagePost, DraftFilesError> {
    let account = account(view, rid)?;
    stage_in_workspace(
        &account,
        &view.state::<AccountSessions>(),
        workspace,
        draft,
        revision,
        selected,
    )
    .await
}

pub(super) async fn stage_in_workspace(
    account: &Arc<Session>,
    sessions: &AccountSessions,
    workspace: ResourceId,
    draft: DraftAddress,
    revision: Option<String>,
    selected: Vec<Uuid>,
) -> Result<StagePost, DraftFilesError> {
    if !(1..=MAX_FILES).contains(&selected.len()) {
        return Err(DraftFilesError::InvalidDraft);
    }
    let connection = account.clone();
    account
        .with_history(sessions, move |history| {
            let result = with_workspace(&connection, workspace, |owner| {
                // Hold the same workspace lock as file changes and close until
                // the queue transaction decides whether to consume these files.
                let mut state = owner.state.lock().unwrap();
                if owner.lifetime.is_cancelled() {
                    return Ok(Err(DraftFilesError::Cancelled));
                }
                let entries = state.drafts.get(&draft).map_or(&[][..], Vec::as_slice);
                if !entries.iter().map(|entry| entry.id).eq(selected) {
                    return Ok(Err(DraftFilesError::FilesChanged));
                }
                let mut files = Vec::with_capacity(entries.len());
                for entry in entries {
                    let EntryState::Ready(file) = &entry.state else {
                        return Ok(Err(DraftFilesError::FilesNotReady));
                    };
                    files.push(file.clone());
                }
                let staged = history.stage_post_with_files_guarded(
                    &draft.channel_id,
                    draft.root_id.as_deref(),
                    revision.as_deref(),
                    &files,
                    || {
                        // An account close can win while SQLite waits for another
                        // process. Reserve this connection only for the commit.
                        connection
                            .open_resources()
                            .map_err(|_| HistoryError::StaleOwner)
                    },
                )?;
                if matches!(staged, StagePost::Created { .. }) {
                    state.drafts.remove(&draft);
                }
                Ok(Ok(staged))
            });
            match result {
                Ok(staged) => staged,
                Err(error) => Ok(Err(error)),
            }
        })
        .await
        .map_err(|error| match error {
            ExchangeError::Cancelled => DraftFilesError::Cancelled,
            ExchangeError::UnknownConnection
            | ExchangeError::Transport(TransportError::SessionUnavailable) => {
                DraftFilesError::AccountUnavailable
            }
            ExchangeError::InvalidHistoryRequest => DraftFilesError::InvalidDraft,
            _ => DraftFilesError::HistoryUnavailable,
        })?
}
