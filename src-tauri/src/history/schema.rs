use super::{HistoryError, stored_owner};
use crate::rest::is_mattermost_id;
use rusqlite::{Connection, TransactionBehavior};
use std::time::{Duration, Instant};

pub(super) const LOCK_WAIT: Duration = Duration::from_secs(5);

fn enable_wal(connection: &Connection, wait: Duration) -> Result<(), HistoryError> {
    let mode: String = connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if mode == "wal" {
        return Ok(());
    }
    // Two connections can both hold a read lock while promoting a rollback journal.
    // SQLite can return BUSY immediately to break that cycle, skipping its busy handler.
    let deadline = Instant::now() + wait;
    connection.busy_timeout(Duration::ZERO)?;
    let result = loop {
        match connection.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0)) {
            Ok(mode) if mode == "wal" => break Ok(()),
            Err(error) if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break Err(HistoryError::Storage);
                }
                std::thread::sleep(remaining.min(Duration::from_millis(5)));
            }
            _ => break Err(HistoryError::Storage),
        }
    };
    connection.busy_timeout(LOCK_WAIT)?;
    result
}

pub(super) const APPLICATION_ID: i64 = 0x554d4849; // UMHI
pub(super) const CREATE_OWNER: &str = include_str!("migrations/0001_owner.sql");
const CREATE_POSTS: &str = include_str!("migrations/0002_posts.sql");
const INDEX_REPLIES: &str = include_str!("migrations/0002_replies.sql");
const CREATE_DELETIONS: &str = include_str!("migrations/0002_channel_deletions.sql");

const WINDOWS: &str = include_str!("migrations/0003_windows.sql");
const WINDOW_POSTS: &str = include_str!("migrations/0003_window_posts.sql");
const NEIGHBORS: &str = include_str!("migrations/0003_window_neighbors.sql");
const RECENT: &str = "CREATE UNIQUE INDEX history_window_recent ON history_window(channel_id, collapsed) WHERE recent = 1";
const ORDER: &str =
    "CREATE INDEX history_window_order ON history_window_post(window_id, created DESC, tie DESC)";
const TIES: &str = "CREATE INDEX history_window_ties ON history_window_post(created, tie)";
const NEIGHBOR_ID: &str =
    "CREATE INDEX history_window_neighbor_id ON history_window_neighbor(post_id, window_id)";

const NEWER_HINT: &str = "CREATE INDEX history_window_newer ON history_window(newer, channel_id) WHERE newer IS NOT NULL";
const OLDER_HINT: &str = "CREATE INDEX history_window_older ON history_window(older, channel_id) WHERE older IS NOT NULL";

const TEAM_DIRECTORY: &str = include_str!("migrations/0004_team_directory.sql");
const JOINED_TEAMS: &str = include_str!("migrations/0004_joined_teams.sql");
const SELECTED_TEAM: &str =
    "CREATE UNIQUE INDEX joined_team_selected ON joined_team(selected) WHERE selected = 1";

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
    Migration {
        statements: &[
            WINDOWS,
            WINDOW_POSTS,
            NEIGHBORS,
            RECENT,
            ORDER,
            TIES,
            NEIGHBOR_ID,
            NEWER_HINT,
            OLDER_HINT,
        ],
        objects: &[
            CREATE_OWNER,
            CREATE_POSTS,
            INDEX_REPLIES,
            CREATE_DELETIONS,
            WINDOWS,
            WINDOW_POSTS,
            NEIGHBORS,
            RECENT,
            ORDER,
            TIES,
            NEIGHBOR_ID,
            NEWER_HINT,
            OLDER_HINT,
        ],
    },
    Migration {
        statements: &[TEAM_DIRECTORY, JOINED_TEAMS, SELECTED_TEAM],
        objects: &[
            CREATE_OWNER,
            CREATE_POSTS,
            INDEX_REPLIES,
            CREATE_DELETIONS,
            WINDOWS,
            WINDOW_POSTS,
            NEIGHBORS,
            RECENT,
            ORDER,
            TIES,
            NEIGHBOR_ID,
            NEWER_HINT,
            OLDER_HINT,
            TEAM_DIRECTORY,
            JOINED_TEAMS,
            SELECTED_TEAM,
        ],
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
    enable_wal(connection, LOCK_WAIT)?;
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

#[cfg(test)]
mod wal_tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn a_rollback_journal_reader_can_release_the_file_during_wal_activation() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("activation.sqlite");
        let mut reader = Connection::open(&path).unwrap();
        reader
            .execute_batch("CREATE TABLE kept(value); INSERT INTO kept VALUES (42)")
            .unwrap();
        let reading = reader.transaction().unwrap();
        assert_eq!(
            reading
                .query_row("SELECT value FROM kept", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            42
        );
        let (started, ready) = mpsc::channel();
        let (completed, result) = mpsc::channel();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let writer = Connection::open(&path).unwrap();
                // Keep the test independent of rusqlite's default busy handler.
                writer.busy_timeout(Duration::ZERO).unwrap();
                assert_eq!(
                    enable_wal(&writer, Duration::from_millis(20)),
                    Err(HistoryError::Storage)
                );
                started.send(()).unwrap();
                completed.send(enable_wal(&writer, LOCK_WAIT)).unwrap();
                let busy: u32 = writer
                    .pragma_query_value(None, "busy_timeout", |row| row.get(0))
                    .unwrap();
                assert_eq!(Duration::from_millis(busy.into()), LOCK_WAIT);
            });
            ready.recv_timeout(LOCK_WAIT).unwrap();
            assert_eq!(
                result.recv_timeout(Duration::from_millis(30)),
                Err(mpsc::RecvTimeoutError::Timeout)
            );
            reading.commit().unwrap();
            assert_eq!(result.recv_timeout(LOCK_WAIT).unwrap(), Ok(()));
        });
        let reopened = Connection::open(path).unwrap();
        let mode: String = reopened
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(
            reopened
                .query_row("SELECT value FROM kept", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            42
        );
    }
}
