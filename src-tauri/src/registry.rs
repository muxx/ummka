use crate::installation_url::parse_canonical;
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior};
use std::{fmt, path::Path};

mod schema;

#[cfg(any(test, all(target_os = "android", feature = "native-http-check")))]
pub(crate) mod checks;

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistryError {
    InvalidInstallation,
    UnknownInstallation,
    UnsupportedSchema,
    Storage,
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInstallation => "Invalid canonical Mattermost server URL",
            Self::UnknownInstallation => "Mattermost installation is not remembered",
            Self::UnsupportedSchema => "Unsupported installation registry schema",
            Self::Storage => "Could not access the installation registry",
        })
    }
}

impl std::error::Error for RegistryError {}

impl From<rusqlite::Error> for RegistryError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}

/// The persistent, ordered set of Mattermost installation addresses on this device.
pub struct InstallationRegistry {
    connection: Connection,
}

/// Installations and selection observed in the same read transaction.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct InstallationSelection {
    pub installations: Vec<String>,
    pub selected: Option<String>,
}

const ORDERED: &str = "SELECT url FROM installations ORDER BY url";
const ACTIVE: &str = "SELECT url FROM installations WHERE active = 1";
const SELECT_NEIGHBOR: &str = "UPDATE installations SET active = 1 WHERE url = coalesce(
        (SELECT url FROM installations WHERE url < ?1 ORDER BY url DESC LIMIT 1),
        (SELECT url FROM installations WHERE url > ?1 ORDER BY url LIMIT 1))";

impl InstallationRegistry {
    pub fn open(path: &Path) -> Result<Self, RegistryError> {
        let path = std::path::absolute(path).map_err(|_| RegistryError::Storage)?;
        let mut connection = Connection::open(path)?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        schema::upgrade(&tx)?;
        tx.commit()?;
        Ok(Self { connection })
    }

    /// Observe a first launch or an older file without creating or upgrading a database.
    pub fn read_selection(path: &Path) -> Result<InstallationSelection, RegistryError> {
        match path.symlink_metadata() {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(InstallationSelection::default());
            }
            Err(_) => return Err(RegistryError::Storage),
            Ok(_) => {}
        }
        let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let tx = db.transaction()?;
        let schema = schema::identify(&tx)?;
        let (installations, selected) = match schema {
            schema::Schema::Empty => (Vec::new(), None),
            schema::Schema::V1 => {
                let installations = ordered_addresses(&tx)?;
                let selected = installations.first().cloned();
                (installations, selected)
            }
            schema::Schema::V2 => (
                ordered_addresses(&tx)?,
                tx.query_row(ACTIVE, [], |r| r.get(0)).optional()?,
            ),
        };
        if selected.is_none() != installations.is_empty() {
            return Err(RegistryError::Storage);
        }
        tx.commit()?;
        Ok(InstallationSelection {
            installations,
            selected,
        })
    }

    pub fn remember(&self, url: &str) -> Result<(), RegistryError> {
        parse_canonical(url).ok_or(RegistryError::InvalidInstallation)?;
        self.connection.execute(
            "INSERT INTO installations (url, active) VALUES (?1, NOT EXISTS(SELECT 1 FROM installations)) ON CONFLICT(url) DO NOTHING",
            [url],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<String>, RegistryError> {
        ordered_addresses(&self.connection)
    }

    pub fn forget(&self, url: &str) -> Result<(), RegistryError> {
        parse_canonical(url).ok_or(RegistryError::InvalidInstallation)?;
        let tx = Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        let active: Option<bool> = tx
            .query_row(
                "DELETE FROM installations WHERE url = ?1 RETURNING active",
                [url],
                |r| r.get(0),
            )
            .optional()?;
        if active == Some(true) {
            tx.execute(SELECT_NEIGHBOR, [url])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn connect(&self, url: &str) -> Result<(), RegistryError> {
        self.change_selection(
            url,
            "INSERT INTO installations (url, active) VALUES (?1, 1) ON CONFLICT(url) DO UPDATE SET active = 1",
        )
    }

    pub fn select(&self, url: &str) -> Result<(), RegistryError> {
        self.change_selection(url, "UPDATE installations SET active = 1 WHERE url = ?1")
    }

    fn change_selection(&self, url: &str, write: &str) -> Result<(), RegistryError> {
        parse_canonical(url).ok_or(RegistryError::InvalidInstallation)?;
        let tx = Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        tx.execute("UPDATE installations SET active = 0 WHERE active = 1", [])?;
        if tx.execute(write, [url])? == 0 {
            return Err(RegistryError::UnknownInstallation);
        }
        tx.commit()?;
        Ok(())
    }
}

fn ordered_addresses(connection: &Connection) -> Result<Vec<String>, RegistryError> {
    let mut statement = connection.prepare(ORDERED)?;
    Ok(statement
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}
