use crate::sessions::{Account, validate_installation};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use sha2::{Digest, Sha256};
use std::{fmt, fmt::Write, fs, path::Path};

#[cfg(any(test, all(target_os = "android", feature = "native-http-check")))]
pub(crate) mod checks;

mod attachments;
mod attempts;
mod cards;
pub use attempts::{PostRefusal, RefusalScope, RetryPost};
mod departure;
pub use departure::ChannelMembershipUpdate;
mod directory;
mod recent_searches;
pub use directory::{DirectoryTeam, TeamDirectory, TeamDirectoryLoad};
mod drafts;
pub use drafts::{ComposerDraft, DraftCommandAction, DraftSave};
mod confirmation;
mod lifecycle;
pub use confirmation::{DeliveryPost, DeliverySource};
mod pending;
pub use pending::{PendingCursor, PendingPost, StagePost};
mod posts;
mod profiles;
mod thread_summary;
pub use profiles::{ChannelProfile, ProfileLookup, ProfileQuery};
mod reclamation;
pub use lifecycle::AccountHistory;
pub(crate) use posts::{CachedPostObservation, CachedPostRead, PostObservation};
pub use posts::{ChannelPostLoad, PageWrite, PostChange, StoredPost};
mod schema;
mod settings;
pub use settings::{ServerPolicy, ServerPolicyLoad, SidebarPreferences, WorkspaceSettings};
mod sidebar;
pub use sidebar::{SidebarCategory, SidebarChannel, SidebarData, SidebarLoad, SidebarSnapshot};
mod team_roles;
pub use team_roles::{TeamRoleLoad, TeamRoleSnapshot};
mod windows;
pub use windows::{ChannelHistoryPage, WindowEdge, WindowSlice, WindowSource};

#[derive(Debug, PartialEq, Eq)]
pub enum HistoryError {
    InvalidInstallation,
    InvalidPost,
    InvalidDirectory,
    InvalidDraft,
    UnsupportedSchema,
    OwnerConflict,
    StaleOwner,
    Storage,
}

impl fmt::Display for HistoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInstallation => "Invalid canonical HTTPS installation",
            Self::InvalidDraft => "Invalid composer draft key or revision",
            Self::InvalidDirectory => "Invalid directory data",
            Self::InvalidPost => "Invalid channel history record",
            Self::UnsupportedSchema => "Unsupported local history database",
            Self::OwnerConflict => "Local history belongs to another account or installation",
            Self::StaleOwner => "Local history access has expired",
            Self::Storage => "Could not access local history",
        })
    }
}

impl std::error::Error for HistoryError {}

impl From<rusqlite::Error> for HistoryError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}

/// Native access issued for one specific login on one installation.
#[derive(Clone, PartialEq, Eq)]
struct HistoryOwner {
    account: Account,
    generation: [u8; 16],
}

/// A file-backed history connection. Open it and execute its transactions on a blocking thread.
pub(crate) struct HistoryDatabase {
    connection: Connection,
    installation: String,
    version: i64,
}

fn filename(installation: &str) -> String {
    let mut name = String::with_capacity(64 + ".sqlite".len());
    for byte in Sha256::digest(installation.as_bytes()) {
        write!(name, "{byte:02x}").expect("writing to a String is infallible");
    }
    name.push_str(".sqlite");
    name
}

fn stored_owner(connection: &Connection) -> rusqlite::Result<Option<(String, String, [u8; 16])>> {
    connection
        .query_row(
            "SELECT installation, user_id, generation FROM history_owner WHERE slot = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
}

impl HistoryDatabase {
    fn open(private_root: &Path, installation: &str) -> Result<Self, HistoryError> {
        Self::open_with(private_root, installation, schema::MIGRATIONS)
    }

    fn open_with(
        private_root: &Path,
        installation: &str,
        migrations: &[schema::Migration],
    ) -> Result<Self, HistoryError> {
        validate_installation(installation).map_err(|_| HistoryError::InvalidInstallation)?;
        let dir = std::path::absolute(private_root)
            .map_err(|_| HistoryError::Storage)?
            .join("history");
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder.create(&dir).map_err(|_| HistoryError::Storage)?;
        let mut connection = Connection::open(dir.join(filename(installation)))?;
        connection.busy_timeout(schema::LOCK_WAIT)?;
        connection.pragma_update(None, "foreign_keys", true)?;

        let version = schema::upgrade(&mut connection, installation, migrations)?;
        Ok(Self {
            connection,
            installation: installation.to_owned(),
            version,
        })
    }

    /// Recover the existing generation for a confirmed saved session, including offline.
    fn restore(&mut self, account: &Account) -> Result<HistoryOwner, HistoryError> {
        self.bind(account, Login::Restored)
    }

    /// Rotate the generation of a newly authenticated session while preserving that user's rows.
    fn new_login(&mut self, account: &Account) -> Result<HistoryOwner, HistoryError> {
        self.bind(account, Login::New)
    }

    fn bind(&mut self, account: &Account, login: Login) -> Result<HistoryOwner, HistoryError> {
        if self.installation != account.installation() {
            return Err(HistoryError::OwnerConflict);
        }
        let tx = self.transaction(TransactionBehavior::Immediate)?;
        let generation = match stored_owner(&tx)? {
            None => tx.query_row(
                "INSERT INTO history_owner VALUES (1, ?1, ?2, randomblob(16)) RETURNING generation",
                params![account.installation(), account.user_id()],
                |row| row.get(0),
            )?,
            Some((url, user, generation)) => {
                if url != account.installation() || user != account.user_id() {
                    return Err(HistoryError::OwnerConflict);
                }
                match login {
                    Login::Restored => generation,
                    Login::New => tx.query_row(
                        "UPDATE history_owner SET generation = randomblob(16) WHERE slot = 1 RETURNING generation",
                        [], |row| row.get(0))?,
                }
            }
        };
        tx.commit()?;
        Ok(HistoryOwner {
            account: account.clone(),
            generation,
        })
    }

    fn read<T>(
        &mut self,
        owner: &HistoryOwner,
        operation: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>,
    ) -> Result<T, HistoryError> {
        self.access(owner, TransactionBehavior::Deferred, |tx| {
            Ok(operation(tx)?)
        })
    }

    fn write<T>(
        &mut self,
        owner: &HistoryOwner,
        operation: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>,
    ) -> Result<T, HistoryError> {
        self.access(owner, TransactionBehavior::Immediate, |tx| {
            Ok(operation(tx)?)
        })
    }

    fn transaction(
        &mut self,
        behavior: TransactionBehavior,
    ) -> Result<Transaction<'_>, HistoryError> {
        self.connection.pragma_update(
            None,
            "query_only",
            matches!(behavior, TransactionBehavior::Deferred),
        )?;
        let tx = self.connection.transaction_with_behavior(behavior)?;
        if schema::version(&tx)? != self.version {
            return Err(HistoryError::UnsupportedSchema);
        }
        Ok(tx)
    }

    fn access<T>(
        &mut self,
        owner: &HistoryOwner,
        behavior: TransactionBehavior,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        if self.installation != owner.account.installation() {
            return Err(HistoryError::StaleOwner);
        }
        let tx = self.transaction(behavior)?;
        let current: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM history_owner WHERE slot = 1 AND installation = ?1 AND user_id = ?2 AND generation = ?3)",
            params![owner.account.installation(), owner.account.user_id(), owner.generation], |row| row.get(0))?;
        if !current {
            return Err(HistoryError::StaleOwner);
        }
        let value = operation(&tx)?;
        tx.commit()?;
        Ok(value)
    }
}

enum Login {
    Restored,
    New,
}
