use super::{HistoryDatabase, HistoryError, HistoryOwner, filename, stored_owner};
use crate::sessions::Account;
use rusqlite::Transaction;
use std::path::Path;

/// An open native history view. Each operation checks the generation captured at opening.
pub struct AccountHistory {
    pub(super) database: HistoryDatabase,
    pub(super) owner: HistoryOwner,
}

impl AccountHistory {
    pub(crate) fn open(root: &Path, account: &Account) -> Result<Self, HistoryError> {
        let mut database = HistoryDatabase::open(root, account.installation())?;
        let owner = database.restore(account)?;
        Ok(Self { database, owner })
    }

    pub fn read<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>,
    ) -> Result<T, HistoryError> {
        self.database.read(&self.owner, operation)
    }

    pub fn write<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>,
    ) -> Result<T, HistoryError> {
        self.database.write(&self.owner, operation)
    }
}

impl HistoryDatabase {
    // All lifecycle callers hold the installation's credential writer. History files stay in place.
    fn existing(root: &Path, account: &Account) -> Result<Option<Self>, HistoryError> {
        let path = root.join("history").join(filename(account.installation()));
        if !path.try_exists().map_err(|_| HistoryError::Storage)? {
            return Ok(None);
        }
        Self::open(root, account.installation()).map(Some)
    }

    pub(crate) fn retire_existing(
        root: &Path,
        account: &Account,
        credential_exists: bool,
    ) -> Result<(), HistoryError> {
        let Some(mut database) = Self::existing(root, account)? else {
            return Ok(());
        };
        database.retire(account, credential_exists)
    }

    pub(super) fn retire(
        &mut self,
        account: &Account,
        credential_exists: bool,
    ) -> Result<(), HistoryError> {
        if stored_owner(&self.connection)?.is_some() {
            if !credential_exists {
                return Err(HistoryError::OwnerConflict);
            }
            self.new_login(account)?;
        }
        Ok(())
    }

    pub(crate) fn purge_account(root: &Path, account: &Account) -> Result<(), HistoryError> {
        let Some(mut database) = Self::existing(root, account)? else {
            return Ok(());
        };
        match stored_owner(&database.connection)? {
            Some((_, user, generation)) if user == account.user_id() => {
                database.purge(&HistoryOwner {
                    account: account.clone(),
                    generation,
                })
            }
            // A legacy installation can still hold several credentials. Forget only this account.
            Some(_) => Ok(()),
            None => database.reclaim(None),
        }
    }
}
