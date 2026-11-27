use super::*;
use crate::{
    app_error::PublicError,
    rest::{
        RestConnection,
        file_upload::{
            FileUploadError, SourceError, UploadFile, UploadProgress, UploadPurpose, UploadedFile,
        },
    },
};
use reqwest::StatusCode;
use std::sync::{OnceLock, Weak};
use tokio::sync::watch;

/// The current result of the channel upload policy (RFC 0416).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UploadPolicy {
    Allowed { max_file_bytes: u64 },
    Denied,
    Unknown,
}

impl UploadPolicy {
    fn validate(self) -> Result<(), DraftFilesError> {
        if matches!(self, Self::Allowed { max_file_bytes } if max_file_bytes > i64::MAX as u64) {
            return Err(DraftFilesError::InvalidUploadPolicy);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UploadFailure {
    PermissionDenied(Option<PublicError>),
    PolicyUnavailable,
    TooLarge(Option<PublicError>),
    Upload(FileUploadError),
}

impl UploadFailure {
    pub fn can_retry(&self) -> bool {
        !matches!(
            self,
            Self::PermissionDenied(_)
                | Self::Upload(FileUploadError::Source(
                    SourceError::Unreadable | SourceError::LengthChanged
                ))
        )
    }
}

impl From<FileUploadError> for UploadFailure {
    fn from(error: FileUploadError) -> Self {
        match error {
            FileUploadError::Server(response)
                if response.status_code == StatusCode::FORBIDDEN.as_u16() =>
            {
                Self::PermissionDenied(Some(response))
            }
            FileUploadError::Server(response)
                if response.status_code == StatusCode::PAYLOAD_TOO_LARGE.as_u16() =>
            {
                Self::TooLarge(Some(response))
            }
            FileUploadError::Source(SourceError::TooLarge) => Self::TooLarge(None),
            error => Self::Upload(error),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UploadState {
    Selected,
    Reading {
        bytes_read: u64,
        length: Option<u64>,
    },
    Processing {
        bytes_read: u64,
    },
    Failed(UploadFailure),
    Ready(UploadedFile),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelUploadDenial {
    pub revision: Uuid,
    pub response: PublicError,
}

pub(super) struct Attempt {
    cancel: CancellationToken,
    progress: watch::Receiver<UploadProgress>,
    length: OnceLock<u64>,
}

pub(super) enum EntryState {
    Selected(Arc<SelectedDocument>),
    Transferring(Arc<SelectedDocument>, Arc<Attempt>),
    Failed(Option<Arc<SelectedDocument>>, UploadFailure),
    Ready(UploadedFile),
}

impl EntryState {
    fn failed(source: &Arc<SelectedDocument>, failure: UploadFailure) -> Self {
        Self::Failed(failure.can_retry().then(|| source.clone()), failure)
    }

    pub(super) fn source(&self) -> Option<&Arc<SelectedDocument>> {
        match self {
            Self::Selected(source) | Self::Transferring(source, _) => Some(source),
            Self::Failed(source, _) => source.as_ref(),
            Self::Ready(_) => None,
        }
    }

    pub(super) fn snapshot(&self) -> UploadState {
        match self {
            Self::Selected(_) => UploadState::Selected,
            Self::Transferring(_, attempt) => match *attempt.progress.borrow() {
                UploadProgress::Reading(bytes_read) => UploadState::Reading {
                    bytes_read,
                    length: attempt.length.get().copied(),
                },
                UploadProgress::Processing(bytes_read) => UploadState::Processing { bytes_read },
            },
            Self::Failed(_, failure) => UploadState::Failed(failure.clone()),
            Self::Ready(file) => UploadState::Ready(file.clone()),
        }
    }

    pub(super) fn cancel(&self) {
        if let Self::Transferring(_, attempt) = self {
            attempt.cancel.cancel();
        }
    }
}

/// Read the server denial shared by the channel and all of its thread drafts.
pub fn channel_upload_denial<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
) -> Result<Option<ChannelUploadDenial>, DraftFilesError> {
    workspace_upload_denial(account(view, rid)?.as_ref(), workspace, draft)
}

pub(super) fn workspace_upload_denial(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
) -> Result<Option<ChannelUploadDenial>, DraftFilesError> {
    with_workspace(account, workspace, |owner| {
        owner
            .state
            .lock()
            .unwrap()
            .channel_denials
            .get(&draft.channel_id)
            .cloned()
    })
}

/// Apply a freshly checked policy to the denial observed before the check.
pub fn confirm_channel_upload<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
    observed_denial: Uuid,
    policy: UploadPolicy,
) -> Result<bool, DraftFilesError> {
    confirm_workspace_upload(
        account(view, rid)?.as_ref(),
        workspace,
        draft,
        observed_denial,
        policy,
    )
}

pub(super) fn confirm_workspace_upload(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
    observed_denial: Uuid,
    policy: UploadPolicy,
) -> Result<bool, DraftFilesError> {
    policy.validate()?;
    with_workspace(account, workspace, |owner| {
        let mut state = owner.state.lock().unwrap();
        if matches!(policy, UploadPolicy::Allowed { .. })
            && state
                .channel_denials
                .get(&draft.channel_id)
                .is_some_and(|denial| denial.revision == observed_denial)
        {
            state.channel_denials.remove(&draft.channel_id);
            true
        } else {
            false
        }
    })
}

/// Start an explicit attempt. The workspace owns it after this function returns.
pub fn start_upload<R: Runtime>(
    view: &Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: &DraftAddress,
    file: Uuid,
    policy: UploadPolicy,
) -> Result<DraftFile, DraftFilesError> {
    start_workspace_upload(account(view, rid)?.as_ref(), workspace, draft, file, policy)
}

pub(super) fn start_workspace_upload(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
    file: Uuid,
    policy: UploadPolicy,
) -> Result<DraftFile, DraftFilesError> {
    policy.validate()?;
    with_workspace(account, workspace, |owner| {
        let mut state = owner.state.lock().unwrap();
        let WorkspaceState {
            drafts,
            channel_denials,
        } = &mut *state;
        let entry = drafts
            .get_mut(draft)
            .into_iter()
            .flatten()
            .find(|entry| entry.id == file)
            .ok_or(DraftFilesError::UnknownFile)?;
        let source = match &entry.state {
            EntryState::Selected(source) | EntryState::Failed(Some(source), _) => source,
            EntryState::Failed(None, _) | EntryState::Transferring(..) | EntryState::Ready(_) => {
                return Ok(entry.info());
            }
        }
        .clone();
        let limit = match (channel_denials.get(&draft.channel_id), policy) {
            (Some(denial), _) => Err(UploadFailure::PermissionDenied(Some(
                denial.response.clone(),
            ))),
            (None, UploadPolicy::Denied) => Err(UploadFailure::PermissionDenied(None)),
            (None, UploadPolicy::Unknown) => Err(UploadFailure::PolicyUnavailable),
            (None, UploadPolicy::Allowed { max_file_bytes })
                if entry
                    .document
                    .size
                    .is_some_and(|size| size > max_file_bytes) =>
            {
                Err(UploadFailure::TooLarge(None))
            }
            (None, UploadPolicy::Allowed { max_file_bytes }) => Ok(max_file_bytes),
        };
        let max_size = match limit {
            Ok(max_size) => max_size,
            Err(failure) => {
                entry.state = EntryState::failed(&source, failure);
                return Ok(entry.info());
            }
        };
        let (report, progress) = watch::channel(UploadProgress::Reading(0));
        let length = entry.document.size.map(OnceLock::from).unwrap_or_default();
        let attempt = Arc::new(Attempt {
            cancel: owner.lifetime.child_token(),
            progress,
            length,
        });
        entry.state = EntryState::Transferring(source.clone(), attempt.clone());
        let snapshot = entry.info();
        let owner = Arc::downgrade(owner);
        let http = account.http.clone();
        let draft = draft.clone();
        tauri::async_runtime::spawn(async move {
            let result = tokio::select! {
                biased;
                _ = attempt.cancel.cancelled() => return,
                result = transfer(&http, &attempt, &draft, source, max_size, report) => result,
            };
            complete(owner, &draft, file, &attempt, result.map_err(Into::into));
        });
        Ok(snapshot)
    })?
}

async fn transfer(
    http: &RestConnection,
    attempt: &Attempt,
    draft: &DraftAddress,
    source: Arc<SelectedDocument>,
    max_size: u64,
    progress: watch::Sender<UploadProgress>,
) -> Result<UploadedFile, FileUploadError> {
    let reader = source
        .open()
        .await
        .map_err(|_| FileUploadError::Source(SourceError::Unreadable))?;
    let length = reader.length;
    let document = source.info();
    if let Some(selected_length) = document.size {
        // Keep a known denominator only if the reopened source agrees with the selection.
        if length != Some(selected_length) {
            return Err(FileUploadError::Source(SourceError::LengthChanged));
        }
    } else if let Some(length) = length {
        attempt.length.get_or_init(|| length);
    }
    http.upload_file(
        UploadFile {
            channel_id: &draft.channel_id,
            purpose: UploadPurpose::Post,
            name: &document.name,
            mime_type: document.mime_type.as_deref(),
            length,
            max_size,
            reader,
        },
        &attempt.cancel,
        progress,
    )
    .await
}

fn complete(
    owner: Weak<Workspace>,
    draft: &DraftAddress,
    file: Uuid,
    attempt: &Arc<Attempt>,
    result: Result<UploadedFile, UploadFailure>,
) {
    let Some(owner) = owner.upgrade() else { return };
    let mut state = owner.state.lock().unwrap();
    if owner.lifetime.is_cancelled() || attempt.cancel.is_cancelled() {
        return;
    }
    let Some(entry) = state
        .drafts
        .get_mut(draft)
        .into_iter()
        .flatten()
        .find(|entry| entry.id == file)
    else {
        return;
    };
    let EntryState::Transferring(source, active) = &entry.state else {
        return;
    };
    if !Arc::ptr_eq(active, attempt) {
        return;
    }
    let denied = match &result {
        Err(UploadFailure::PermissionDenied(Some(response))) => Some(response.clone()),
        _ => None,
    };
    entry.state = match result {
        Ok(receipt) => EntryState::Ready(receipt),
        Err(failure) => EntryState::failed(source, failure),
    };
    if let Some(response) = denied {
        state.channel_denials.insert(
            draft.channel_id.clone(),
            ChannelUploadDenial {
                revision: Uuid::new_v4(),
                response,
            },
        );
    }
}
