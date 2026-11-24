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

/// Native, per-account credential storage. Call these blocking operations off the UI thread.
pub trait CredentialStore {
    fn save(&self, account: &Account, token: &SessionToken) -> Result<(), CredentialError>;
    fn read(&self, account: &Account) -> Result<Option<SessionToken>, CredentialError>;
    fn account_ids(&self, installation: &str) -> Result<Vec<String>, CredentialError>;
    fn remove(&self, account: &Account) -> Result<(), CredentialError>;
}
