use super::{HistoryError, stored_owner};
use crate::rest::is_mattermost_id;
use rusqlite::{Connection, TransactionBehavior};

pub(super) const APPLICATION_ID: i64 = 0x554d4849; // UMHI
pub(super) const CREATE_OWNER: &str = include_str!("migrations/0001_owner.sql");
const CREATE_POSTS: &str = include_str!("migrations/0002_posts.sql");
const INDEX_REPLIES: &str = include_str!("migrations/0002_replies.sql");
const CREATE_DELETIONS: &str = include_str!("migrations/0002_channel_deletions.sql");

/// Each entry advances user_version by one. Keep published entries in order.
pub(super) struct Migration {
    pub(super) statements: &'static [&'static str],
    pub(super) objects: &'static [&'static str],
}

pub(super) const MIGRATIONS: &[Migration] = &[
    Migration {
        statements: &[CREATE_OWNER],
        objects: &[CREATE_OWNER],
    },
    Migration {
        statements: &[CREATE_POSTS, INDEX_REPLIES, CREATE_DELETIONS],
        objects: &[CREATE_OWNER, CREATE_POSTS, INDEX_REPLIES, CREATE_DELETIONS],
    },
];

pub(super) fn version(connection: &Connection) -> rusqlite::Result<i64> {
    connection.pragma_query_value(None, "user_version", |row| row.get(0))
}

fn inspect(
    connection: &Connection,
    installation: &str,
    migrations: &[Migration],
) -> Result<usize, HistoryError> {
    let id: i64 = connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let version = version(connection)?;
    if (id, version) == (0, 0) {
        let empty: bool = connection.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema)",
            [],
            |row| row.get(0),
        )?;
        return if empty {
            Ok(0)
        } else {
            Err(HistoryError::UnsupportedSchema)
        };
    }
    let current = usize::try_from(version).map_err(|_| HistoryError::UnsupportedSchema)?;
    if id != APPLICATION_ID || current == 0 || current > migrations.len() {
        return Err(HistoryError::UnsupportedSchema);
    }
    let expected = migrations[current - 1].objects;
    let mut stmt =
        connection.prepare("SELECT sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")?;
    let objects = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // SQLite omits a CREATE statement's terminal semicolon in sqlite_schema.
    if objects.len() != expected.len()
        || !expected.iter().all(|ddl| {
            objects
                .iter()
                .any(|actual| actual == ddl.trim().trim_end_matches(';'))
        })
    {
        return Err(HistoryError::UnsupportedSchema);
    }
    let vacuum: i64 = connection.pragma_query_value(None, "auto_vacuum", |row| row.get(0))?;
    if vacuum != 2 {
        return Err(HistoryError::UnsupportedSchema);
    }
    if let Some((url, user, _)) = stored_owner(connection)? {
        if url != installation {
            return Err(HistoryError::OwnerConflict);
        }
        if !is_mattermost_id(&user) {
            return Err(HistoryError::UnsupportedSchema);
        }
    }
    Ok(current)
}

/// Inspect before any persistent settings change, then recheck inside the single writer.
pub(super) fn upgrade(
    connection: &mut Connection,
    installation: &str,
    migrations: &[Migration],
) -> Result<i64, HistoryError> {
    let snapshot = connection.transaction()?;
    let current = inspect(&snapshot, installation, migrations)?;
    snapshot.commit()?;
    if current == 0 {
        // SQLite needs its page map before both the first table and its transaction.
        connection.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    }
    let journal: String = connection.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    if journal != "wal" {
        return Err(HistoryError::Storage);
    }
    let target =
        i64::try_from(migrations.len()).expect("compiled migrations fit SQLite user_version");
    if current != migrations.len() {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let start = inspect(&tx, installation, migrations)?;
        if start == 0 {
            tx.pragma_update(None, "application_id", APPLICATION_ID)?;
        }
        for (index, migration) in migrations.iter().enumerate().skip(start) {
            for statement in migration.statements {
                tx.execute_batch(statement)?;
            }
            let next =
                i64::try_from(index + 1).expect("compiled migrations fit SQLite user_version");
            tx.pragma_update(None, "user_version", next)?;
            inspect(&tx, installation, migrations)?;
        }
        tx.commit()?;
    }
    Ok(target)
}
