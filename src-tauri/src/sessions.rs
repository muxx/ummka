use crate::credentials::{CredentialError, CredentialStore, Removal};
use crate::installation_url::parse_canonical;
use crate::rest::{TransportError, is_mattermost_id};
use reqwest::header::HeaderValue;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

pub(crate) fn contains_secret(bytes: &[u8], secret: &[u8]) -> bool {
    !secret.is_empty() && bytes.windows(secret.len()).any(|part| part == secret)
}

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

#[derive(Clone, Eq, Hash, PartialEq)]
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
        contains_secret(bytes, self.secret())
    }

    pub(crate) fn secret(&self) -> &[u8] {
        &self.0.as_bytes()[b"Bearer ".len()..]
    }
}

pub(crate) struct AccountSession {
    account: Account,
    token: RwLock<Option<SessionToken>>,
    end: CancellationToken,
}

impl AccountSession {
    pub(crate) fn account(&self) -> &Account {
        &self.account
    }

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

/// Native state for one application. A worker serializes durable changes and restoration.
/// Requests on an active account use only that session's in-memory generation.
#[derive(Clone)]
pub struct AccountSessions(Arc<SessionState>);

struct SessionState {
    entries: Mutex<HashMap<Account, Arc<AccountSession>>>,
    changes: Mutex<()>,
    open_store: Box<dyn Fn() -> Result<Box<dyn CredentialStore>, CredentialError> + Send + Sync>,
}

impl SessionState {
    fn active(&self, account: &Account) -> Option<Arc<AccountSession>> {
        self.entries.lock().unwrap().get(account).cloned()
    }

    // Called on a blocking worker under the lifecycle lock, after a confirmed storage operation.
    fn replace(&self, account: Account, next: Option<Arc<AccountSession>>) {
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
            session.token.blocking_write().take();
        }
    }
}

impl AccountSession {
    fn new(account: Account, token: SessionToken) -> Arc<Self> {
        Arc::new(Self {
            account,
            token: RwLock::new(Some(token)),
            end: CancellationToken::new(),
        })
    }
}

impl AccountSessions {
    pub fn for_application(application_id: String) -> Self {
        Self::with_store(move || crate::credentials::for_application(&application_id))
    }

    fn with_store(
        open_store: impl Fn() -> Result<Box<dyn CredentialStore>, CredentialError>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self(Arc::new(SessionState {
            entries: Mutex::new(HashMap::new()),
            changes: Mutex::new(()),
            open_store: Box::new(open_store),
        }))
    }

    async fn change<T: Send + 'static>(
        &self,
        action: impl FnOnce(&SessionState) -> Result<T, TransportError> + Send + 'static,
    ) -> Result<T, TransportError> {
        let state = self.0.clone();
        // Dropping the IPC waiter cannot interrupt a committed change before retirement.
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = state.changes.lock().unwrap();
            action(&state)
        })
        .await
        .map_err(|_| TransportError::CredentialStorageUnavailable)?
    }

    /// Accept only the result of a verified native login. No renderer command takes a token.
    pub async fn activate(
        &self,
        base: &str,
        user_id: &str,
        raw: &str,
    ) -> Result<(), TransportError> {
        self.activate_verified(Account::new(base, user_id)?, SessionToken::new(raw)?)
            .await
    }

    pub(crate) async fn activate_verified(
        &self,
        account: Account,
        token: SessionToken,
    ) -> Result<(), TransportError> {
        let next = AccountSession::new(account.clone(), token.clone());
        self.change(move |state| {
            (state.open_store)()?.save(&account, &token)?;
            state.replace(account, Some(next));
            Ok(())
        })
        .await
    }

    pub async fn forget(&self, base: &str, user_id: &str) -> Result<(), TransportError> {
        let account = Account::new(base, user_id)?;
        self.change(move |state| {
            (state.open_store)()?.remove(&account)?;
            state.replace(account, None);
            Ok(())
        })
        .await
    }

    pub(crate) async fn forget_current(
        &self,
        session: Arc<AccountSession>,
    ) -> Result<Removal, TransportError> {
        self.change(move |state| {
            let account = &session.account;
            if !state
                .active(account)
                .is_some_and(|current| Arc::ptr_eq(&current, &session))
            {
                return Ok(Removal::Superseded);
            }
            let result = {
                let guard = session.token.blocking_read();
                let token = guard.as_ref().ok_or(TransportError::SessionUnavailable)?;
                (state.open_store)()?.remove_matching(account, token)?
            };
            // A different process may have replaced the durable entry. Retire only our stale copy.
            state.replace(account.clone(), None);
            Ok(result)
        })
        .await
    }

    pub async fn account_ids(&self, base: &str) -> Result<Vec<String>, TransportError> {
        validate_installation(base)?;
        let base = base.to_owned();
        self.change(move |state| Ok((state.open_store)()?.account_ids(&base)?))
            .await
    }

    pub(crate) async fn restore(
        &self,
        base: &str,
        user_id: &str,
    ) -> Result<Arc<AccountSession>, TransportError> {
        let account = Account::new(base, user_id)?;
        if let Some(session) = self.0.active(&account) {
            return Ok(session);
        }
        self.change(move |state| {
            if let Some(session) = state.active(&account) {
                return Ok(session);
            }
            let token = (state.open_store)()?
                .read(&account)?
                .ok_or(TransportError::SessionUnavailable)?;
            let session = AccountSession::new(account.clone(), token);
            state.replace(account, Some(session.clone()));
            Ok(session)
        })
        .await
    }
}

#[cfg(any(test, all(feature = "native-http-check", target_os = "android")))]
pub(crate) mod fixture;

#[cfg(test)]
mod tests;
