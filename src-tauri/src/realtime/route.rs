use super::EventSettings;
use reqwest::Url;
use serde::{Deserialize, Serialize};

/// The two values from Mattermost's public client configuration. They never enter SQLite.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientEventAddress {
    url: Option<String>,
    secure_port: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EventRoute {
    SameInstallation,
    Unsupported,
}

impl ClientEventAddress {
    pub(crate) fn route(&self, base: &Url) -> EventRoute {
        let Some(url) = self.url.as_deref() else {
            return EventRoute::Unsupported;
        };
        let secure_port = if url.is_empty() && base.port().is_none() {
            let Some(port) = self
                .secure_port
                .as_deref()
                .filter(|value| value.bytes().all(|c| c.is_ascii_digit()))
                .and_then(|value| value.parse::<u16>().ok())
            else {
                return EventRoute::Unsupported;
            };
            Some(port)
        } else {
            None
        };
        let settings = EventSettings {
            websocket_url: Some(url),
            secure_port,
        };
        if settings.request(base, None).is_ok() {
            EventRoute::SameInstallation
        } else {
            EventRoute::Unsupported
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(base: &str, url: Option<&str>, port: Option<&str>) -> EventRoute {
        ClientEventAddress {
            url: url.map(str::to_owned),
            secure_port: port.map(str::to_owned),
        }
        .route(&Url::parse(base).unwrap())
    }

    #[test]
    fn uses_the_selected_installation_and_skips_lower_priority_settings() {
        let base = "https://chat.example.test/team/mattermost";
        let explicit = Some("wss://chat.example.test/team/mattermost/");
        for (base, url, port) in [
            (base, Some(""), Some("443")),
            (base, explicit, None),
            (base, explicit, Some("invalid")),
            ("https://chat.example.test:8443/prefix", Some(""), None),
        ] {
            assert_eq!(resolve(base, url, port), EventRoute::SameInstallation);
        }
    }

    #[test]
    fn unavailable_or_untrusted_settings_do_not_approve_the_installation() {
        let base = "https://chat.example.test/prefix";
        for (url, port) in [
            (None, Some("443")),
            (Some(""), None),
            (Some(""), Some("+443")),
            (Some(""), Some("65536")),
            (Some(""), Some("8443")),
            (Some("wss://events.example.test/prefix"), Some("443")),
            (Some("wss://chat.example.test"), Some("443")),
            (Some("wss://chat.example.test/prefix?x=private"), None),
        ] {
            assert_eq!(resolve(base, url, port), EventRoute::Unsupported);
        }
        assert_eq!(
            resolve("http://chat.example.test", Some(""), Some("443")),
            EventRoute::Unsupported
        );
    }
}
