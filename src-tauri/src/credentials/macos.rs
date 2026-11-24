use super::{CredentialError, CredentialStore, Removal};
use crate::history::{AccountHistory, HistoryDatabase};
use crate::rest::is_mattermost_id;
use crate::sessions::{Account, SessionToken, validate_installation};
use core_foundation::base::TCFType;
use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
use security_framework_sys::base::{errSecDuplicateItem, errSecItemNotFound, errSecSuccess};
use security_framework_sys::keychain_item::SecKeychainItemDelete;

use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub struct MacCredentialStore {
    writer: PathBuf,
    keychain: SecKeychain,
    application_id: String,
}

impl MacCredentialStore {
    #[cfg(feature = "webview-check")]
    pub(super) fn for_check(application_id: &str) -> Result<Self, CredentialError> {
        let path =
            std::env::var_os("UMMKA_CHECK_KEYCHAIN").ok_or(CredentialError::StorageUnavailable)?;
        Self::at_keychain(Path::new(&path), application_id)
    }

    #[cfg(any(feature = "webview-check", all(test, feature = "native-http-check")))]
    pub(crate) fn at_keychain(path: &Path, application_id: &str) -> Result<Self, CredentialError> {
        let keychain = SecKeychain::open(path).map_err(|_| CredentialError::StorageUnavailable)?;
        Ok(Self {
            writer: path.with_extension("writers.lock"),
            keychain,
            application_id: application_id.into(),
        })
    }

    pub fn for_user(application_id: &str) -> Result<Self, CredentialError> {
        if Path::new(application_id).file_name() != Some(std::ffi::OsStr::new(application_id)) {
            return Err(CredentialError::InvalidEntry);
        }
        let writer = dirs::data_local_dir()
            .ok_or(CredentialError::StorageUnavailable)?
            .join(application_id)
            .join("session-writes.lock");
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|_| CredentialError::StorageUnavailable)?;
        Ok(Self {
            writer,
            keychain,
            application_id: application_id.into(),
        })
    }

    fn private_root(&self) -> Result<&Path, CredentialError> {
        self.writer
            .parent()
            .ok_or(CredentialError::StorageUnavailable)
    }

    // All ummka writers lock the same stable file. Its contents never carry credentials.
    fn write_guard(&self) -> Result<File, CredentialError> {
        let unavailable = |_| CredentialError::StorageUnavailable;
        let directory = self.private_root()?;
        fs::create_dir_all(directory).map_err(unavailable)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(&self.writer)
            .map_err(unavailable)?;
        file.lock().map_err(unavailable)?;
        Ok(file)
    }

    fn remove_entry(
        &self,
        account: &Account,
        expected: Option<&SessionToken>,
    ) -> Result<Removal, CredentialError> {
        let _guard = self.write_guard()?;
        let service = self.service(account.installation());
        let status = match self
            .keychain
            .find_generic_password(&service, account.user_id())
        {
            Ok((bytes, _)) if expected.is_some_and(|token| &*bytes != token.secret()) => {
                return Ok(Removal::Superseded);
            }
            Ok((_, item)) => {
                HistoryDatabase::purge_account(self.private_root()?, account)?;
                // The safe item's delete method discards OSStatus. The owned item is live through the call.
                unsafe { SecKeychainItemDelete(item.as_concrete_TypeRef()) }
            }
            Err(e) if e.code() == errSecItemNotFound && expected.is_some() => {
                return Ok(if self.account_ids(account.installation())?.is_empty() {
                    Removal::Removed
                } else {
                    Removal::Superseded
                });
            }
            Err(e) => e.code(),
        };
        if status == errSecSuccess || status == errSecItemNotFound {
            Ok(Removal::Removed)
        } else {
            Err(CredentialError::StorageUnavailable)
        }
    }

    fn service(&self, installation: &str) -> String {
        format!("{}.mattermost.sessions:{installation}", self.application_id)
    }
}

impl CredentialStore for MacCredentialStore {
    fn save(&self, account: &Account, token: &SessionToken) -> Result<(), CredentialError> {
        let _guard = self.write_guard()?;
        let ids = self.account_ids(account.installation())?;
        super::allow_account(account, &ids)?;
        HistoryDatabase::retire_existing(self.private_root()?, account, !ids.is_empty())?;
        let service = self.service(account.installation());
        match self
            .keychain
            .add_generic_password(&service, account.user_id(), token.secret())
        {
            Ok(()) => Ok(()),
            Err(e) if e.code() == errSecDuplicateItem => {
                let (_, mut item) = self
                    .keychain
                    .find_generic_password(&service, account.user_id())
                    .map_err(|_| CredentialError::StorageUnavailable)?;
                item.set_password(token.secret())
                    .map_err(|_| CredentialError::StorageUnavailable)
            }
            Err(_) => Err(CredentialError::StorageUnavailable),
        }
    }

    fn open_history(
        &self,
        account: &Account,
        expected: &SessionToken,
    ) -> Result<AccountHistory, CredentialError> {
        let _guard = self.write_guard()?;
        super::allow_account(account, &self.account_ids(account.installation())?)?;
        super::bind_history(self.private_root()?, account, expected, self.read(account)?)
    }

    fn read(&self, account: &Account) -> Result<Option<SessionToken>, CredentialError> {
        let service = self.service(account.installation());
        match self
            .keychain
            .find_generic_password(&service, account.user_id())
        {
            Ok((bytes, _)) => {
                let text =
                    std::str::from_utf8(&bytes).map_err(|_| CredentialError::InvalidEntry)?;
                SessionToken::new(text)
                    .map(Some)
                    .map_err(|_| CredentialError::InvalidEntry)
            }
            Err(e) if e.code() == errSecItemNotFound => Ok(None),
            Err(_) => Err(CredentialError::StorageUnavailable),
        }
    }

    fn account_ids(&self, installation: &str) -> Result<Vec<String>, CredentialError> {
        validate_installation(installation).map_err(|_| CredentialError::InvalidInstallation)?;
        let items = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .keychains(std::slice::from_ref(&self.keychain))
            .service(&self.service(installation))
            .load_attributes(true)
            .limit(Limit::All)
            .search();
        let items = match items {
            Ok(items) => items,
            Err(e) if e.code() == errSecItemNotFound => return Ok(Vec::new()),
            Err(_) => return Err(CredentialError::StorageUnavailable),
        };
        let mut ids = Vec::with_capacity(items.len());
        for item in items {
            let id = item
                .simplify_dict()
                .and_then(|mut attributes| attributes.remove("acct"))
                .filter(|id| is_mattermost_id(id))
                .ok_or(CredentialError::InvalidEntry)?;
            ids.push(id);
        }
        ids.sort_unstable();
        Ok(ids)
    }

    fn remove(&self, account: &Account) -> Result<(), CredentialError> {
        self.remove_entry(account, None).map(|_| ())
    }

    fn remove_matching(
        &self,
        account: &Account,
        expected: &SessionToken,
    ) -> Result<Removal, CredentialError> {
        self.remove_entry(account, Some(expected))
    }
}

#[cfg(test)]
mod tests;
