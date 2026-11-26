//! One authenticated HTTP Upgrade through the existing native connection pool.

use super::{EventCursor, IncomingFrame, StreamError, read_frame};
use crate::{installation_url::has_credentials, native_http::NativeHttp, sessions::SessionToken};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Method, Request, StatusCode, Url};
use reqwest_websocket::{Message, Upgrade, WebSocket};

#[derive(Debug, Eq, PartialEq)]
pub enum EventConnectionError {
    UnsupportedConfiguration,
    InvalidAction,
    SessionUnavailable,
    Http(u16),
    Network,
    Protocol(StreamError),
    History(crate::history::HistoryError),
}

impl std::fmt::Display for EventConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedConfiguration => {
                f.write_str("Unsupported Mattermost WebSocket address")
            }
            Self::InvalidAction => f.write_str("Invalid Mattermost event action"),
            Self::SessionUnavailable => f.write_str("Mattermost session is unavailable"),
            Self::Http(code) => write!(f, "Mattermost WebSocket returned HTTP {code}"),
            Self::Network => f.write_str("Mattermost WebSocket connection failed"),
            Self::Protocol(error) => write!(f, "Invalid Mattermost event: {error:?}"),
            Self::History(error) => write!(f, "Could not apply Mattermost event: {error}"),
        }
    }
}
impl std::error::Error for EventConnectionError {}

/// Values from the installation's client configuration. An explicit URL takes
/// precedence over the port setting in both supported official web clients.
#[derive(Clone, Copy, Default)]
pub struct EventSettings<'a> {
    pub websocket_url: Option<&'a str>,
    pub secure_port: Option<u16>,
}

impl EventSettings<'_> {
    pub(crate) fn request(
        &self,
        base: &Url,
        applied: Option<&EventCursor>,
    ) -> Result<Request, EventConnectionError> {
        use EventConnectionError::UnsupportedConfiguration;
        if base.scheme() != "https" {
            return Err(UnsupportedConfiguration);
        }
        if let Some(explicit) = self.websocket_url.filter(|url| !url.is_empty()) {
            let mut url = Url::parse(explicit).map_err(|_| UnsupportedConfiguration)?;
            if url.scheme() == "wss" {
                url.set_scheme("https")
                    .map_err(|()| UnsupportedConfiguration)?;
            }
            if url.origin() != base.origin()
                || has_credentials(&url)
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path().trim_end_matches('/') != base.path().trim_end_matches('/')
            {
                return Err(UnsupportedConfiguration);
            }
        } else if base.port().is_none() && self.secure_port.is_some_and(|port| port != 443) {
            return Err(UnsupportedConfiguration);
        }
        // Always build from the login's canonical URL, preserving encoded and empty path segments.
        let mut endpoint = base.clone();
        endpoint
            .path_segments_mut()
            .map_err(|()| UnsupportedConfiguration)?
            .pop_if_empty()
            .extend(["api", "v4", "websocket"]);
        endpoint
            .query_pairs_mut()
            .append_pair(
                "connection_id",
                applied.map_or("", EventCursor::connection_id),
            )
            .append_pair(
                "sequence_number",
                &applied.map_or(0, EventCursor::next_sequence).to_string(),
            );
        let mut request = Request::new(Method::GET, endpoint);
        *request.version_mut() = reqwest::Version::HTTP_11;
        Ok(request)
    }
}

/// The consumer supplies its last applied cursor. Reading cannot acknowledge a frame.
pub struct EventReader {
    socket: Option<WebSocket>,
    last_request: i64,
}

impl EventReader {
    pub(crate) async fn run<T>(
        http: &NativeHttp,
        mut request: Request,
        token: &SessionToken,
        consume: impl AsyncFnOnce(&mut Self) -> Result<T, EventConnectionError>,
    ) -> Result<T, EventConnectionError> {
        token.authorize(&mut request);
        let response = http
            .prepare_upgrade(request)
            .upgrade()
            .send()
            .await
            .map_err(|_| EventConnectionError::Network)?;
        if response.status() != StatusCode::SWITCHING_PROTOCOLS {
            return Err(EventConnectionError::Http(response.status().as_u16()));
        }
        let socket = response
            .into_websocket()
            .await
            .map_err(|_| EventConnectionError::Network)?;
        consume(&mut Self {
            socket: Some(socket),
            last_request: 0,
        })
        .await
    }

    /// Send an application ping on this socket. Its reply does not advance the event cursor.
    pub async fn send_ping(&mut self) -> Result<i64, EventConnectionError> {
        self.send_action(|seq| serde_json::json!({"seq": seq, "action": "ping"}))
            .await
    }

    pub async fn send_typing(
        &mut self,
        channel_id: &str,
        root_id: Option<&str>,
    ) -> Result<i64, EventConnectionError> {
        if !crate::rest::is_mattermost_id(channel_id)
            || root_id.is_some_and(|id| !crate::rest::is_mattermost_id(id))
        {
            return Err(EventConnectionError::InvalidAction);
        }
        self.send_action(|seq| {
            serde_json::json!({
                "seq": seq, "action": "user_typing",
                "data": {"channel_id": channel_id, "parent_id": root_id.unwrap_or("")}
            })
        })
        .await
    }

    async fn send_action(
        &mut self,
        message: impl FnOnce(i64) -> serde_json::Value,
    ) -> Result<i64, EventConnectionError> {
        let socket = self.socket.as_mut().ok_or(EventConnectionError::Network)?;
        let seq = self
            .last_request
            .checked_add(1)
            .ok_or(EventConnectionError::Protocol(
                StreamError::SequenceExhausted,
            ))?;
        // A cancelled write may already have put bytes on the wire. Its number is spent.
        self.last_request = seq;
        if socket
            .send(Message::Text(message(seq).to_string()))
            .await
            .is_err()
        {
            self.socket = None;
            return Err(EventConnectionError::Network);
        }
        Ok(seq)
    }

    pub async fn next_frame(
        &mut self,
        applied: Option<&EventCursor>,
    ) -> Result<Option<IncomingFrame>, EventConnectionError> {
        let Some(socket) = self.socket.as_mut() else {
            return Ok(None);
        };
        let result = read_next(socket, applied).await;
        if !matches!(result, Ok(Some(_))) {
            self.socket = None;
        }
        result
    }
}

async fn read_next(
    socket: &mut WebSocket,
    applied: Option<&EventCursor>,
) -> Result<Option<IncomingFrame>, EventConnectionError> {
    loop {
        match socket
            .next()
            .await
            .transpose()
            .map_err(|_| EventConnectionError::Network)?
        {
            Some(Message::Text(text)) => {
                return read_frame(text.as_bytes(), applied)
                    .map(Some)
                    .map_err(EventConnectionError::Protocol);
            }
            Some(Message::Ping(_) | Message::Pong(_)) => continue,
            None | Some(Message::Close { .. }) => return Ok(None),
            Some(Message::Binary(_)) => {
                return Err(EventConnectionError::Protocol(StreamError::InvalidFrame));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_keeps_the_canonical_prefix_and_explicit_port() {
        for (base, explicit, port) in [
            ("https://chat.test", None, None),
            (
                "https://chat.test",
                Some("wss://chat.test:443/"),
                Some(8443),
            ),
            ("https://chat.test:8443", None, Some(443)),
            (
                "https://[::1]:8443/s%20p//A%2FB",
                Some("wss://[::1]:8443/s%20p//A%2FB/"),
                None,
            ),
        ] {
            let base_url = Url::parse(base).unwrap();
            let request = EventSettings {
                websocket_url: explicit,
                secure_port: port,
            }
            .request(&base_url, None)
            .unwrap();
            assert_eq!(
                request.url().as_str(),
                format!("{base}/api/v4/websocket?connection_id=&sequence_number=0")
            );
            assert_eq!(request.version(), reqwest::Version::HTTP_11);
            assert!(request.headers().is_empty());
        }
    }

    #[test]
    fn explicit_addresses_must_resolve_to_the_same_installation() {
        let base = Url::parse("https://chat.example.test/team").unwrap();
        for other in [
            "wss://other.example.test/team",
            "wss://chat.example.test:9999/team",
            "wss://chat.example.test/another",
            "https://chat.example.test/team?x=y",
            "wss://chat.example.test/team#header",
            "ws://chat.example.test/team",
            "wss://a@chat.example.test/team",
            "relative",
            "/team",
        ] {
            let settings = EventSettings {
                websocket_url: Some(other),
                secure_port: None,
            };
            assert_eq!(
                settings.request(&base, None).unwrap_err(),
                EventConnectionError::UnsupportedConfiguration
            );
        }
        assert_eq!(
            EventSettings {
                websocket_url: Some(""),
                secure_port: Some(8443)
            }
            .request(&base, None)
            .unwrap_err(),
            EventConnectionError::UnsupportedConfiguration
        );
        assert!(
            EventSettings::default()
                .request(&Url::parse("http://chat.example.test").unwrap(), None)
                .is_err()
        );
    }
}
