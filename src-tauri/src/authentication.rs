//! Mattermost's credential-bearing exchanges are available only to the native host.
use crate::app_error;
pub use crate::app_error::PublicError;
use crate::models::LoginRequest;
use crate::native_http::NativeHttp;
use crate::rest::TransportError;
use crate::sessions::{Account, SessionToken, contains_secret, validate_installation};
use reqwest::{Method, Request, Response, StatusCode, header};
use serde::{Deserialize, de::DeserializeOwned};
use std::{fmt, sync::LazyLock, time::Duration};

const AUTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_AUTH_RESPONSE_BYTES: usize = 1024 * 1024;

#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
pub(crate) mod checks;
pub mod form;
mod sign_in;
mod sign_out;
pub use sign_in::{Revocation, SignInError};
pub use sign_out::SignOut;

#[derive(Debug, Eq, PartialEq)]
pub enum AuthError {
    Transport(TransportError),
    Server(PublicError),
    InvalidResponse,
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(error) => error.fmt(f),
            Self::Server(error) => write!(
                f,
                "Mattermost authentication returned HTTP {}",
                error.status_code
            ),
            Self::InvalidResponse => f.write_str("Invalid Mattermost authentication response"),
        }
    }
}

impl std::error::Error for AuthError {}

impl From<TransportError> for AuthError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
    }
}

pub struct LoginGrant {
    account: Account,
    token: SessionToken,
}

impl LoginGrant {
    pub fn account(&self) -> &Account {
        &self.account
    }
}

#[derive(Deserialize, Eq, PartialEq)]
enum Operation {
    Login,
    Logout,
}

#[derive(Deserialize)]
struct Route<'a> {
    id: Operation,
    path: &'a str,
    method: &'a str,
}

static ROUTES: LazyLock<[Route<'static>; 2]> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../contracts/mattermost/native-auth.json"))
        .expect("the verified native authentication catalog must be valid")
});

#[derive(Clone)]
pub struct NativeAuthentication {
    base: String,
    http: NativeHttp,
}

impl NativeAuthentication {
    pub fn new(base: &str) -> Result<Self, TransportError> {
        Self::with_client(base, NativeHttp::new)
    }

    pub(crate) fn with_client(
        base: &str,
        client: impl FnOnce() -> Result<NativeHttp, TransportError>,
    ) -> Result<Self, TransportError> {
        validate_installation(base)?;
        Ok(Self {
            base: base.into(),
            http: client()?,
        })
    }

    fn request(&self, operation: Operation) -> Request {
        let route = ROUTES
            .iter()
            .find(|route| route.id == operation)
            .expect("missing native authentication operation");
        let method = Method::from_bytes(route.method.as_bytes()).expect("verified HTTP method");
        let url = format!("{}{}", self.base, route.path)
            .parse()
            .expect("canonical installation and verified route");
        let mut request = Request::new(method, url);
        *request.timeout_mut() = Some(AUTH_REQUEST_TIMEOUT);
        request
    }

    pub async fn login(&self, input: &LoginRequest) -> Result<LoginGrant, AuthError> {
        #[derive(Deserialize)]
        struct Identity {
            id: String,
        }

        let mut request = self.request(Operation::Login);
        request.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        *request.body_mut() = Some(
            serde_json::to_vec(input)
                .expect("login input contains only optional strings")
                .into(),
        );
        let response = self
            .send(request, |bytes| {
                [&input.password, &input.token]
                    .into_iter()
                    .flatten()
                    .any(|field| field.appears_in(bytes))
            })
            .await?;
        let mut values = response.headers().get_all("token").iter();
        let token = values
            .next()
            .and_then(|v| v.to_str().ok())
            .and_then(|v| SessionToken::new(v).ok())
            .ok_or(AuthError::InvalidResponse)?;
        if values.next().is_some() {
            return Err(AuthError::InvalidResponse);
        }
        let identity: Identity = body(response).await?;
        let account =
            Account::new(&self.base, &identity.id).map_err(|_| AuthError::InvalidResponse)?;
        Ok(LoginGrant { account, token })
    }

    pub async fn logout(&self, grant: &LoginGrant) -> Result<(), AuthError> {
        self.logout_session(&grant.account, &grant.token).await
    }

    async fn logout_session(
        &self,
        account: &Account,
        token: &SessionToken,
    ) -> Result<(), AuthError> {
        #[derive(Deserialize)]
        struct Acknowledgment {
            status: String,
        }

        if account.installation() != self.base {
            return Err(TransportError::OutsideInstallation.into());
        }
        let mut request = self.request(Operation::Logout);
        token.authorize(&mut request);
        let response = self.send(request, |bytes| token.appears_in(bytes)).await?;
        let result: Acknowledgment = body(response).await?;
        if result.status != "OK" {
            return Err(AuthError::InvalidResponse);
        }
        Ok(())
    }

    async fn send(
        &self,
        request: Request,
        sensitive: impl Fn(&[u8]) -> bool,
    ) -> Result<Response, AuthError> {
        let mut response = self.http.send(request).await?;
        let status = response.status();
        if status.is_client_error() || status.is_server_error() {
            let returned: Vec<_> = response
                .headers()
                .get_all("token")
                .iter()
                .cloned()
                .collect();
            let error = app_error::read(&mut response, |bytes| {
                sensitive(bytes)
                    || returned
                        .iter()
                        .any(|v| contains_secret(bytes, v.as_bytes()))
            })
            .await;
            return Err(AuthError::Server(error));
        }
        if status != StatusCode::OK {
            return Err(AuthError::InvalidResponse);
        }
        Ok(response)
    }
}

async fn body<T: DeserializeOwned>(mut response: Response) -> Result<T, AuthError> {
    let bytes = crate::native_http::limited_body(&mut response, MAX_AUTH_RESPONSE_BYTES)
        .await
        .ok_or(AuthError::InvalidResponse)?;
    serde_json::from_slice(&bytes).map_err(|_| AuthError::InvalidResponse)
}
