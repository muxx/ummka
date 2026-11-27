mod attachments;
pub(crate) mod departure;
mod departure_schema;
pub(crate) mod migrations;
#[cfg(test)]
mod post_observations;
pub(crate) mod posts;
pub(crate) mod reclamation;
mod thread_summaries;
pub(crate) mod windows;

use super::{HistoryDatabase, HistoryError, HistoryOwner};
use crate::sessions::Account;
use std::{path::Path, sync::Barrier, thread};

const ALICE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

fn account(base: &str, user: &str) -> Account {
    Account::new(base, user).expect("valid fixture account")
}

fn concurrent_restore(
    root: &Path,
    base: &str,
    users: [&str; 2],
) -> [Result<HistoryOwner, HistoryError>; 2] {
    let start = Barrier::new(2);
    thread::scope(|scope| {
        users
            .map(|user| {
                scope.spawn(|| {
                    let identity = account(base, user);
                    start.wait();
                    HistoryDatabase::open(root, base)?.restore(&identity)
                })
            })
            .map(|task| task.join().expect("history worker"))
    })
}

pub(crate) fn check_channel_departure(root: &Path) -> Result<(), HistoryError> {
    departure::round_trip(&root.join("membership-scope"))?;
    departure_schema::check(&root.join("membership-schema"))
}

/// Exercise the same files, transactions and competing connections on macOS and Android.
pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    let base = "https://chat.example.test:8443/team/a";
    let other = "https://chat.example.test:8443/team/b";
    let alice = account(base, ALICE);
    let [left, right] = concurrent_restore(root, base, [ALICE, ALICE]);
    let saved = left?;
    assert!(right? == saved);
    let [left, right] = concurrent_restore(root, other, [ALICE, BOB]);
    let (winner, loser) = if left.is_ok() {
        (left, right)
    } else {
        (right, left)
    };
    let other_owner = winner?;
    assert_eq!(loser.err(), Some(HistoryError::OwnerConflict));

    let mut db = HistoryDatabase::open(root, base)?;
    assert!(db.restore(&alice)? == saved);
    assert_eq!(
        db.restore(&account(base, BOB)).err(),
        Some(HistoryError::OwnerConflict)
    );
    assert_eq!(
        db.new_login(&account(other, ALICE)).err(),
        Some(HistoryError::OwnerConflict)
    );
    assert_eq!(
        db.read(&other_owner, |_| Ok(())).err(),
        Some(HistoryError::StaleOwner)
    );
    let mut second = HistoryDatabase::open(root, base)?;
    db.write(&saved, |tx| tx.execute_batch(
        "CREATE TABLE fixture_message(owner INTEGER REFERENCES history_owner(slot) ON DELETE CASCADE, body TEXT);
         INSERT INTO fixture_message VALUES (1, 'kept');"
    ))?;
    let first = second.new_login(&alice)?;
    let current = second.new_login(&alice)?;
    for stale in [&first, &saved] {
        assert_eq!(
            db.read(stale, |_| -> rusqlite::Result<()> { panic!("stale read") }),
            Err(HistoryError::StaleOwner)
        );
        assert_eq!(
            db.write(stale, |_| -> rusqlite::Result<()> { panic!("stale write") }),
            Err(HistoryError::StaleOwner)
        );
    }
    assert_eq!(
        db.write(&current, |tx| {
            tx.execute("UPDATE fixture_message SET body = 'discarded'", [])?;
            Err::<(), _>(rusqlite::Error::InvalidQuery)
        }),
        Err(HistoryError::Storage)
    );
    assert_eq!(
        db.read(&current, |tx| tx.execute("DELETE FROM fixture_message", [])),
        Err(HistoryError::Storage)
    );
    let value: String = db.read(&current, |tx| {
        tx.query_row("SELECT body FROM fixture_message", [], |row| row.get(0))
    })?;
    assert_eq!(value, "kept");
    db.write(&current, |tx| {
        tx.execute_batch("DROP TABLE fixture_message")
    })?;
    drop(db);
    drop(second);
    assert!(HistoryDatabase::open(root, base)?.restore(&alice)? == current);

    let long = format!(
        "https://chat.example.test/{}",
        "prefix/".repeat(80).trim_end_matches('/')
    );
    let identity = account(&long, ALICE);
    let expected = HistoryDatabase::open(root, &long)?.restore(&identity)?;
    assert!(HistoryDatabase::open(root, &long)?.restore(&identity)? == expected);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::filename;
    use crate::history::schema::{APPLICATION_ID, CREATE_OWNER, MIGRATIONS};
    use rusqlite::Connection;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn forgets_only_the_departed_channel_across_open_copies() {
        let root = tempdir().unwrap();
        check_channel_departure(root.path()).unwrap();
    }

    #[test]
    fn isolates_installations_and_rotates_only_new_logins() {
        round_trip(tempdir().unwrap().path()).unwrap();
    }

    #[test]
    fn upgrades_populated_files_across_releases_and_rolls_back_failed_steps() {
        migrations::round_trip(tempdir().unwrap().path()).unwrap();
    }

    #[test]
    fn purges_only_the_matching_history_and_reclaims_its_pages() {
        reclamation::round_trip(tempdir().unwrap().path()).unwrap();
    }

    #[test]
    fn uses_a_private_directory_and_fixed_names_for_canonical_https_only() {
        let root = tempdir().unwrap();
        for invalid in [
            "http://chat.example.test",
            "https://CHAT.example.test",
            "https://chat.example.test/a/",
        ] {
            assert_eq!(
                HistoryDatabase::open(root.path(), invalid).err(),
                Some(HistoryError::InvalidInstallation)
            );
        }
        let dir = root.path().join("history");
        assert!(!dir.exists());
        let url = "https://chat.example.test/team";
        let db = HistoryDatabase::open(root.path(), url).unwrap();
        assert!(dir.join(filename(url)).is_file());
        assert_eq!(
            filename(url),
            "ea2c49128ce161e2a00429b9ff5aacdb8645f165f1e3c04c61d717970fb46867.sqlite"
        );
        #[cfg(unix)]
        assert_eq!(
            std::os::unix::fs::PermissionsExt::mode(&fs::metadata(&dir).unwrap().permissions())
                & 0o777,
            0o700
        );
        for (key, expected) in [
            ("application_id", APPLICATION_ID),
            ("user_version", i64::try_from(MIGRATIONS.len()).unwrap()),
            ("foreign_keys", 1),
            ("auto_vacuum", 2),
            ("busy_timeout", 5000),
        ] {
            assert_eq!(
                db.connection
                    .pragma_query_value(None, key, |row| row.get::<_, i64>(0))
                    .unwrap(),
                expected
            );
        }
        assert_eq!(
            db.connection
                .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
    }

    #[test]
    fn preserves_unrecognized_files_and_databases_copied_from_another_installation() {
        let url = "https://chat.example.test/alpha";
        let other = "https://chat.example.test/beta";
        for case in [
            "foreign",
            "version",
            "definition",
            "vacuum",
            "other installation",
        ] {
            let root = tempdir().unwrap();
            let dir = root.path().join("history");
            fs::create_dir(&dir).unwrap();
            let path = dir.join(filename(url));
            {
                let db = Connection::open(&path).unwrap();
                if case != "vacuum" {
                    db.pragma_update(None, "auto_vacuum", "INCREMENTAL")
                        .unwrap();
                }
                if case == "foreign" {
                    db.execute_batch(
                        "CREATE TABLE existing(value); INSERT INTO existing VALUES ('preserve')",
                    )
                    .unwrap();
                } else {
                    db.execute_batch(if case == "definition" {
                        "CREATE TABLE history_owner(slot INTEGER)"
                    } else {
                        CREATE_OWNER
                    })
                    .unwrap();
                    db.pragma_update(None, "application_id", APPLICATION_ID)
                        .unwrap();
                    db.pragma_update(None, "user_version", if case == "version" { 9 } else { 1 })
                        .unwrap();
                    if case == "other installation" {
                        db.execute(
                            "INSERT INTO history_owner VALUES (1, ?1, ?2, randomblob(16))",
                            [other, ALICE],
                        )
                        .unwrap();
                    }
                }
            }
            let bytes = fs::read(&path).unwrap();
            let expected = if case == "other installation" {
                HistoryError::OwnerConflict
            } else {
                HistoryError::UnsupportedSchema
            };
            assert_eq!(
                HistoryDatabase::open(root.path(), url).err(),
                Some(expected),
                "{case}"
            );
            assert_eq!(fs::read(&path).unwrap(), bytes, "{case}");
            assert_eq!(fs::read_dir(dir).unwrap().count(), 1);
        }
    }
}
