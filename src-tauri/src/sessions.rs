use crate::installation_url::parse_canonical;
use crate::rest::{TransportError, is_mattermost_id};
use reqwest::header::HeaderValue;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

pub(crate) fn is_credential_header(name: &str) -> bool {
    matches!(
        name,
        "authorization"
            | "proxy-authorization"
            | "token"
            | "cookie"
            | "cookie2"
            | "set-cookie"
            | "set-cookie2"
            | "x-cloud-token"
            | "x-remotecluster-token"
    )
}

#[derive(Eq, Hash, PartialEq)]
pub struct Account {
    installation: String,
    user_id: String,
}

impl Account {
    pub fn new(base: &str, user_id: &str) -> Result<Self, TransportError> {
        validate_installation(base)?;
        if !is_mattermost_id(user_id) {
            return Err(TransportError::InvalidAccount);
        }
        Ok(Self {
            installation: base.to_owned(),
            user_id: user_id.to_owned(),
        })
    }

    pub fn installation(&self) -> &str {
        &self.installation
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }
}

pub(crate) fn validate_installation(base: &str) -> Result<(), TransportError> {
    let url = parse_canonical(base).ok_or(TransportError::InvalidInstallation)?;
    if url.scheme() != "https" {
        return Err(TransportError::CleartextDenied);
    }
    Ok(())
}

#[derive(Clone)]
pub struct SessionToken(HeaderValue);

impl SessionToken {
    pub fn new(raw: &str) -> Result<Self, TransportError> {
        let unpadded = raw.trim_end_matches('=');
        if unpadded.is_empty()
            || !unpadded
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-._~+/".contains(&c))
        {
            return Err(TransportError::InvalidSession);
        }
        let mut header = HeaderValue::from_str(&format!("Bearer {raw}"))
            .map_err(|_| TransportError::InvalidSession)?;
        header.set_sensitive(true);
        Ok(Self(header))
    }

    pub(crate) fn authorize(&self, request: &mut reqwest::Request) {
        request
            .headers_mut()
            .insert(reqwest::header::AUTHORIZATION, self.0.clone());
    }

    pub(crate) fn appears_in(&self, bytes: &[u8]) -> bool {
        let raw = self.secret();
        bytes.windows(raw.len()).any(|part| part == raw)
    }

    pub(crate) fn secret(&self) -> &[u8] {
        &self.0.as_bytes()[b"Bearer ".len()..]
    }
}

pub(crate) struct AccountSession {
    token: RwLock<Option<SessionToken>>,
    end: CancellationToken,
}

impl AccountSession {
    pub(crate) fn lifetime(&self) -> CancellationToken {
        self.end.child_token()
    }

    pub(crate) async fn dispatch<T, F>(
        &self,
        send: impl FnOnce(SessionToken) -> F,
    ) -> Result<T, TransportError>
    where
        F: Future<Output = Result<T, TransportError>>,
    {
        let guard = self.token.read().await;
        let token = guard.as_ref().ok_or(TransportError::SessionUnavailable)?;
        // Retirement cancels the exchange and waits for this read guard before returning.
        tokio::select! {
            biased;
            _ = self.end.cancelled() => Err(TransportError::SessionUnavailable),
            result = async { send(token.clone()).await } => result,
        }
    }
}

/// Active native logins, keyed by the exact installation and Mattermost account.
/// Only a native login or restoration of a verified account can supply a token.
#[derive(Default)]
pub struct AccountSessions {
    entries: Mutex<HashMap<Account, Arc<AccountSession>>>,
}

impl AccountSessions {
    pub async fn activate(
        &self,
        base: &str,
        user_id: &str,
        token: &str,
    ) -> Result<(), TransportError> {
        let account = Account::new(base, user_id)?;
        let session = AccountSession {
            token: RwLock::new(Some(SessionToken::new(token)?)),
            end: CancellationToken::new(),
        };
        self.replace(account, Some(Arc::new(session))).await;
        Ok(())
    }

    pub async fn forget(&self, base: &str, user_id: &str) -> Result<(), TransportError> {
        self.replace(Account::new(base, user_id)?, None).await;
        Ok(())
    }

    async fn replace(&self, account: Account, next: Option<Arc<AccountSession>>) {
        let previous = {
            let mut entries = self.entries.lock().unwrap();
            let previous = match next {
                Some(session) => entries.insert(account, session),
                None => entries.remove(&account),
            };
            if let Some(session) = &previous {
                session.end.cancel();
            }
            previous
        };
        if let Some(session) = previous {
            session.token.write().await.take();
        }
    }

    pub(crate) fn get(
        &self,
        base: &str,
        user_id: &str,
    ) -> Result<Arc<AccountSession>, TransportError> {
        let account = Account::new(base, user_id)?;
        self.entries
            .lock()
            .unwrap()
            .get(&account)
            .cloned()
            .ok_or(TransportError::SessionUnavailable)
    }
}

#[cfg(test)]
mod tests;
