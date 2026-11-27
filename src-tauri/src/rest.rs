pub mod mobile_file_policy;

use crate::installation_url::{has_credentials, parse_canonical};
use crate::native_http::NativeHttp;
pub use crate::native_http::TransportError;
use crate::sessions::{AccountSession, AccountSessions, SessionToken, is_credential_header};
use reqwest::header::CONTENT_TYPE;
use reqwest::{Request, Response, Url};
use serde::Deserialize;
use std::sync::{Arc, LazyLock};
use tokio_util::sync::CancellationToken;

pub mod file_transfer;
pub mod file_upload;

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
    #[serde(default, rename = "selfOnly")]
    self_only: bool,
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
                "{user_id}" => actual == "me" || (!self.self_only && is_mattermost_id(actual)),
                "{team_id}" | "{channel_id}" | "{post_id}" | "{thread_id}" | "{file_id}" => {
                    is_mattermost_id(actual)
                }
                "{name}" | "{team_name}" | "{channel_name}" => {
                    (1..=64).contains(&actual.len())
                        && actual
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
                }
                "{category_id}" => valid_category_id(actual),
                "{timestamp}" => {
                    // The generated SDK passes Unix milliseconds as a JavaScript number.
                    const JS_MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
                    actual.starts_with(|c: char| matches!(c, '1'..='9'))
                        && actual
                            .parse::<u64>()
                            .is_ok_and(|ms| ms <= JS_MAX_SAFE_INTEGER)
                }
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

// Built-in categories use {kind}_{userID}_{teamID}. Custom categories use a regular ID.
fn valid_category_id(id: &str) -> bool {
    if is_mattermost_id(id) {
        return true;
    }
    let mut parts = id.rsplitn(3, '_');
    matches!((parts.next(), parts.next(), parts.next()),
        (Some(team), Some(user), Some("favorites" | "channels" | "direct_messages"))
        if is_mattermost_id(team) && is_mattermost_id(user) && !id.bytes().any(|b| b.is_ascii_uppercase()))
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
    owner: CancellationToken,
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
            owner: CancellationToken::new(),
        })
    }

    pub async fn for_account(
        mut self,
        sessions: &AccountSessions,
        user_id: &str,
    ) -> Result<Self, TransportError> {
        let session = sessions
            .restore(self.base.as_str().trim_end_matches('/'), user_id)
            .await?;
        self.owner = session.lifetime();
        self.account = Some(session);
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

    /// Start a new event consumer bound to this login and an empty confirmed position.
    pub fn account_events(
        &self,
    ) -> Result<crate::realtime::AccountEvents<'_>, crate::realtime::EventConnectionError> {
        if self.account.is_none() {
            return Err(crate::realtime::EventConnectionError::SessionUnavailable);
        }
        Ok(crate::realtime::AccountEvents::new(self))
    }

    pub(crate) fn event_route(
        &self,
        address: &crate::realtime::ClientEventAddress,
    ) -> crate::realtime::EventRoute {
        address.route(&self.base)
    }

    /// Run one native event connection for the signed account. Dropping the caller's
    /// future or retiring this login closes the socket, including during the handshake.
    pub async fn with_event_stream<T>(
        &self,
        settings: crate::realtime::EventSettings<'_>,
        applied: Option<&crate::realtime::EventCursor>,
        consume: impl AsyncFnOnce(
            &mut crate::realtime::EventReader,
        ) -> Result<T, crate::realtime::EventConnectionError>,
    ) -> Result<T, crate::realtime::EventConnectionError> {
        use crate::realtime::EventConnectionError;
        let account = self
            .account
            .as_ref()
            .ok_or(EventConnectionError::SessionUnavailable)?;
        let request = settings.request(&self.base, applied)?;
        account
            .dispatch(|token| async move {
                Ok(crate::realtime::EventReader::run(&self.http, request, &token, consume).await)
            })
            .await
            .map_err(|_| EventConnectionError::SessionUnavailable)?
    }

    pub(crate) fn lifetime(&self) -> CancellationToken {
        self.owner.clone()
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
        if (operation.self_only && self.account.is_none()) || !operation.accepts_body(request) {
            return Err(TransportError::OperationDenied);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personal_category_writes_accept_custom_and_builtin_ids() {
        let team = "t".repeat(26);
        let user = "u".repeat(26);
        let path = format!("/api/v4/users/me/teams/{team}/channels/categories");
        for category in [
            &team,
            &format!("direct_messages_{user}_{team}"),
            &format!("favorites_{user}_{team}"),
            &format!("channels_{user}_{team}"),
        ] {
            assert!(
                OPERATIONS
                    .iter()
                    .any(|op| op.allows(&reqwest::Method::PUT, &format!("{path}/{category}")))
            );
            assert!(
                OPERATIONS
                    .iter()
                    .any(|op| op.allows(&reqwest::Method::DELETE, &format!("{path}/{category}")))
            );
        }
        for category in [
            "short",
            "order",
            &format!("favorites_{user}_short"),
            &format!("prefix_channels_{user}_{team}"),
            &format!("direct_messages_{}_{team}", user.to_uppercase()),
        ] {
            assert!(
                !OPERATIONS
                    .iter()
                    .any(|op| op.allows(&reqwest::Method::DELETE, &format!("{path}/{category}")))
            );
        }
        for op in OPERATIONS
            .iter()
            .filter(|op| op.path.contains("/channels/categories") && op.method != "GET")
        {
            assert!(op.self_only);
        }
    }

    #[test]
    fn named_channel_requires_two_bounded_name_segments() {
        let get = reqwest::Method::GET;
        let route = |team: &str, channel: &str| {
            format!("/api/v4/teams/name/{team}/channels/name/{channel}")
        };
        let operation = OPERATIONS
            .iter()
            .find(|op| op.allows(&get, &route("team-a", "room_1")))
            .unwrap();
        let team_route = |team: &str| format!("/api/v4/teams/name/{team}");
        let team_operation = OPERATIONS
            .iter()
            .find(|op| op.allows(&get, &team_route("team-a")))
            .unwrap();
        let limit = "r".repeat(64);
        assert!(team_operation.allows(&get, &team_route(&limit)));
        assert!(!team_operation.allows(&reqwest::Method::POST, &team_route("team-a")));
        assert!(operation.allows(&get, &route(&limit, &limit)));
        assert!(!operation.allows(&reqwest::Method::POST, &route("team-a", "room_1")));
        for bad in ["", "two/names", "a%2Fb", "with.dot", "☃", &"a".repeat(65)] {
            assert!(!team_operation.allows(&get, &team_route(bad)), "{bad}");
            assert!(!operation.allows(&get, &route(bad, "room_1")), "{bad}");
            assert!(!operation.allows(&get, &route("team-a", bad)), "{bad}");
        }
    }

    #[test]
    fn file_metadata_requires_a_concrete_file_id_and_exact_route() {
        let base = "https://chat.example.test/team/chat";
        let connection = RestConnection::new(base).unwrap();
        let id = "f".repeat(26);
        for (method, route, allowed) in [
            (
                reqwest::Method::GET,
                format!("/api/v4/files/{id}/info"),
                true,
            ),
            (
                reqwest::Method::POST,
                format!("/api/v4/files/{id}/info"),
                false,
            ),
            (
                reqwest::Method::GET,
                format!("/api/v4/files/{id}/info/more"),
                false,
            ),
            (
                reqwest::Method::GET,
                "/api/v4/files/me/info".to_owned(),
                false,
            ),
        ] {
            let request = Request::new(method, Url::parse(&format!("{base}{route}")).unwrap());
            assert_eq!(
                connection.check_request(&request).is_ok(),
                allowed,
                "{route}"
            );
        }
    }

    #[test]
    fn file_reads_and_uploads_are_reserved_for_native_transfer() {
        let base = "https://fixture.test/team/chat";
        let connection = RestConnection::new(base).unwrap();
        #[derive(Deserialize)]
        struct NativeRoute<'a> {
            method: &'a str,
            path: &'a str,
        }
        let routes: Vec<NativeRoute<'_>> =
            serde_json::from_str(include_str!("../../contracts/mattermost/native-files.json"))
                .unwrap();
        let uploads: Vec<NativeRoute<'_>> = serde_json::from_str(include_str!(
            "../../contracts/mattermost/native-uploads.json"
        ))
        .unwrap();
        for route in routes.into_iter().chain(uploads) {
            let path = route.path.replace("{file_id}", &"f".repeat(26));
            let url = Url::parse(&format!("{base}{path}")).unwrap();
            let request = Request::new(route.method.parse().unwrap(), url);
            assert_eq!(
                connection.check_request(&request),
                Err(TransportError::OperationDenied)
            );
        }
    }

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
    fn thread_follow_requires_a_signed_self_route_and_an_empty_body() {
        let base = "https://fixture.test/sub";
        let connection = RestConnection::new(base).unwrap();
        let team = "t".repeat(26);
        let root = "r".repeat(26);
        let path = |user: &str, thread: &str| {
            format!("/api/v4/users/{user}/teams/{team}/threads/{thread}/following")
        };
        let route = path("me", &root);
        for method in [reqwest::Method::PUT, reqwest::Method::DELETE] {
            let operation = OPERATIONS
                .iter()
                .find(|op| op.allows(&method, &route))
                .unwrap();
            assert!(operation.self_only);
            assert!(!operation.allows(&method, &path(&"u".repeat(26), &root)));
            assert!(!operation.allows(&method, &path("me", "short")));
            let mut request = Request::new(method, Url::parse(&format!("{base}{route}")).unwrap());
            assert!(operation.accepts_body(&request));
            assert_eq!(
                connection.check_request(&request),
                Err(TransportError::OperationDenied)
            );
            *request.body_mut() = Some("{}".into());
            assert!(!operation.accepts_body(&request));
        }
    }

    #[test]
    fn thread_read_accepts_only_positive_exact_milliseconds_and_own_bodyless_puts() {
        let team = "t".repeat(26);
        let root = "r".repeat(26);
        let prefix = format!("/api/v4/users/me/teams/{team}/threads");
        let single = format!("{prefix}/{root}/read");
        let put = reqwest::Method::PUT;
        let supported = |route: &str| OPERATIONS.iter().find(|op| op.allows(&put, route));
        for time in ["1", "1700000000123", "9007199254740991"] {
            assert!(supported(&format!("{single}/{time}")).is_some(), "{time}");
        }
        for time in [
            "",
            "0",
            "-1",
            "+1",
            "01",
            "1.5",
            "1e3",
            "%31",
            "9007199254740992",
            "18446744073709551616",
        ] {
            assert!(supported(&format!("{single}/{time}")).is_none(), "{time}");
        }
        let connection = RestConnection::new("https://fixture.test/sub").unwrap();
        for route in [format!("{single}/1"), format!("{prefix}/read")] {
            let operation = supported(&route).unwrap();
            assert!(operation.self_only);
            assert!(!operation.allows(&reqwest::Method::POST, &route));
            assert!(!operation.allows(&put, &route.replace("/me/", &format!("/{root}/"))));
            assert!(!operation.allows(&put, &route.replace(&team, "short")));
            assert!(!operation.allows(&put, &format!("{route}/extra")));
            let url = Url::parse(&format!("https://fixture.test/sub{route}")).unwrap();
            let mut request = Request::new(put.clone(), url);
            assert!(operation.accepts_body(&request));
            assert_eq!(
                connection.check_request(&request),
                Err(TransportError::OperationDenied)
            );
            *request.body_mut() = Some("{}".into());
            assert!(!operation.accepts_body(&request));
        }
        assert!(supported(&format!("{prefix}/short/read/1")).is_none());
    }

    #[test]
    fn personal_notification_changes_require_a_signed_connection_and_self_route() {
        let base = "https://fixture.test/sub";
        let connection = RestConnection::new(base).unwrap();
        let members = format!("/api/v4/channels/{}/members", "c".repeat(26));
        let route = format!("{members}/me/notify_props");
        let operation = OPERATIONS
            .iter()
            .find(|op| op.allows(&reqwest::Method::PUT, &route))
            .unwrap();
        assert!(operation.self_only);
        assert!(!operation.allows(&reqwest::Method::PATCH, &route));
        assert!(!operation.allows(&reqwest::Method::PUT, &format!("{route}/more")));
        assert!(!operation.allows(
            &reqwest::Method::PUT,
            &format!("{members}/{}/notify_props", "u".repeat(26))
        ));
        let mut request = Request::new(
            reqwest::Method::PUT,
            Url::parse(&format!("{base}{route}")).unwrap(),
        );
        *request.body_mut() = Some("{}".into());
        request
            .headers_mut()
            .insert(CONTENT_TYPE, "application/json".parse().unwrap());
        assert!(operation.accepts_body(&request));
        assert!(matches!(
            connection.check_request(&request),
            Err(TransportError::OperationDenied)
        ));
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
