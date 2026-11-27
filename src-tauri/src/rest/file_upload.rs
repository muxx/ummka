use super::{RestConnection, is_mattermost_id};
use crate::{
    app_error::{self, PublicError},
    native_http::{TransportError, limited_body},
    sessions::SessionToken,
};
use futures_util::{StreamExt, stream};
use reqwest::{Body, Request, Response, StatusCode, multipart};
use serde::Deserialize;
use serde_json::Value;
use std::{fmt, io, sync::LazyLock};
use tokio::{
    io::AsyncRead,
    sync::{oneshot, watch},
};
use tokio_util::{io::ReaderStream, sync::CancellationToken};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadPurpose {
    Post,
    Bookmark,
}

/// An already opened source. Some system document providers cannot report a length.
pub struct UploadFile<'a, R> {
    pub channel_id: &'a str,
    pub purpose: UploadPurpose,
    pub name: &'a str,
    pub mime_type: Option<&'a str>,
    pub length: Option<u64>,
    pub max_size: u64,
    pub reader: R,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadProgress {
    Reading(u64),
    Processing(u64),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadedFile {
    pub id: String,
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceError {
    Empty,
    TooLarge,
    LengthChanged,
    Unreadable,
}
impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Empty => "The selected file is empty",
            Self::TooLarge => "The selected file exceeds the installation limit",
            Self::LengthChanged => "The selected file changed during upload",
            Self::Unreadable => "Could not read the selected file",
        })
    }
}
impl std::error::Error for SourceError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileUploadError {
    Transport(TransportError),
    InvalidFile,
    Source(SourceError),
    Server(PublicError),
    UnexpectedStatus(u16),
    InvalidReceipt,
}
impl fmt::Display for FileUploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(e) => e.fmt(f),
            Self::InvalidFile => f.write_str("Invalid file metadata"),
            Self::Source(e) => e.fmt(f),
            Self::Server(e) => write!(f, "File upload returned HTTP {}", e.status_code),
            Self::UnexpectedStatus(code) => write!(f, "Unexpected file upload status {code}"),
            Self::InvalidReceipt => f.write_str("Could not confirm the uploaded file"),
        }
    }
}
impl std::error::Error for FileUploadError {}
impl From<TransportError> for FileUploadError {
    fn from(e: TransportError) -> Self {
        Self::Transport(e)
    }
}

#[derive(Deserialize)]
struct Route<'a> {
    method: &'a str,
    path: &'a str,
}
static ROUTE: LazyLock<[Route<'static>; 1]> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../contracts/mattermost/native-uploads.json"
    ))
    .expect("verified native upload contract")
});

pub(crate) fn file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && !name.chars().any(char::is_control)
}

/// The transport polls this body on demand. Only the current read buffer and a progress snapshot
/// are retained. The completion signal distinguishes a source failure from a network failure.
fn stream_file<R: AsyncRead + Send + Unpin + 'static>(
    reader: R,
    length: Option<u64>,
    limit: u64,
    stop: CancellationToken,
    progress: watch::Sender<UploadProgress>,
) -> (Body, oneshot::Receiver<Result<(), SourceError>>) {
    let (done, result) = oneshot::channel();
    let reader = ReaderStream::with_capacity(reader, 64 * 1024);
    let stream = stream::try_unfold((reader, 0_u64, done), move |(mut reader, count, done)| {
        let stop = stop.clone();
        let progress = progress.clone();
        async move {
            let next = tokio::select! {
                biased;
                _ = stop.cancelled() => return Err(io::ErrorKind::Interrupted.into()),
                part = reader.next() => part,
            };
            let failure = match next {
                Some(Ok(bytes)) => {
                    let next = count.saturating_add(bytes.len() as u64);
                    if next > limit {
                        SourceError::TooLarge
                    } else if length.is_some_and(|len| next > len) {
                        SourceError::LengthChanged
                    } else {
                        progress.send_replace(UploadProgress::Reading(next));
                        return Ok(Some((bytes, (reader, next, done))));
                    }
                }
                Some(Err(_)) => SourceError::Unreadable,
                None if count == 0 => SourceError::Empty,
                None if length.is_some_and(|len| count != len) => SourceError::LengthChanged,
                None => {
                    progress.send_replace(UploadProgress::Processing(count));
                    let _ = done.send(Ok(()));
                    return Ok(None);
                }
            };
            let _ = done.send(Err(failure));
            Err(io::Error::other(failure))
        }
    });
    (Body::wrap_stream(stream), result)
}

impl RestConnection {
    pub async fn upload_file<R: AsyncRead + Send + Unpin + 'static>(
        &self,
        file: UploadFile<'_, R>,
        cancel: &CancellationToken,
        progress: watch::Sender<UploadProgress>,
    ) -> Result<UploadedFile, FileUploadError> {
        let account = self
            .account
            .as_ref()
            .ok_or(TransportError::SessionUnavailable)?;
        if !is_mattermost_id(file.channel_id) {
            return Err(TransportError::OperationDenied.into());
        }
        if !file_name(file.name) {
            return Err(FileUploadError::InvalidFile);
        }
        if file.length == Some(0) {
            return Err(FileUploadError::Source(SourceError::Empty));
        }
        let limit = file.max_size.min(i64::MAX as u64);
        if file.length.is_some_and(|n| n > limit) {
            return Err(FileUploadError::Source(SourceError::TooLarge));
        }
        let stop = cancel.child_token();
        let _on_drop = stop.clone().drop_guard();
        let (body, mut source) =
            stream_file(file.reader, file.length, limit, stop.clone(), progress);
        let part = match file.length {
            Some(length) => multipart::Part::stream_with_length(body, length),
            None => multipart::Part::stream(body),
        }
        .file_name(file.name.to_owned())
        .mime_str(file.mime_type.unwrap_or("application/octet-stream"))
        .map_err(|_| FileUploadError::InvalidFile)?;
        let client_id = Uuid::new_v4().to_string();
        let form = multipart::Form::new()
            .text("channel_id", file.channel_id.to_owned())
            .text("client_ids", client_id.clone())
            .part("files", part);
        let route = &ROUTE[0];
        let mut url = self.base.clone();
        url.path_segments_mut()
            .expect("canonical installation")
            .pop_if_empty()
            .extend(route.path.trim_start_matches('/').split('/'));
        if file.purpose == UploadPurpose::Bookmark {
            url.query_pairs_mut().append_pair("bookmark", "true");
        }
        let mut request = self
            .http
            .prepare(Request::new(
                route.method.parse().expect("verified upload method"),
                url,
            ))
            .multipart(form)
            .build()
            .map_err(|_| FileUploadError::InvalidFile)?;
        let owner = match file.purpose {
            UploadPurpose::Post => account.account().user_id(),
            UploadPurpose::Bookmark => "bookmark",
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(TransportError::OperationInterrupted.into()),
            _ = self.owner.cancelled() => Err(TransportError::OperationInterrupted.into()),
            reply = account.dispatch(|token| async move {
                token.authorize(&mut request);
                let response = self.http.send(request).await;
                stop.cancel();
                let completed = match source.try_recv() {
                    Ok(Err(error)) => return Ok(Err(FileUploadError::Source(error))),
                    Ok(Ok(())) => true,
                    Err(_) => false,
                };
                let result = read_receipt(response?, &token, &client_id, file.channel_id, owner, completed).await;
                Ok(result)
            }) => reply?,
        }
    }
}

async fn read_receipt(
    mut response: Response,
    token: &SessionToken,
    client_id: &str,
    channel: &str,
    owner: &str,
    completed: bool,
) -> Result<UploadedFile, FileUploadError> {
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        return Err(FileUploadError::Server(
            app_error::read(&mut response, |b| token.appears_in(b)).await,
        ));
    }
    if status != StatusCode::CREATED {
        return Err(FileUploadError::UnexpectedStatus(status.as_u16()));
    }
    if !completed {
        return Err(FileUploadError::InvalidReceipt);
    }
    let document = limited_body(&mut response, 1024 * 1024)
        .await
        .ok_or(FileUploadError::InvalidReceipt)?;
    parse_receipt(&document, token, client_id, channel, owner)
        .ok_or(FileUploadError::InvalidReceipt)
}

fn parse_receipt(
    document: &[u8],
    token: &SessionToken,
    client_id: &str,
    channel: &str,
    owner: &str,
) -> Option<UploadedFile> {
    let data: Value = serde_json::from_slice(document).ok()?;
    let [echo] = data.get("client_ids")?.as_array()?.as_slice() else {
        return None;
    };
    let [file] = data.get("file_infos")?.as_array()?.as_slice() else {
        return None;
    };
    if echo.as_str()? != client_id
        || file.get("channel_id")?.as_str()? != channel
        || file.get("user_id")?.as_str()? != owner
        || file
            .get("post_id")
            .is_some_and(|v| !v.is_null() && v.as_str() != Some(""))
    {
        return None;
    }
    let id = file.get("id")?.as_str()?;
    let name = file.get("name")?.as_str()?;
    if !is_mattermost_id(id)
        || !file_name(name)
        || token.appears_in(id.as_bytes())
        || token.appears_in(name.as_bytes())
    {
        return None;
    }
    Some(UploadedFile {
        id: id.to_owned(),
        name: name.to_owned(),
        size: file.get("size")?.as_u64()?,
    })
}

#[cfg(test)]
mod tests;

#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
pub(crate) mod checks;
