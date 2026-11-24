use super::{ALICE, account};
use crate::history::{
    HistoryDatabase, HistoryError, HistoryOwner, filename,
    schema::{CREATE_OWNER, Migration},
    stored_owner,
};
use rusqlite::Connection;
use std::{fs, path::Path};

const URL: &str = "https://chat.example.test/reclamation";
const PEER: &str = "https://chat.example.test/reclamation/peer";
const POSTS: &str = "CREATE TABLE fixture_messages (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES history_owner(slot) ON DELETE CASCADE, body BLOB NOT NULL) STRICT";
const FIXTURE: &[Migration] = &[
    Migration {
        statements: &[CREATE_OWNER],
        objects: &[CREATE_OWNER],
    },
    Migration {
        statements: &[POSTS],
        objects: &[CREATE_OWNER, POSTS],
    },
];
const ROWS: i64 = 512;

fn database(root: &Path, address: &str) -> Result<HistoryDatabase, HistoryError> {
    HistoryDatabase::open_with(root, address, FIXTURE)
}

fn count(db: &Connection) -> rusqlite::Result<i64> {
    db.query_row("SELECT count(*) FROM fixture_messages", [], |r| r.get(0))
}

fn fill(root: &Path, address: &str) -> Result<HistoryOwner, HistoryError> {
    let mut db = database(root, address)?;
    let owner = db.restore(&account(address, ALICE))?;
    db.write(&owner, |tx| {
        tx.execute(
        "WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n < ?1)
         INSERT INTO fixture_messages SELECT n, 1, zeroblob(3072) FROM numbers", [ROWS]
    )
    })?;
    Ok(owner)
}

fn size(path: &Path) -> u64 {
    fs::metadata(path).expect("history fixture exists").len()
}

pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    let root = root.join("reclaim");
    let previous = fill(&root, URL)?;
    let alice = account(URL, ALICE);
    let mut existing = database(&root, URL)?;
    assert_eq!(
        existing.retire(&alice, false),
        Err(HistoryError::OwnerConflict)
    );
    assert_eq!(existing.read(&previous, |tx| count(tx))?, ROWS);
    existing.retire(&alice, true)?;
    assert_eq!(
        existing.write(&previous, |_| Ok(())),
        Err(HistoryError::StaleOwner)
    );
    let owner = existing.restore(&alice)?;
    assert_eq!(existing.read(&owner, |tx| count(tx))?, ROWS);
    drop(existing);
    let peer = fill(&root, PEER)?;
    let path = root.join("history").join(filename(URL));
    let before = size(&path);
    let mut db = database(&root, URL)?;
    db.connection.execute_batch("CREATE TEMP TRIGGER fixture_error BEFORE DELETE ON main.history_owner BEGIN SELECT RAISE(ABORT,'fixture'); END")?;
    assert_eq!(db.purge(&owner), Err(HistoryError::Storage));
    assert_eq!(db.read(&owner, |tx| count(tx))?, ROWS);
    db.write(&owner, |tx| {
        tx.execute_batch("DROP TRIGGER temp.fixture_error")
    })?;
    assert_eq!(db.purge(&peer), Err(HistoryError::StaleOwner));
    db.purge(&owner)?;
    assert_eq!(
        db.read(&owner, |tx| count(tx)),
        Err(HistoryError::StaleOwner)
    );
    drop(db);
    let mut db = database(&root, URL)?;
    assert!(stored_owner(&db.connection)?.is_none());
    assert_eq!(count(&db.connection)?, 0);
    assert!(size(&path) < before / 8);
    match fs::metadata(path.with_extension("sqlite-wal")) {
        Ok(file) => assert_eq!(file.len(), 0),
        Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::NotFound),
    }
    db.purge(&owner)?;

    let replacement = fill(&root, URL)?;
    assert_eq!(db.purge(&owner), Err(HistoryError::StaleOwner));
    assert_eq!(db.read(&replacement, |tx| count(tx))?, ROWS);
    assert_eq!(database(&root, PEER)?.read(&peer, |tx| count(tx))?, ROWS);
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod processes {
    use super::*;
    use std::{env, process::Command, time::Duration};

    const CHILD_ROOT: &str = "UMMKA_TEST_HISTORY_RECLAMATION_ROOT";

    #[test]
    fn waits_for_a_reader_in_another_process_before_confirming_purge() {
        let root = tempfile::tempdir().unwrap();
        let owner = fill(root.path(), URL).unwrap();
        let mut first = database(root.path(), URL).unwrap();
        first
            .read(&owner, |tx| {
                assert_eq!(count(tx)?, ROWS);
                let output = Command::new(env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "history::checks::reclamation::processes::purge_in_child",
                        "--nocapture",
                    ])
                    .env(CHILD_ROOT, root.path())
                    .output()
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{}",
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(
                    String::from_utf8_lossy(&output.stdout)
                        .contains("UMMKA_HISTORY checkpoint busy")
                );
                assert_eq!(count(tx)?, ROWS);
                Ok(())
            })
            .unwrap();
        assert_eq!(
            first.read(&owner, |tx| count(tx)),
            Err(HistoryError::StaleOwner)
        );
        first.purge(&owner).unwrap();
        assert_eq!(count(&first.connection).unwrap(), 0);
    }

    #[test]
    fn purge_in_child() {
        let Some(root) = env::var_os(CHILD_ROOT) else {
            return;
        };
        let mut second = database(Path::new(&root), URL).unwrap();
        let owner = second.restore(&account(URL, ALICE)).unwrap();
        second
            .connection
            .busy_timeout(Duration::from_millis(50))
            .unwrap();
        assert_eq!(second.purge(&owner), Err(HistoryError::Storage));
        assert!(stored_owner(&second.connection).unwrap().is_none());
        println!("UMMKA_HISTORY checkpoint busy");
    }
}
