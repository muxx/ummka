use super::{RestConnection, TransportError, is_mattermost_id};
use crate::app_error::{self, PublicError};
use crate::sessions::SessionToken;
use reqwest::{Request, Response, StatusCode, Url};
use serde::Deserialize;
use std::{fmt, io, sync::LazyLock};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum FileRepresentation {
    #[serde(rename = "GetFile")]
    Original,
    #[serde(rename = "GetFileThumbnail")]
    Thumbnail,
    #[serde(rename = "GetFilePreview")]
    Preview,
}

#[derive(Deserialize)]
struct Route<'a> {
    id: FileRepresentation,
    method: &'a str,
    path: &'a str,
}

static ROUTES: LazyLock<[Route<'static>; 3]> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../contracts/mattermost/native-files.json"
    ))
    .expect("the verified native file catalog must be valid")
});

impl FileRepresentation {
    fn request(self, base: &Url, id: &str) -> Result<Request, TransportError> {
        if !is_mattermost_id(id) {
            return Err(TransportError::OperationDenied);
        }
        let route = ROUTES
            .iter()
            .find(|route| route.id == self)
            .expect("the native catalog defines all three file representations");
        let mut url = base.clone();
        url.path_segments_mut()
            .expect("canonical installation has a host")
            .pop_if_empty()
            .extend(
                route
                    .path
                    .trim_start_matches('/')
                    .split('/')
                    .map(|segment| if segment == "{file_id}" { id } else { segment }),
            );
        Ok(Request::new(
            route.method.parse().expect("verified file method"),
            url,
        ))
    }
}

#[derive(Debug)]
pub enum FileTransferError {
    Transport(TransportError),
    Server {
        error: PublicError,
        history_limited: bool,
    },
    UnexpectedStatus(u16),
    Destination(io::Error),
}

impl fmt::Display for FileTransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(error) => error.fmt(f),
            Self::Server { error, .. } => {
                write!(f, "Attachment request returned HTTP {}", error.status_code)
            }
            Self::UnexpectedStatus(status) => write!(
                f,
                "Expected the complete attachment, received HTTP {status}"
            ),
            Self::Destination(_) => f.write_str("Could not write the attachment"),
        }
    }
}

impl std::error::Error for FileTransferError {}

impl From<TransportError> for FileTransferError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
    }
}

impl RestConnection {
    /// Writes one complete account-scoped representation. Only a flushed destination
    /// is returned. The caller owns disposal of any partial external file on failure.
    pub async fn write_attachment<W: AsyncWrite + Unpin>(
        &self,
        id: &str,
        representation: FileRepresentation,
        destination: W,
        cancel: &CancellationToken,
    ) -> Result<(W, u64), FileTransferError> {
        let account = self
            .account
            .as_ref()
            .ok_or(TransportError::SessionUnavailable)?;
        let mut request = representation.request(&self.base, id)?;
        account
            .dispatch(|token| async move {
                tokio::select! {
                    biased;
                    _ = self.owner.cancelled() => Err(TransportError::OperationInterrupted),
                    _ = cancel.cancelled() => Err(TransportError::OperationInterrupted),
                    result = async {
                        token.authorize(&mut request);
                        let response = self.http.send(request).await?;
                        write_response(response, &token, destination).await
                    } => Ok(result),
                }
            })
            .await?
    }
}

async fn write_response<W: AsyncWrite + Unpin>(
    mut response: Response,
    token: &SessionToken,
    mut destination: W,
) -> Result<(W, u64), FileTransferError> {
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        const NAME: &str = "first-inaccessible-file-time";
        let history_limited = response.headers().get_all(NAME).iter().any(|value| {
            app_error::retention_marker(status, NAME, value.as_bytes())
                && !token.appears_in(value.as_bytes())
        });
        let error = app_error::read(&mut response, |bytes| token.appears_in(bytes)).await;
        return Err(FileTransferError::Server {
            error,
            history_limited,
        });
    }
    if status != StatusCode::OK {
        return Err(FileTransferError::UnexpectedStatus(status.as_u16()));
    }
    let expected = response.content_length();
    let mut written = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| TransportError::Network)?
    {
        destination
            .write_all(&chunk)
            .await
            .map_err(FileTransferError::Destination)?;
        written += chunk.len() as u64;
    }
    if expected.is_some_and(|length| length != written) {
        return Err(TransportError::Network.into());
    }
    destination
        .flush()
        .await
        .map_err(FileTransferError::Destination)?;
    Ok((destination, written))
}
