use reqwest::{Client, ClientBuilder, Request, Response, StatusCode};
use std::fmt;

#[cfg(target_os = "android")]
mod android;
#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
mod checks;

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportError {
    InvalidInstallation,
    InvalidAccount,
    InvalidSession,
    SessionUnavailable,
    CredentialStorageUnavailable,
    InvalidStoredCredential,
    OutsideInstallation,
    OperationDenied,
    Redirect,
    CleartextDenied,
    Network,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInstallation => "Invalid canonical Mattermost server URL",
            Self::InvalidAccount => "Invalid Mattermost account ID",
            Self::InvalidSession => "Invalid Mattermost session credential",
            Self::SessionUnavailable => "The Mattermost account session is unavailable",
            Self::CredentialStorageUnavailable => "The platform credential store is unavailable",
            Self::InvalidStoredCredential => "Invalid stored Mattermost credential",
            Self::OutsideInstallation => "REST target is outside the selected installation",
            Self::OperationDenied => "REST operation is not allowed",
            Self::Redirect => "HTTP redirect refused",
            Self::CleartextDenied => "Cleartext HTTP is disabled",
            Self::Network => "HTTP exchange failed",
        })
    }
}

impl std::error::Error for TransportError {}

/// Read only a complete document within the caller's budget, including chunked bodies.
pub(crate) async fn limited_body(response: &mut Response, limit: usize) -> Option<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return None;
    }
    let mut document = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if chunk.len() > limit - document.len() {
            return None;
        }
        document.extend_from_slice(&chunk);
    }
    Some(document)
}

/// A connection pool shared by requests for one Mattermost installation.
#[derive(Clone)]
pub struct NativeHttp(Client);

impl NativeHttp {
    pub fn new() -> Result<Self, TransportError> {
        #[cfg(target_os = "android")]
        if android::ALLOW_APP_CLEARTEXT.get().is_none() {
            return Err(TransportError::Network);
        }
        Self::from_builder(Client::builder())
    }

    pub(crate) fn from_builder(builder: ClientBuilder) -> Result<Self, TransportError> {
        builder
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map(Self)
            .map_err(|_| TransportError::Network)
    }

    /// The caller owns the response stream. Dropping it cancels a pending body read.
    pub async fn send(&self, request: Request) -> Result<Response, TransportError> {
        #[cfg(target_os = "android")]
        if request.url().scheme() == "http" {
            android::check_cleartext(request.url().host_str().ok_or(TransportError::Network)?)?;
        }
        let response = self
            .0
            .execute(request)
            .await
            .map_err(|_| TransportError::Network)?;
        match response.status() {
            StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT => Err(TransportError::Redirect),
            _ => Ok(response),
        }
    }
}
