//! The local WebView can address files by their draft and native IDs.
use super::{
    self as files, AddResult, DraftAddress, DraftFile, DraftFilesError, UploadFailure,
    UploadPolicy, UploadState, account, with_workspace,
};
use crate::{
    device_document::{DocumentInfo, picker},
    history::StagePost,
    rest::file_upload::{FileUploadError, SourceError},
};
use serde::{Deserialize, Serialize};
use tauri::{ResourceId, Runtime, Webview, WebviewWindow};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Draft {
    channel_id: String,
    root_id: Option<String>,
}

impl Draft {
    fn address(self) -> Result<DraftAddress, DraftFilesError> {
        DraftAddress::new(self.channel_id, self.root_id)
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Policy {
    Allowed { max_file_bytes: String },
    Denied,
    Unknown,
}

impl Policy {
    fn native(self) -> Result<UploadPolicy, DraftFilesError> {
        Ok(match self {
            Self::Allowed { max_file_bytes } => {
                let limit: i64 = max_file_bytes
                    .parse()
                    .map_err(|_| DraftFilesError::InvalidUploadPolicy)?;
                if limit < 0 || limit.to_string() != max_file_bytes {
                    return Err(DraftFilesError::InvalidUploadPolicy);
                }
                UploadPolicy::Allowed {
                    max_file_bytes: limit as u64,
                }
            }
            Self::Denied => UploadPolicy::Denied,
            Self::Unknown => UploadPolicy::Unknown,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Document {
    name: String,
    size: Option<String>,
    mime_type: Option<String>,
}

impl From<DocumentInfo> for Document {
    fn from(info: DocumentInfo) -> Self {
        Self {
            name: info.name,
            size: info.size.map(|size| size.to_string()),
            mime_type: info.mime_type,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum FailureKind {
    PermissionDenied,
    PolicyUnavailable,
    TooLarge,
    SourceUnavailable,
    Empty,
    Transport,
    Server,
    InvalidFile,
    InvalidReceipt,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Failure {
    kind: FailureKind,
    can_retry: bool,
    status: Option<u16>,
}

impl From<UploadFailure> for Failure {
    fn from(failure: UploadFailure) -> Self {
        let can_retry = failure.can_retry();
        let (kind, status) = match failure {
            UploadFailure::PermissionDenied(response) => (
                FailureKind::PermissionDenied,
                response.map(|error| error.status_code),
            ),
            UploadFailure::PolicyUnavailable => (FailureKind::PolicyUnavailable, None),
            UploadFailure::TooLarge(response) => (
                FailureKind::TooLarge,
                response.map(|error| error.status_code),
            ),
            UploadFailure::Upload(error) => match error {
                FileUploadError::Source(SourceError::Empty) => (FailureKind::Empty, None),
                FileUploadError::Source(SourceError::TooLarge) => (FailureKind::TooLarge, None),
                FileUploadError::Source(SourceError::Unreadable | SourceError::LengthChanged) => {
                    (FailureKind::SourceUnavailable, None)
                }
                FileUploadError::Transport(_) => (FailureKind::Transport, None),
                FileUploadError::Server(error) => (FailureKind::Server, Some(error.status_code)),
                FileUploadError::UnexpectedStatus(status) => (FailureKind::Server, Some(status)),
                FileUploadError::InvalidFile => (FailureKind::InvalidFile, None),
                FileUploadError::InvalidReceipt => (FailureKind::InvalidReceipt, None),
            },
        };
        Self {
            kind,
            can_retry,
            status,
        }
    }
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Transfer {
    Selected,
    Reading {
        bytes_read: String,
        length: Option<String>,
    },
    Processing {
        bytes_read: String,
    },
    Failed {
        failure: Failure,
    },
    Ready {
        id: String,
        name: String,
        size: String,
    },
}

#[derive(Serialize)]
pub(crate) struct FileSnapshot {
    id: Uuid,
    document: Document,
    upload: Transfer,
}

impl From<DraftFile> for FileSnapshot {
    fn from(file: DraftFile) -> Self {
        let upload = match file.upload {
            UploadState::Selected => Transfer::Selected,
            UploadState::Reading { bytes_read, length } => Transfer::Reading {
                bytes_read: bytes_read.to_string(),
                length: length.map(|length| length.to_string()),
            },
            UploadState::Processing { bytes_read } => Transfer::Processing {
                bytes_read: bytes_read.to_string(),
            },
            UploadState::Failed(failure) => Transfer::Failed {
                failure: failure.into(),
            },
            UploadState::Ready(file) => Transfer::Ready {
                id: file.id,
                name: file.name,
                size: file.size.to_string(),
            },
        };
        Self {
            id: file.id,
            document: file.document.into(),
            upload,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Selection {
    Added { file: FileSnapshot },
    Unavailable,
    Empty { document: Document },
    TooLarge { document: Document },
    LimitReached { document: Document },
}

impl From<AddResult> for Selection {
    fn from(result: AddResult) -> Self {
        match result {
            AddResult::Added(file) => Self::Added { file: file.into() },
            AddResult::Unavailable => Self::Unavailable,
            AddResult::Empty(info) => Self::Empty {
                document: info.into(),
            },
            AddResult::TooLarge(info) => Self::TooLarge {
                document: info.into(),
            },
            AddResult::LimitReached(info) => Self::LimitReached {
                document: info.into(),
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum SelectionError {
    Workspace(DraftFilesError),
    Picker(picker::PresentationError),
}

impl From<DraftFilesError> for SelectionError {
    fn from(error: DraftFilesError) -> Self {
        Self::Workspace(error)
    }
}

#[derive(Serialize)]
struct Denial {
    revision: Uuid,
    status: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    files: Vec<FileSnapshot>,
    channel_denial: Option<Denial>,
}

#[tauri::command]
pub(crate) fn open_draft_file_workspace<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<ResourceId, DraftFilesError> {
    files::open(&webview, rid)
}

#[tauri::command]
pub(crate) async fn choose_draft_files<R: Runtime>(
    window: WebviewWindow<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
    policy: Policy,
) -> Result<Vec<Selection>, SelectionError> {
    let webview = window.as_ref();
    let account = account(webview, rid)?;
    let draft = draft.address()?;
    let lifetime = with_workspace(&account, workspace, |owner| {
        if owner
            .state
            .lock()
            .unwrap()
            .channel_denials
            .contains_key(&draft.channel_id)
        {
            Err(DraftFilesError::PermissionDenied)
        } else {
            Ok(owner.lifetime.clone())
        }
    })??;
    let max_file_bytes = match policy.native()? {
        UploadPolicy::Allowed { max_file_bytes } => max_file_bytes,
        UploadPolicy::Denied => return Err(DraftFilesError::PermissionDenied.into()),
        UploadPolicy::Unknown => return Err(DraftFilesError::PolicyUnavailable.into()),
    };
    let selected = picker::pick_for_draft_files(&window, &lifetime)
        .await
        .map_err(SelectionError::Picker)?;
    files::add(
        webview,
        rid,
        workspace,
        &draft,
        max_file_bytes,
        selected
            .into_iter()
            .map(picker::PickedDocument::into_source),
    )
    .await
    .map(|results| results.into_iter().map(Selection::from).collect())
    .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn read_draft_files<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
) -> Result<Snapshot, DraftFilesError> {
    let account = account(&webview, rid)?;
    let draft = draft.address()?;
    with_workspace(&account, workspace, |owner| {
        let state = owner.state.lock().unwrap();
        Snapshot {
            files: state
                .files(&draft)
                .into_iter()
                .map(FileSnapshot::from)
                .collect(),
            channel_denial: state
                .channel_denials
                .get(&draft.channel_id)
                .map(|denial| Denial {
                    revision: denial.revision,
                    status: denial.response.status_code,
                }),
        }
    })
}

#[tauri::command]
pub(crate) async fn start_draft_file_upload<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
    file: Uuid,
    policy: Policy,
) -> Result<FileSnapshot, DraftFilesError> {
    files::start_upload(
        &webview,
        rid,
        workspace,
        &draft.address()?,
        file,
        policy.native()?,
    )
    .map(FileSnapshot::from)
}

#[tauri::command]
pub(crate) async fn remove_draft_file<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
    file: Uuid,
) -> Result<(), DraftFilesError> {
    files::remove(&webview, rid, workspace, &draft.address()?, file)
}

#[tauri::command]
pub(crate) async fn confirm_draft_file_upload_policy<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
    observed_denial: Uuid,
    policy: Policy,
) -> Result<bool, DraftFilesError> {
    files::confirm_channel_upload(
        &webview,
        rid,
        workspace,
        &draft.address()?,
        observed_denial,
        policy.native()?,
    )
}

#[tauri::command]
pub(crate) async fn stage_draft_post_with_files<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
    draft: Draft,
    expected_revision: Option<String>,
    selected: Vec<Uuid>,
) -> Result<StagePost, DraftFilesError> {
    files::stage_post(
        &webview,
        rid,
        workspace,
        draft.address()?,
        expected_revision,
        selected,
    )
    .await
}

#[tauri::command]
pub(crate) async fn close_draft_file_workspace<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    workspace: ResourceId,
) -> Result<(), DraftFilesError> {
    files::close(&webview, rid, workspace)
}
