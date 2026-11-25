//! Handoff between the platform's active system authentication session and the native account.
use super::{AuthError, NativeAuthentication, SignInError};
use crate::installation_url::has_credentials;
use crate::models::SecretInput;
use crate::sessions::{Account, AccountSessions, SessionToken};
use reqwest::{Method, Url};

pub(super) const CALLBACK: &str = "io.github.muxx.ummka.auth://callback";
const MAX_CALLBACK_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum BrowserProvider {
    GitLab,
    Google,
    Office365,
    OpenId,
    Saml,
}

/// Owned by one system browser authentication session. Destruction cancels the pending handoff.
pub struct BrowserSignIn {
    client: NativeAuthentication,
    provider: BrowserProvider,
}

struct ReturnedSession {
    token: SessionToken,
    csrf: SecretInput,
}

impl BrowserSignIn {
    pub fn new(client: NativeAuthentication, provider: BrowserProvider) -> Self {
        Self { client, provider }
    }

    pub fn browser_url(&self) -> Url {
        let route = match self.provider {
            BrowserProvider::GitLab => "/oauth/gitlab/mobile_login",
            BrowserProvider::Google => "/oauth/google/mobile_login",
            BrowserProvider::Office365 => "/oauth/office365/mobile_login",
            BrowserProvider::OpenId => "/oauth/openid/mobile_login",
            BrowserProvider::Saml => "/login/sso/saml",
        };
        let mut url = Url::parse(&format!("{}{route}", self.client.base))
            .expect("canonical installation and fixed sign-in route");
        if self.provider == BrowserProvider::Saml {
            url.query_pairs_mut().append_pair("action", "mobile");
        }
        url.query_pairs_mut().append_pair("redirect_to", CALLBACK);
        url
    }

    /// The OS adapter supplies its own session result. No callback is accepted from a WebView.
    pub async fn complete(
        self,
        sessions: &AccountSessions,
        callback: String,
    ) -> Result<Account, SignInError> {
        let returned = returned_session(&self.client.base, &callback)
            .ok_or(SignInError::Authentication(AuthError::InvalidResponse))?;
        drop(callback);
        let sessions = sessions.clone();
        tauri::async_runtime::spawn(async move {
            // GetUser("me") uses the existing verified GetUser route. The destination always
            // comes from this attempt, including the installation's reverse-proxy prefix.
            let mut request = self.client.request_at(Method::GET, "/api/v4/users/me");
            returned.token.authorize(&mut request);
            let response = self
                .client
                .send(request, |bytes| {
                    returned.token.appears_in(bytes) || returned.csrf.appears_in(bytes)
                })
                .await
                .map_err(SignInError::Authentication)?;
            let grant = self
                .client
                .read_grant(response, returned.token)
                .await
                .map_err(SignInError::Authentication)?;
            self.client.activate_grant(&sessions, grant).await
        })
        .await
        .map_err(|_| SignInError::Interrupted)?
    }
}

fn returned_session(base: &str, raw: &str) -> Option<ReturnedSession> {
    let (address, _) = raw.split_once('?')?;
    if raw.len() > MAX_CALLBACK_BYTES
        || address != CALLBACK
        || raw.contains('#')
        || raw
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
    {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    let mut token = None;
    let mut csrf = None;
    let mut server = None;
    for (name, value) in url.query_pairs() {
        match name.as_ref() {
            "MMAUTHTOKEN" if token.is_none() => token = Some(SessionToken::new(&value).ok()?),
            "MMCSRF" if csrf.is_none() && !value.trim().is_empty() => {
                csrf = Some(SecretInput::new(value.into_owned()));
            }
            "srv" if server.is_none() => server = Some(Url::parse(&value).ok()?),
            "MMAUTHTOKEN" | "MMCSRF" | "srv" | "error" => return None,
            _ => {}
        }
    }
    if let Some(server) = server
        && (has_credentials(&server)
            || server.query().is_some()
            || server.fragment().is_some()
            || server.as_str().trim_end_matches('/') != base)
    {
        return None;
    }
    Some(ReturnedSession {
        token: token?,
        csrf: csrf?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> NativeAuthentication {
        NativeAuthentication::new("https://chat.example.test/Team").unwrap()
    }

    #[test]
    fn starts_each_official_method_under_the_selected_installation() {
        for (provider, suffix) in [
            (BrowserProvider::GitLab, "/oauth/gitlab/mobile_login"),
            (BrowserProvider::Google, "/oauth/google/mobile_login"),
            (BrowserProvider::Office365, "/oauth/office365/mobile_login"),
            (BrowserProvider::OpenId, "/oauth/openid/mobile_login"),
            (BrowserProvider::Saml, "/login/sso/saml"),
        ] {
            let url = BrowserSignIn::new(client(), provider).browser_url();
            assert_eq!(
                url.origin().ascii_serialization(),
                "https://chat.example.test"
            );
            assert_eq!(url.path(), format!("/Team{suffix}"));
            let query: Vec<_> = url.query_pairs().collect();
            assert_eq!(query.last().unwrap().1, CALLBACK);
            assert_eq!(query.last().unwrap().0, "redirect_to");
            if provider == BrowserProvider::Saml {
                assert_eq!(query.len(), 2);
                assert_eq!(query[0], ("action".into(), "mobile".into()));
            } else {
                assert_eq!(query.len(), 1);
            }
        }
    }

    #[test]
    fn accepts_only_a_complete_grant_for_the_selected_installation() {
        let base = "https://chat.example.test/Team";
        let valid = format!("{CALLBACK}?MMAUTHTOKEN=test%2Bsession&MMCSRF=test-value");
        assert_eq!(
            returned_session(base, &valid).unwrap().token.secret(),
            b"test+session"
        );
        let scoped = format!("{valid}&srv=https%3A%2F%2Fchat.example.test%3A443%2FTeam%2F");
        assert!(returned_session(base, &scoped).is_some());
        for extra in [
            "&srv=https://other.example",
            "&srv=https://chat.example.test/team",
            "&srv=https://user@chat.example.test/Team",
            "&srv=https://chat.example.test/Team?extra",
            "&srv=",
            "&srv=https://chat.example.test/Team&srv=https://chat.example.test/Team",
            "&MMAUTHTOKEN=second",
            "&MMCSRF=second",
            "&error=cancelled",
            "#fragment",
        ] {
            assert!(returned_session(base, &format!("{valid}{extra}")).is_none());
        }
        for invalid in [
            valid.replace("://callback", "://user@callback"),
            valid.replace("://callback", "://callback:12"),
            valid.replace("://callback", "://callback/path"),
            valid.replace("://callback", "://other"),
            valid.replace("io.github.muxx.ummka.auth", "https"),
            valid.replace("MMAUTHTOKEN=test%2Bsession", "MMAUTHTOKEN="),
            valid.replace("MMCSRF=test-value", "MMCSRF="),
            valid.replace("&MMCSRF=test-value", ""),
            valid.replace("test%2Bsession", "invalid%0Aheader"),
            format!("{valid}&padding={}", "x".repeat(MAX_CALLBACK_BYTES)),
        ] {
            assert!(returned_session(base, &invalid).is_none());
        }
    }
}
