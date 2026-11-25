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
                "{emoji_name}" => valid_emoji_name(actual),
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

// Mattermost emoji names are 1–64 ASCII bytes. A plus is encoded as %2B by the SDK.
fn valid_emoji_name(segment: &str) -> bool {
    let mut length = 0;
    for byte in percent_encoding::percent_decode_str(segment) {
        length += 1;
        if length > 64 || !(byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_')) {
            return false;
        }
    }
    length != 0
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

    /// Open local history for the confirmed durable login bound to this connection.
    pub async fn open_history(
        &self,
        sessions: &AccountSessions,
    ) -> Result<crate::history::AccountHistory, TransportError> {
        let session = self
            .account
            .clone()
            .ok_or(TransportError::SessionUnavailable)?;
        sessions.open_history(session).await
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
    fn reaction_deletion_requires_one_valid_decoded_name() {
        let base = "https://fixture.test/sub";
        let connection = RestConnection::new(base).unwrap();
        let post = "p".repeat(26);
        let prefix = format!("{base}/api/v4/users/me/posts/{post}/reactions/");
        let limit = "a".repeat(64);
        let over = "a".repeat(65);
        for (name, allowed) in [
            ("%2B1", true),
            ("%2b1", true),
            ("+1", true),
            ("-1", true),
            ("party_parrot", true),
            ("%41", true),
            (&limit, true),
            (&over, false),
            ("", false),
            ("two/names", false),
            ("two%2Fnames", false),
            ("%252B1", false),
            ("%", false),
            ("%20", false),
            ("a.b", false),
            ("%C3%A9", false),
        ] {
            let url = Url::parse(&format!("{prefix}{name}")).unwrap();
            assert_eq!(
                connection
                    .check_request(&Request::new(reqwest::Method::DELETE, url))
                    .is_ok(),
                allowed,
                "name {name}"
            );
        }
    }

    #[test]
    fn individual_membership_changes_match_only_exact_routes() {
        let base = "https://chat.example.test/team/chat";
        let connection = RestConnection::new(base).unwrap();
        let channel = "c".repeat(26);
        let user = "u".repeat(26);
        let members = format!("/api/v4/channels/{channel}/members");
        for (method, path, allowed) in [
            (reqwest::Method::POST, members.clone(), true),
            (reqwest::Method::DELETE, format!("{members}/{user}"), true),
            (reqwest::Method::DELETE, format!("{members}/"), false),
            (reqwest::Method::POST, format!("{members}/{user}"), false),
            (
                reqwest::Method::POST,
                "/api/v4/channels//members".into(),
                false,
            ),
        ] {
            let url = Url::parse(&format!("{base}{path}")).unwrap();
            let mut request = Request::new(method, url);
            if request.method() == reqwest::Method::POST {
                *request.body_mut() = Some(format!(r#"{{"user_id":"{user}"}}"#).into());
                request.headers_mut().insert(
                    CONTENT_TYPE,
                    reqwest::header::HeaderValue::from_static("application/json"),
                );
            }
            assert_eq!(
                connection.check_request(&request).is_ok(),
                allowed,
                "{path}"
            );
        }
    }

    #[test]
    fn reactions_are_read_by_post_id_in_the_selected_installation() {
        let base = "https://chat.example.test/team/chat";
        let connection = RestConnection::new(base).unwrap();
        let post = "p".repeat(26);
        for (method, path, allowed) in [
            (
                reqwest::Method::GET,
                format!("/api/v4/posts/{post}/reactions"),
                true,
            ),
            (
                reqwest::Method::DELETE,
                format!("/api/v4/posts/{post}/reactions"),
                false,
            ),
            (
                reqwest::Method::POST,
                format!("/api/v4/posts/{post}/reactions"),
                false,
            ),
            (
                reqwest::Method::GET,
                "/api/v4/posts/me/reactions".into(),
                false,
            ),
            (
                reqwest::Method::GET,
                format!("/api/v4/posts/{post}/reactions/"),
                false,
            ),
        ] {
            let url = Url::parse(&format!("{base}{path}")).unwrap();
            assert_eq!(
                connection.check_request(&Request::new(method, url)).is_ok(),
                allowed
            );
        }
    }

    #[test]
    fn command_picker_routes_are_scoped_to_the_installation_and_team() {
        let base = "https://chat.example.test/workspace";
        let connection = RestConnection::new(base).unwrap();
        let team = "t".repeat(26);
        let commands = format!("/api/v4/teams/{team}/commands");
        for (path, allowed) in [
            (format!("{commands}/autocomplete"), true),
            (
                format!("{commands}/autocomplete_suggestions?user_input=%2Fhe&channel_id={team}"),
                true,
            ),
            ("/api/v4/commands".to_owned(), false),
            (format!("/api/v4/commands/{team}"), false),
            (format!("{commands}/autocomplete/extra"), false),
        ] {
            let url = format!("{base}{path}").parse().unwrap();
            assert_eq!(
                connection
                    .check_request(&Request::new(reqwest::Method::GET, url))
                    .is_ok(),
                allowed
            );
        }
    }

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
