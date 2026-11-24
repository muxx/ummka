use crate::installation_url::{has_credentials, parse_canonical};
use crate::native_http::NativeHttp;
pub use crate::native_http::TransportError;
use crate::sessions::{AccountSession, AccountSessions, SessionToken, is_credential_header};
use reqwest::header::CONTENT_TYPE;
use reqwest::{Request, Response, Url};
use serde::Deserialize;
use std::sync::{Arc, LazyLock};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum BodyKind {
    Json,
}

#[derive(Deserialize)]
struct Operation<'a> {
    method: &'a str,
    path: &'a str,
    body: Option<BodyKind>,
}

impl Operation<'_> {
    fn allows(&self, method: &reqwest::Method, route: &str) -> bool {
        if self.method != method.as_str() {
            return false;
        }
        let mut segments = route.split('/');
        for expected in self.path.split('/') {
            let Some(actual) = segments.next() else {
                return false;
            };
            let matched = match expected {
                "{user_id}" => actual == "me" || is_mattermost_id(actual),
                "{team_id}" | "{channel_id}" | "{post_id}" => is_mattermost_id(actual),
                literal => actual == literal,
            };
            if !matched {
                return false;
            }
        }
        segments.next().is_none()
    }

    fn accepts_body(&self, request: &Request) -> bool {
        match self.body {
            None => request.body().is_none(),
            Some(BodyKind::Json) => request.body().is_some() && has_json_content_type(request),
        }
    }
}

fn has_json_content_type(request: &Request) -> bool {
    let mut values = request.headers().get_all(CONTENT_TYPE).iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return false;
    };
    let Some(media) = value
        .to_str()
        .ok()
        .and_then(|text| text.parse::<mime::Mime>().ok())
    else {
        return false;
    };
    media == mime::APPLICATION_JSON
        || (media.essence_str() == "application/json"
            && media.params().eq([(mime::CHARSET, mime::UTF_8)]))
}

pub(crate) fn is_mattermost_id(value: &str) -> bool {
    value.len() == 26 && value.bytes().all(|c| c.is_ascii_alphanumeric())
}

static OPERATIONS: LazyLock<Vec<Operation<'static>>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../contracts/mattermost/operations.json"))
        .expect("the verified Mattermost operation catalog must be valid")
});

/// A pool whose requests are bound to the selected installation and REST contract.
pub struct RestConnection {
    base: Url,
    http: NativeHttp,
    account: Option<Arc<AccountSession>>,
}

impl RestConnection {
    /// Accepts the canonical base path produced by the frontend REST transport.
    pub fn new(base: &str) -> Result<Self, TransportError> {
        Self::with_client(base, NativeHttp::new)
    }

    pub(crate) fn with_client(
        base: &str,
        client: impl FnOnce() -> Result<NativeHttp, TransportError>,
    ) -> Result<Self, TransportError> {
        let url = parse_canonical(base).ok_or(TransportError::InvalidInstallation)?;
        Ok(Self {
            base: url,
            http: client()?,
            account: None,
        })
    }

    pub async fn for_account(
        mut self,
        sessions: &AccountSessions,
        user_id: &str,
    ) -> Result<Self, TransportError> {
        self.account = Some(
            sessions
                .restore(self.base.as_str().trim_end_matches('/'), user_id)
                .await?,
        );
        Ok(self)
    }

    /// Ask the selected installation to sign out the login bound to this connection.
    pub async fn sign_out(
        &self,
        sessions: &AccountSessions,
    ) -> Result<crate::authentication::SignOut, TransportError> {
        let session = self
            .account
            .clone()
            .ok_or(TransportError::SessionUnavailable)?;
        let auth = crate::authentication::NativeAuthentication::with_client(
            self.base.as_str().trim_end_matches('/'),
            || Ok(self.http.clone()),
        )?;
        auth.sign_out_account(sessions.clone(), session).await
    }

    /// Complete an explicit on-device sign-out for the login bound to this connection.
    pub async fn sign_out_on_device(
        &self,
        sessions: &AccountSessions,
    ) -> Result<crate::credentials::Removal, TransportError> {
        let session = self
            .account
            .clone()
            .ok_or(TransportError::SessionUnavailable)?;
        sessions.forget_current(session).await
    }

    pub(crate) fn lifetime(&self) -> CancellationToken {
        self.account
            .as_ref()
            .map_or_else(CancellationToken::new, |account| account.lifetime())
    }

    pub async fn send(&self, request: Request) -> Result<Response, TransportError> {
        self.exchange(request, |response, _| response).await
    }

    pub(crate) async fn exchange<T>(
        &self,
        mut request: Request,
        receive: impl FnOnce(Response, Option<(&Arc<AccountSession>, &SessionToken)>) -> T,
    ) -> Result<T, TransportError> {
        self.check_request(&request)?;
        let Some(account) = &self.account else {
            return Ok(receive(self.http.send(request).await?, None));
        };
        account
            .dispatch(|token| async move {
                token.authorize(&mut request);
                Ok(receive(
                    self.http.send(request).await?,
                    Some((account, &token)),
                ))
            })
            .await
    }

    fn check_request(&self, request: &Request) -> Result<(), TransportError> {
        let url = request.url();
        if url.scheme() != self.base.scheme()
            || url.host() != self.base.host()
            || url.port_or_known_default() != self.base.port_or_known_default()
            || has_credentials(url)
            || url.fragment().is_some()
        {
            return Err(TransportError::OutsideInstallation);
        }
        let route = url
            .path()
            .strip_prefix(self.base.path().trim_end_matches('/'))
            .filter(|path| path.starts_with("/api/v4/"))
            .ok_or(TransportError::OutsideInstallation)?;
        if request.headers().keys().any(|header| {
            let name = header.as_str();
            is_credential_header(name)
                || matches!(name, "host" | "content-length" | "transfer-encoding")
        }) || url.query_pairs().any(|(name, _)| name == "access_token")
        {
            return Err(TransportError::OperationDenied);
        }
        let operation = OPERATIONS
            .iter()
            .find(|op| op.allows(request.method(), route))
            .ok_or(TransportError::OperationDenied)?;
        if !operation.accepts_body(request) {
            return Err(TransportError::OperationDenied);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_declared_json_media_type() {
        let connection = RestConnection::new("https://chat.example.test").unwrap();
        let url = "https://chat.example.test/api/v4/users/ids"
            .parse::<Url>()
            .unwrap();
        for (types, allowed) in [
            (vec!["application/json"], true),
            (vec!["Application/JSON; CHARSET=\"UTF-8\""], true),
            (vec![], false),
            (vec!["text/json"], false),
            (vec!["application/json; charset=us-ascii"], false),
            (vec!["application/json; version=1"], false),
            (vec!["application/json", "application/json"], false),
            (
                vec!["application/json; charset=utf-8; charset=utf-8"],
                false,
            ),
        ] {
            let mut request = Request::new(reqwest::Method::POST, url.clone());
            *request.body_mut() = Some(String::new().into());
            for ty in types {
                request
                    .headers_mut()
                    .append(CONTENT_TYPE, ty.parse().unwrap());
            }
            assert_eq!(connection.check_request(&request).is_ok(), allowed);
        }
    }

    #[test]
    fn accepts_canonical_frontend_addresses() {
        for base in [
            "https://chat.example.test",
            "https://chat.example.test:8443/Teams/Blue%20Sky//A%2FB",
            "http://[::1]:8065/a//b%2Fc",
        ] {
            let connection = RestConnection::new(base).expect("valid canonical installation");
            assert_eq!(connection.base.as_str().trim_end_matches('/'), base);
            let url = format!("{base}/api/v4/system/ping?use_rest_semantics=true")
                .parse()
                .unwrap();
            connection
                .check_request(&Request::new(reqwest::Method::GET, url))
                .unwrap();
        }
    }

    #[test]
    fn rejects_invalid_installations_before_creating_the_pool() {
        for base in [
            "",
            "/relative",
            "ftp://chat.example.test",
            "https:///chat",
            "https://CHAT.example.test",
            "https://chat.example.test:443",
            "https://chat.example.test/",
            "https://chat.example.test/team/",
            "https://user:private@chat.example.test",
            "https://@chat.example.test",
            "https://chat.example.test/?",
            "https://chat.example.test/#",
            "https://chat.example.test/?private=query",
            "https://chat.example.test/a%00b",
            " https://chat.example.test",
            "https://chat.example.test/a b",
            "https://chat.example.test:65536",
        ] {
            let Err(error) = RestConnection::with_client(base, || panic!("unexpected pool")) else {
                panic!("invalid installation accepted");
            };
            assert_eq!(error, TransportError::InvalidInstallation);
            assert_eq!(error.to_string(), "Invalid canonical Mattermost server URL");
            assert_eq!(format!("{error:?}"), "InvalidInstallation");
        }
    }
}
