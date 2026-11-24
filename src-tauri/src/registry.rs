use crate::installation_url::parse_canonical;
use rusqlite::{Connection, TransactionBehavior};
use std::{fmt, path::Path};

#[cfg(any(test, all(target_os = "android", feature = "native-http-check")))]
pub(crate) mod checks;

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistryError {
    InvalidInstallation,
    UnsupportedSchema,
    Storage,
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInstallation => "Invalid canonical Mattermost server URL",
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

// SQLite stores this statement in sqlite_schema without the terminating semicolon.
// The registry only opens its own on-disk format.
const CREATE_V1: &str = "CREATE TABLE installations (url TEXT PRIMARY KEY NOT NULL) STRICT";

fn matches_v1(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT count(*) = 1 AND count(*) FILTER (WHERE type = 'table' AND sql = ?1) = 1
         FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
        [CREATE_V1],
        |row| row.get(0),
    )
}

impl InstallationRegistry {
    pub fn open(path: &Path) -> Result<Self, RegistryError> {
        let path = std::path::absolute(path).map_err(|_| RegistryError::Storage)?;
        let mut connection = Connection::open(path)?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
        match version {
            0 => {
                let occupied: bool =
                    tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema)", [], |row| {
                        row.get(0)
                    })?;
                if occupied {
                    return Err(RegistryError::UnsupportedSchema);
                }
                tx.execute(CREATE_V1, [])?;
                tx.pragma_update(None, "user_version", 1)?;
            }
            1 if matches_v1(&tx)? => {}
            _ => return Err(RegistryError::UnsupportedSchema),
        }
        tx.commit()?;
        Ok(Self { connection })
    }

    pub fn remember(&self, url: &str) -> Result<(), RegistryError> {
        parse_canonical(url).ok_or(RegistryError::InvalidInstallation)?;
        self.connection.execute(
            "INSERT INTO installations (url) VALUES (?1) ON CONFLICT(url) DO NOTHING",
            [url],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<String>, RegistryError> {
        let mut statement = self
            .connection
            .prepare("SELECT url FROM installations ORDER BY url")?;
        Ok(statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?)
    }

    pub fn forget(&self, url: &str) -> Result<(), RegistryError> {
        parse_canonical(url).ok_or(RegistryError::InvalidInstallation)?;
        self.connection
            .execute("DELETE FROM installations WHERE url = ?1", [url])?;
        Ok(())
    }
}
