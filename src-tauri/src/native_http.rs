use reqwest::{Client, ClientBuilder, Request, Response, StatusCode};
use std::fmt;

#[cfg(target_os = "android")]
mod android;
#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
mod checks;

#[derive(Debug, PartialEq, Eq)]
pub enum TransportError {
    Redirect,
    CleartextDenied,
    Network,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Redirect => "HTTP redirect refused",
            Self::CleartextDenied => "Cleartext HTTP is disabled",
            Self::Network => "HTTP exchange failed",
        })
    }
}

impl std::error::Error for TransportError {}

/// A connection pool shared by requests for one Mattermost installation.
pub struct NativeHttp(Client);

impl NativeHttp {
    pub fn new() -> Result<Self, TransportError> {
        #[cfg(target_os = "android")]
        if android::ALLOW_APP_CLEARTEXT.get().is_none() {
            return Err(TransportError::Network);
        }
        Self::from_builder(Client::builder())
    }

    fn from_builder(builder: ClientBuilder) -> Result<Self, TransportError> {
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
