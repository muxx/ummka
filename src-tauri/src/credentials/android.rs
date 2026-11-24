//! Android Keystore protects the key. SQLite commits the encrypted value and its account together.
mod keystore;

use super::{CredentialError, CredentialStore, Removal};
use crate::rest::is_mattermost_id;
use crate::sessions::{Account, SessionToken, validate_installation};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::path::PathBuf;

pub struct AndroidCredentialStore {
    path: PathBuf,
}

impl From<rusqlite::Error> for CredentialError {
    fn from(_: rusqlite::Error) -> Self {
        Self::StorageUnavailable
    }
}

impl AndroidCredentialStore {
    pub fn for_app() -> Result<Self, CredentialError> {
        Ok(Self {
            path: keystore::database_path()?.into(),
        })
    }

    fn stored_ids(db: &Connection, installation: &str) -> Result<Vec<String>, CredentialError> {
        let mut statement =
            db.prepare("SELECT user_id FROM sessions WHERE installation=?1 ORDER BY user_id")?;
        let ids = statement
            .query_map([installation], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        if ids.iter().any(|id| !is_mattermost_id(id)) {
            return Err(CredentialError::InvalidEntry);
        }
        Ok(ids)
    }

    fn read_token(
        db: &Connection,
        account: &Account,
    ) -> Result<Option<SessionToken>, CredentialError> {
        let value: Option<Vec<u8>> = db
            .query_row(
                "SELECT sealed FROM sessions WHERE installation=?1 AND user_id=?2",
                [account.installation(), account.user_id()],
                |row| row.get(0),
            )
            .optional()?;
        let Some(value) = value else { return Ok(None) };
        let token = keystore::open(&associated_data(account), &value)?
            .ok_or(CredentialError::InvalidEntry)?;
        let token = std::str::from_utf8(&token).map_err(|_| CredentialError::InvalidEntry)?;
        SessionToken::new(token)
            .map(Some)
            .map_err(|_| CredentialError::InvalidEntry)
    }

    fn remove_entry(
        &self,
        account: &Account,
        expected: Option<&SessionToken>,
    ) -> Result<Removal, CredentialError> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(expected) = expected
            && Self::read_token(&tx, account)?
                .is_some_and(|current| current.secret() != expected.secret())
        {
            return Ok(Removal::Superseded);
        }
        tx.execute(
            "DELETE FROM sessions WHERE installation=?1 AND user_id=?2",
            [account.installation(), account.user_id()],
        )?;
        tx.commit()?;
        Ok(Removal::Removed)
    }

    fn connect(&self) -> Result<Connection, CredentialError> {
        let mut db = Connection::open(&self.path)?;
        db.pragma_update(None, "foreign_keys", true)?;
        let version = |db: &Connection| {
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        };
        if version(&db)? == 0 {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Another process can finish creating the database while we wait for the writer lock.
            if version(&tx)? == 0 {
                let occupied: bool =
                    tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema)", [], |row| {
                        row.get(0)
                    })?;
                if occupied {
                    return Err(CredentialError::InvalidEntry);
                }
                tx.execute_batch(
                    "CREATE TABLE sessions (
                    installation TEXT NOT NULL, user_id TEXT NOT NULL, sealed BLOB NOT NULL,
                    PRIMARY KEY (installation, user_id)
                ) STRICT;
                PRAGMA user_version = 1;",
                )?;
            }
            tx.commit()?;
        }
        if version(&db)? != 1 {
            return Err(CredentialError::InvalidEntry);
        }
        Ok(db)
    }
}

fn associated_data(account: &Account) -> Vec<u8> {
    [
        account.installation().as_bytes(),
        &[0],
        account.user_id().as_bytes(),
    ]
    .concat()
}

impl CredentialStore for AndroidCredentialStore {
    fn save(&self, account: &Account, token: &SessionToken) -> Result<(), CredentialError> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        super::allow_account(account, &Self::stored_ids(&tx, account.installation())?)?;
        let empty = tx.query_row("SELECT NOT EXISTS(SELECT 1 FROM sessions)", [], |r| {
            r.get(0)
        })?;
        let sealed = keystore::seal(&associated_data(account), token.secret(), empty)?;
        tx.execute(
            "INSERT INTO sessions (installation, user_id, sealed) VALUES (?1, ?2, ?3)
                    ON CONFLICT(installation, user_id) DO UPDATE SET sealed=excluded.sealed",
            params![account.installation(), account.user_id(), sealed],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn read(&self, account: &Account) -> Result<Option<SessionToken>, CredentialError> {
        Self::read_token(&self.connect()?, account)
    }

    fn account_ids(&self, installation: &str) -> Result<Vec<String>, CredentialError> {
        validate_installation(installation).map_err(|_| CredentialError::InvalidInstallation)?;
        Self::stored_ids(&self.connect()?, installation)
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

#[cfg(feature = "native-http-check")]
pub(crate) mod checks;
