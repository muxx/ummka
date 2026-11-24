use super::{ALICE, account};
use crate::history::{
    HistoryDatabase, HistoryError, filename,
    schema::{CREATE_OWNER, Migration},
};
use rusqlite::{Connection, TransactionBehavior};
use std::{
    fs,
    path::Path,
    sync::{Barrier, mpsc},
    thread,
    time::Duration,
};

const URL: &str = "https://chat.example.test/migrations";
const ORIGINAL: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const CREATE_LABELS: &str = "CREATE TABLE fixture_labels (owner INTEGER PRIMARY KEY REFERENCES history_owner(slot), label TEXT NOT NULL) STRICT";
const OBJECTS: &[&str] = &[CREATE_OWNER, CREATE_LABELS];
// These versions exercise a schema change followed by a separate data change.
const CHAIN: &[Migration] = &[
    Migration {
        sql: CREATE_OWNER,
        objects: &[CREATE_OWNER],
    },
    Migration {
        sql: CREATE_LABELS,
        objects: OBJECTS,
    },
    Migration {
        sql: "INSERT INTO fixture_labels SELECT slot, user_id FROM history_owner",
        objects: OBJECTS,
    },
];

fn seed(root: &Path) -> Result<(), HistoryError> {
    let dir = root.join("history");
    fs::create_dir_all(&dir).map_err(|_| HistoryError::Storage)?;
    Connection::open(dir.join(filename(URL)))?.execute_batch(include_str!("v1.sql"))?;
    Ok(())
}

fn check_data(db: &mut HistoryDatabase) -> Result<(), HistoryError> {
    let owner = db.restore(&account(URL, ALICE))?;
    assert_eq!(owner.generation, ORIGINAL);
    let label: String = db.read(&owner, |tx| {
        tx.query_row(
            "SELECT label FROM fixture_labels WHERE owner = 1",
            [],
            |r| r.get(0),
        )
    })?;
    assert_eq!(label, ALICE);
    Ok(())
}

// An open copy sees v1 while a second writer holds an uncommitted v2.
// Signal at SQLite's actual lock conflict, then publish v2 before letting it retry.
fn waits_for_migration(root: &Path) -> Result<(), HistoryError> {
    seed(root)?;
    let mut first = HistoryDatabase::open(root, URL)?;
    let writer = first
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    writer.execute(CREATE_LABELS, [])?;
    writer.pragma_update(None, "user_version", 2)?;

    let path = root.join("history").join(filename(URL));
    let (blocked, observed) = mpsc::channel();
    let (resume, released) = mpsc::channel();
    let timeout = Duration::from_secs(10);
    thread::scope(|scope| -> Result<(), HistoryError> {
        let other = scope.spawn(move || -> Result<i64, HistoryError> {
            let mut connection = Connection::open(path)?;
            connection.busy_handler(Some(move |attempt| {
                attempt == 0 && blocked.send(()).is_ok() && released.recv_timeout(timeout).is_ok()
            }))?;
            crate::history::schema::upgrade(&mut connection, URL, CHAIN)
        });
        observed
            .recv_timeout(timeout)
            .expect("second migration reached the held writer");
        writer.commit()?;
        resume.send(()).expect("second migration is waiting");
        assert_eq!(other.join().expect("migration worker")?, 3);
        Ok(())
    })?;
    check_data(&mut HistoryDatabase::open_with(root, URL, CHAIN)?)
}

pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    waits_for_migration(&root.join("contended"))?;
    let skipped = root.join("skipped");
    seed(&skipped)?;
    let mut old = HistoryDatabase::open(&skipped, URL)?;
    let handle = old.restore(&account(URL, ALICE))?;
    assert_eq!(handle.generation, ORIGINAL);
    let broken = [
        Migration {
            sql: CREATE_OWNER,
            objects: &[CREATE_OWNER],
        },
        Migration {
            sql: CREATE_LABELS,
            objects: OBJECTS,
        },
        Migration {
            sql: "INSERT INTO fixture_labels VALUES(1, 'partial'); INSERT INTO missing VALUES(1);",
            objects: OBJECTS,
        },
    ];
    assert_eq!(
        HistoryDatabase::open_with(&skipped, URL, &broken).err(),
        Some(HistoryError::Storage)
    );
    let mut reopened = HistoryDatabase::open(&skipped, URL)?;
    assert!(reopened.restore(&account(URL, ALICE))? == handle);
    drop(reopened);

    // Two independent copies apply the entire skipped-release chain exactly once.
    let ready = Barrier::new(2);
    thread::scope(|scope| -> Result<(), HistoryError> {
        let workers = [(), ()].map(|()| {
            scope.spawn(|| {
                ready.wait();
                check_data(&mut HistoryDatabase::open_with(&skipped, URL, CHAIN)?)
            })
        });
        for worker in workers {
            worker.join().expect("migration worker")?;
        }
        Ok(())
    })?;
    let unsupported = Err(HistoryError::UnsupportedSchema);
    assert_eq!(
        old.read(&handle, |_| -> rusqlite::Result<()> { panic!("old read") }),
        unsupported
    );
    assert_eq!(
        old.write(&handle, |_| -> rusqlite::Result<()> { panic!("old write") }),
        unsupported
    );
    assert_eq!(
        old.new_login(&account(URL, ALICE)).err(),
        Some(HistoryError::UnsupportedSchema)
    );
    assert_eq!(
        HistoryDatabase::open(&skipped, URL).err(),
        Some(HistoryError::UnsupportedSchema)
    );
    check_data(&mut HistoryDatabase::open_with(&skipped, URL, CHAIN)?)?;

    let successive = root.join("successive");
    seed(&successive)?;
    let second = HistoryDatabase::open_with(&successive, URL, &CHAIN[..2])?;
    let rows: i64 =
        second
            .connection
            .query_row("SELECT count(*) FROM fixture_labels", [], |row| row.get(0))?;
    assert_eq!(rows, 0);
    drop(second);
    check_data(&mut HistoryDatabase::open_with(&successive, URL, CHAIN)?)?;

    let fresh = root.join("fresh");
    let current = HistoryDatabase::open_with(&fresh, URL, CHAIN)?;
    assert_eq!(
        current
            .connection
            .query_row("SELECT count(*) FROM fixture_labels", [], |r| r
                .get::<_, i64>(0))?,
        0
    );
    Ok(())
}
