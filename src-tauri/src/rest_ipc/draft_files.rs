//! Native sources scoped to one open workspace and its account connection.
use super::{Session, session};
use crate::{
    device_document::{DocumentInfo, DocumentUnavailable, SelectedDocument},
    rest::is_mattermost_id,
};
use std::{
    collections::HashMap,
    num::NonZeroU64,
    sync::{Arc, Mutex},
};
use tauri::{Resource, ResourceId, Runtime, Webview};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

mod stage;
mod transfer;
pub use stage::stage_post;
use transfer::EntryState;
pub use transfer::{
    ChannelUploadDenial, UploadFailure, UploadPolicy, UploadState, channel_upload_denial,
    confirm_channel_upload, start_upload,
};

const MAX_FILES: usize = 10;

#[derive(Clone, Eq, Hash, PartialEq)]
pub struct DraftAddress {
    channel_id: String,
    root_id: Option<String>,
}

impl DraftAddress {
    pub fn new(channel_id: String, root_id: Option<String>) -> Result<Self, DraftFilesError> {
        if !is_mattermost_id(&channel_id)
            || root_id.as_deref().is_some_and(|id| !is_mattermost_id(id))
        {
            return Err(DraftFilesError::InvalidDraft);
        }
        Ok(Self {
            channel_id,
            root_id,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DraftFile {
    pub id: Uuid,
    pub document: DocumentInfo,
    pub upload: UploadState,
}

#[derive(Debug, Eq, PartialEq)]
pub enum AddResult {
    Added(DraftFile),
    Unavailable,
    Empty(DocumentInfo),
    TooLarge(DocumentInfo),
    LimitReached(DocumentInfo),
}

#[derive(Debug, Eq, PartialEq)]
pub enum DraftFilesError {
    AccountUnavailable,
    UnknownWorkspace,
    InvalidDraft,
    UnknownFile,
    SourceUnavailable,
    InvalidUploadPolicy,
    FilesChanged,
    FilesNotReady,
    HistoryUnavailable,
    Cancelled,
}

struct Entry {
    id: Uuid,
    document: DocumentInfo,
    state: EntryState,
}

impl Entry {
    fn info(&self) -> DraftFile {
        DraftFile {
            id: self.id,
            document: self.document.clone(),
            upload: self.state.snapshot(),
        }
    }
}

type Drafts = HashMap<DraftAddress, Vec<Entry>>;

#[derive(Default)]
struct WorkspaceState {
    drafts: Drafts,
    channel_denials: HashMap<String, ChannelUploadDenial>,
}

struct Workspace {
    lifetime: CancellationToken,
    state: Mutex<WorkspaceState>,
}

impl Resource for Workspace {}

impl Drop for Workspace {
    fn drop(&mut self) {
        self.lifetime.cancel();
    }
}

fn account<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
) -> Result<Arc<Session>, DraftFilesError> {
    session(view, rid).map_err(|_| DraftFilesError::AccountUnavailable)
}

pub fn open<R: Runtime>(view: &Webview<R>, rid: ResourceId) -> Result<ResourceId, DraftFilesError> {
    let account = account(view, rid)?;
    open_workspace(&account)
}

fn open_workspace(account: &Session) -> Result<ResourceId, DraftFilesError> {
    if !account.http.has_account() {
        return Err(DraftFilesError::AccountUnavailable);
    }
    let mut resources = account
        .open_resources()
        .map_err(|_| DraftFilesError::AccountUnavailable)?;
    let lifetime = account.lifetime.child_token();
    let workspace = Arc::new(Workspace {
        lifetime: lifetime.clone(),
        state: Mutex::default(),
    });
    let weak = Arc::downgrade(&workspace);
    // Retiring a login releases its sources even if the WebView keeps the old connection ID.
    tauri::async_runtime::spawn(async move {
        lifetime.cancelled().await;
        if let Some(workspace) = weak.upgrade() {
            *workspace.state.lock().unwrap() = WorkspaceState::default();
        }
    });
    Ok(resources.add_arc(workspace))
}

pub fn close<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
) -> Result<(), DraftFilesError> {
    let account = account(view, rid)?;
    close_workspace(&account, workspace)
}

fn close_workspace(account: &Session, workspace: ResourceId) -> Result<(), DraftFilesError> {
    let mut resources = account
        .open_resources()
        .map_err(|_| DraftFilesError::AccountUnavailable)?;
    let owner = resources
        .take::<Workspace>(workspace)
        .map_err(|_| DraftFilesError::UnknownWorkspace)?;
    drop(resources);
    // Closing and staging compete only for this workspace's state.
    let mut state = owner.state.lock().unwrap();
    owner.lifetime.cancel();
    *state = WorkspaceState::default();
    Ok(())
}

fn with_workspace<T>(
    account: &Session,
    workspace: ResourceId,
    operation: impl FnOnce(&Arc<Workspace>) -> T,
) -> Result<T, DraftFilesError> {
    let resources = account
        .open_resources()
        .map_err(|_| DraftFilesError::AccountUnavailable)?;
    let owner = resources
        .get::<Workspace>(workspace)
        .map_err(|_| DraftFilesError::UnknownWorkspace)?;
    drop(resources);
    let result = operation(&owner);
    if owner.lifetime.is_cancelled() {
        Err(DraftFilesError::AccountUnavailable)
    } else {
        Ok(result)
    }
}

/// Resolve the selected documents in chooser order, then publish them as one batch.
pub async fn add<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
    max_size: NonZeroU64,
    documents: impl IntoIterator<
        Item = impl Future<Output = Result<Arc<SelectedDocument>, DocumentUnavailable>>,
    >,
) -> Result<Vec<AddResult>, DraftFilesError> {
    let account = account(view, rid)?;
    add_to_workspace(&account, workspace, draft, max_size, documents).await
}

async fn add_to_workspace(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
    max_size: NonZeroU64,
    documents: impl IntoIterator<
        Item = impl Future<Output = Result<Arc<SelectedDocument>, DocumentUnavailable>>,
    >,
) -> Result<Vec<AddResult>, DraftFilesError> {
    let lifetime = with_workspace(account, workspace, |owner| owner.lifetime.clone())?;
    let prepare = async {
        let mut prepared = Vec::new();
        let mut usable = 0;
        for source in documents {
            prepared.push(match source.await {
                Err(_) => Err(AddResult::Unavailable),
                Ok(source) => match source.info().size {
                    Some(0) => Err(AddResult::Empty(source.info().clone())),
                    Some(size) if size > max_size.get() => {
                        Err(AddResult::TooLarge(source.info().clone()))
                    }
                    // No more than ten sources in one batch can be published.
                    _ if usable == MAX_FILES => Err(AddResult::LimitReached(source.info().clone())),
                    _ => {
                        usable += 1;
                        Ok(source)
                    }
                },
            });
        }
        prepared
    };
    let prepared = tokio::select! {
        biased;
        _ = lifetime.cancelled() => return Err(DraftFilesError::Cancelled),
        prepared = prepare => prepared,
    };
    let result = with_workspace(account, workspace, |owner| {
        if lifetime.is_cancelled() {
            return Err(DraftFilesError::Cancelled);
        }
        let mut state = owner.state.lock().unwrap();
        Ok(prepared
            .into_iter()
            .map(|source| {
                let source = match source {
                    Ok(source) => source,
                    Err(result) => return result,
                };
                let entries = state.drafts.entry(draft.clone()).or_default();
                if entries.len() == MAX_FILES {
                    return AddResult::LimitReached(source.info().clone());
                }
                let entry = Entry {
                    id: Uuid::new_v4(),
                    document: source.info().clone(),
                    state: EntryState::Selected(source),
                };
                let info = entry.info();
                entries.push(entry);
                AddResult::Added(info)
            })
            .collect())
    });
    if lifetime.is_cancelled() {
        return Err(DraftFilesError::Cancelled);
    }
    result?
}

pub fn list<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
) -> Result<Vec<DraftFile>, DraftFilesError> {
    list_workspace(account(view, rid)?.as_ref(), workspace, draft)
}

fn list_workspace(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
) -> Result<Vec<DraftFile>, DraftFilesError> {
    with_workspace(account, workspace, |owner| {
        owner
            .state
            .lock()
            .unwrap()
            .drafts
            .get(draft)
            .into_iter()
            .flatten()
            .map(Entry::info)
            .collect()
    })
}

pub fn source<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
    file: Uuid,
) -> Result<Arc<SelectedDocument>, DraftFilesError> {
    with_workspace(account(view, rid)?.as_ref(), workspace, |owner| {
        owner
            .state
            .lock()
            .unwrap()
            .drafts
            .get(draft)
            .into_iter()
            .flatten()
            .find(|entry| entry.id == file)
            .ok_or(DraftFilesError::UnknownFile)?
            .state
            .source()
            .cloned()
            .ok_or(DraftFilesError::SourceUnavailable)
    })?
}

pub fn remove<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
    file: Uuid,
) -> Result<(), DraftFilesError> {
    remove_from_workspace(account(view, rid)?.as_ref(), workspace, draft, file)
}

fn remove_from_workspace(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
    file: Uuid,
) -> Result<(), DraftFilesError> {
    let removed = with_workspace(account, workspace, |owner| {
        let mut state = owner.state.lock().unwrap();
        let drafts = &mut state.drafts;
        let entries = drafts.get_mut(draft).ok_or(DraftFilesError::UnknownFile)?;
        let index = entries
            .iter()
            .position(|entry| entry.id == file)
            .ok_or(DraftFilesError::UnknownFile)?;
        let removed = entries.remove(index);
        removed.state.cancel();
        if entries.is_empty() {
            drafts.remove(draft);
        }
        Ok(removed)
    })??;
    drop(removed);
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests;

#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
pub(crate) mod checks;

#[cfg(feature = "webview-check")]
pub(crate) async fn fixture_connection<R: Runtime>(
    view: &Webview<R>,
) -> Result<ResourceId, &'static str> {
    use crate::{
        rest::RestConnection,
        sessions::fixture::{TestVault, using},
    };
    use tauri::Manager;
    let accounts = using(Arc::new(TestVault::default()));
    let installation = "https://draft-files.example.invalid";
    let user = "a".repeat(26);
    accounts
        .activate(installation, &user, "draft-files-fixture")
        .await
        .map_err(|_| "draft account")?;
    let connection = RestConnection::new(installation)
        .map_err(|_| "draft installation")?
        .for_account(&accounts, &user)
        .await
        .map_err(|_| "draft connection")?;
    Ok(view.resources_table().add(Session::new(connection)))
}
