//! A new decision from the selected installation before handing an attachment to a mobile viewer.

use super::{RestConnection, TransportError};
use crate::{app_error, native_http::limited_body, sessions::SessionToken};
use reqwest::{Method, Request, Response, StatusCode};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

#[derive(Debug, PartialEq, Eq)]
pub enum MobileFilePolicyError {
    Transport(TransportError),
    Cancelled,
    Server(app_error::PublicError),
    UnexpectedStatus(u16),
    InvalidResponse,
}
impl std::fmt::Display for MobileFilePolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(cause) => cause.fmt(f),
            Self::Cancelled => f.write_str("Mobile file policy check cancelled"),
            Self::Server(public) => write!(
                f,
                "Mattermost refused the mobile file policy request ({})",
                public.status_code
            ),
            Self::UnexpectedStatus(status) => {
                write!(f, "Unexpected mobile file policy status ({status})")
            }
            Self::InvalidResponse => f.write_str("Invalid Mattermost mobile file policy"),
        }
    }
}
impl std::error::Error for MobileFilePolicyError {}

#[derive(Deserialize)]
struct Configuration {
    #[serde(rename = "EnableMobileFileDownload")]
    enabled: String,
}

fn permission(document: &[u8]) -> Result<bool, MobileFilePolicyError> {
    // Serde also accepts a positional array for a struct. The REST contract requires an object.
    if document.iter().find(|byte| !byte.is_ascii_whitespace()) != Some(&b'{') {
        return Err(MobileFilePolicyError::InvalidResponse);
    }
    let parsed = serde_json::from_slice::<Configuration>(document)
        .map_err(|_| MobileFilePolicyError::InvalidResponse)?;
    match parsed.enabled.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(MobileFilePolicyError::InvalidResponse),
    }
}
const MAX_CONFIG_BYTES: usize = 1024 * 1024;

async fn read(mut response: Response, token: &SessionToken) -> Result<bool, MobileFilePolicyError> {
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        return Err(MobileFilePolicyError::Server(
            app_error::read(&mut response, |bytes| token.appears_in(bytes)).await,
        ));
    }
    if status != StatusCode::OK {
        return Err(MobileFilePolicyError::UnexpectedStatus(status.as_u16()));
    }
    let bytes = limited_body(&mut response, MAX_CONFIG_BYTES)
        .await
        .ok_or(MobileFilePolicyError::InvalidResponse)?;
    permission(&bytes)
}

impl RestConnection {
    /// Read the effective mobile export setting for this signed operation.
    /// The caller binds cancellation to the initiating action and its native resource owner.
    pub async fn mobile_file_download_allowed(
        &self,
        cancel: &CancellationToken,
    ) -> Result<bool, MobileFilePolicyError> {
        use MobileFilePolicyError::{Cancelled, Transport};
        let account = self
            .account
            .as_ref()
            .ok_or(Transport(TransportError::SessionUnavailable))?;
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| Transport(TransportError::OutsideInstallation))?
            .pop_if_empty()
            .extend(["api", "v4", "config", "client"]);
        url.set_query(Some("format=old"));
        let mut request = Request::new(Method::GET, url);
        self.check_request(&request).map_err(Transport)?;
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(Cancelled),
            result = account.dispatch(|token| async move {
                token.authorize(&mut request);
                let response = self.http.send(request).await?;
                Ok(read(response, &token).await)
            }) => result.map_err(Transport)?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_string_in_a_complete_object_is_the_only_decision() {
        for bad in [
            "",
            "[]",
            r#"["true"]"#,
            "{}",
            r#"{"EnableMobileFileDownload": true}"#,
            r#"{"EnableMobileFileDownload":{"true":null}}"#,
            r#"{"EnableMobileFileDownload":"yes"}"#,
            r#"{"EnableMobileFileDownload":null}"#,
            r#"{"EnableMobileFileDownload":"true","EnableMobileFileDownload":"false"}"#,
            r#"{"EnableMobileFileDownload":"true"} {}"#,
        ] {
            assert_eq!(
                permission(bad.as_bytes()),
                Err(MobileFilePolicyError::InvalidResponse),
                "{bad}"
            );
        }
        assert_eq!(
            permission(br#" {"unrelated":{}, "EnableMobileFileDownload":"true"}"#),
            Ok(true)
        );
        assert_eq!(
            permission(br#"{"EnableMobileFileDownload":"false"}"#),
            Ok(false)
        );
    }
}
