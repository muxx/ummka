use crate::sessions::{Account, SessionToken};
use std::fmt;

#[cfg(target_os = "android")]
pub mod android;
#[cfg(target_os = "macos")]
pub mod macos;

#[derive(Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialError {
    InvalidInstallation,
    InvalidEntry,
    StorageUnavailable,
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInstallation => "Invalid installation for credential storage",
            Self::InvalidEntry => "Invalid stored Mattermost credential",
            Self::StorageUnavailable => "The platform credential store is unavailable",
        })
    }
}

impl std::error::Error for CredentialError {}

impl From<CredentialError> for crate::rest::TransportError {
    fn from(value: CredentialError) -> Self {
        match value {
            CredentialError::InvalidInstallation => Self::InvalidInstallation,
            CredentialError::InvalidEntry => Self::InvalidStoredCredential,
            CredentialError::StorageUnavailable => Self::CredentialStorageUnavailable,
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn for_application(id: &str) -> Result<Box<dyn CredentialStore>, CredentialError> {
    #[cfg(feature = "webview-check")]
    let store = macos::MacCredentialStore::for_check(id)?;
    #[cfg(not(feature = "webview-check"))]
    let store = macos::MacCredentialStore::for_user(id)?;
    Ok(Box::new(store))
}

#[cfg(target_os = "android")]
pub(crate) fn for_application(_: &str) -> Result<Box<dyn CredentialStore>, CredentialError> {
    Ok(Box::new(android::AndroidCredentialStore::for_app()?))
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(crate) fn for_application(_: &str) -> Result<Box<dyn CredentialStore>, CredentialError> {
    Err(CredentialError::StorageUnavailable)
}

/// A conditional removal never removes a new credential for the same account.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Removal {
    Removed,
    Superseded,
}

/// Native, per-account credential storage. Call these blocking operations off the UI thread.
pub trait CredentialStore {
    fn save(&self, account: &Account, token: &SessionToken) -> Result<(), CredentialError>;
    fn read(&self, account: &Account) -> Result<Option<SessionToken>, CredentialError>;
    fn account_ids(&self, installation: &str) -> Result<Vec<String>, CredentialError>;
    fn remove(&self, account: &Account) -> Result<(), CredentialError>;
    fn remove_matching(
        &self,
        account: &Account,
        expected: &SessionToken,
    ) -> Result<Removal, CredentialError>;
}
