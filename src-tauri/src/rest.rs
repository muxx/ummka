use crate::installation_url::{has_credentials, parse_canonical};
use crate::native_http::NativeHttp;
pub use crate::native_http::TransportError;
use reqwest::header::{COOKIE, HOST};
use reqwest::{Request, Response, Url};
use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
struct Operation<'a> {
    method: &'a str,
    path: &'a str,
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
                "{user_id}" => {
                    actual == "me"
                        || (actual.len() == 26 && actual.bytes().all(|c| c.is_ascii_alphanumeric()))
                }
                literal => actual == literal,
            };
            if !matched {
                return false;
            }
        }
        segments.next().is_none()
    }
}

static OPERATIONS: LazyLock<Vec<Operation<'static>>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../contracts/mattermost/operations.json"))
        .expect("the verified Mattermost operation catalog must be valid")
});

/// A pool whose requests are bound to the selected installation and REST contract.
pub struct RestConnection {
    base: Url,
    http: NativeHttp,
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
        })
    }

    pub async fn send(&self, request: Request) -> Result<Response, TransportError> {
        self.check_request(&request)?;
        self.http.send(request).await
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
        if request.headers().contains_key(HOST)
            || request.headers().contains_key(COOKIE)
            || !OPERATIONS
                .iter()
                .any(|operation| operation.allows(request.method(), route))
        {
            return Err(TransportError::OperationDenied);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
