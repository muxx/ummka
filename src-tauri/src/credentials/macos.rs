use super::{CredentialError, CredentialStore};
use crate::rest::is_mattermost_id;
use crate::sessions::{Account, SessionToken, validate_installation};
use core_foundation::base::TCFType;
use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
use security_framework_sys::base::{errSecDuplicateItem, errSecItemNotFound, errSecSuccess};
use security_framework_sys::keychain_item::SecKeychainItemDelete;

pub struct MacCredentialStore {
    keychain: SecKeychain,
    application_id: String,
}

impl MacCredentialStore {
    #[cfg(feature = "webview-check")]
    pub(super) fn for_check(application_id: &str) -> Result<Self, CredentialError> {
        let path =
            std::env::var_os("UMMKA_CHECK_KEYCHAIN").ok_or(CredentialError::StorageUnavailable)?;
        let keychain = SecKeychain::open(std::path::Path::new(&path))
            .map_err(|_| CredentialError::StorageUnavailable)?;
        Ok(Self {
            keychain,
            application_id: application_id.into(),
        })
    }

    pub fn for_user(application_id: &str) -> Result<Self, CredentialError> {
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|_| CredentialError::StorageUnavailable)?;
        Ok(Self {
            keychain,
            application_id: application_id.into(),
        })
    }

    fn service(&self, installation: &str) -> String {
        format!("{}.mattermost.sessions:{installation}", self.application_id)
    }
}

impl CredentialStore for MacCredentialStore {
    fn save(&self, account: &Account, token: &SessionToken) -> Result<(), CredentialError> {
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
        let service = self.service(account.installation());
        let status = match self
            .keychain
            .find_generic_password(&service, account.user_id())
        {
            // The safe item's delete method discards OSStatus. This owned item stays live through the call.
            Ok((_, item)) => unsafe { SecKeychainItemDelete(item.as_concrete_TypeRef()) },
            Err(e) => e.code(),
        };
        if status == errSecSuccess || status == errSecItemNotFound {
            Ok(())
        } else {
            Err(CredentialError::StorageUnavailable)
        }
    }
}

#[cfg(test)]
mod tests;
