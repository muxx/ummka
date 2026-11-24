//! Runs only in the disposable release instrumentation APK.
use super::{AndroidCredentialStore, CredentialError, CredentialStore, Removal};
use crate::sessions::{Account, SessionToken};
use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JObject, JString};
use rusqlite::Connection;
use std::error::Error;

const BASE: &str = "https://vault.example.test/Team";
const PEER: &str = "https://vault.example.test/peers";
const RACE: &str = "https://vault.example.test/race";
const NEIGHBOR: &str = "https://vault.example.test/team";
const FIRST: &str = "Abc01234567890123456789012";
const SECOND: &str = "abc01234567890123456789012";

pub(crate) fn reject_commits(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE fixture_child (id INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fixture_refuse_update AFTER UPDATE ON sessions
          BEGIN INSERT INTO fixture_child VALUES (1); END;
        CREATE TRIGGER fixture_refuse_delete AFTER DELETE ON sessions
          BEGIN INSERT INTO fixture_child VALUES (1); END;")
}

pub(crate) fn allow_commits(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "DROP TRIGGER fixture_refuse_delete; DROP TRIGGER fixture_refuse_update;
        DROP TABLE fixture_child; DROP TABLE fixture_parent;",
    )
}

#[cfg(feature = "webview-check")]
pub(crate) fn reject_first_account_removal() -> Result<(), CredentialError> {
    let db = AndroidCredentialStore::for_app()?.connect()?;
    db.execute_batch("CREATE TABLE webview_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE webview_child (id INTEGER REFERENCES webview_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER webview_refuse_first_delete AFTER DELETE ON sessions
          WHEN OLD.user_id = 'Abc01234567890123456789012'
          BEGIN INSERT INTO webview_child VALUES (1); END;")?;
    Ok(())
}

fn run(phase: &str) -> Result<(), Box<dyn Error>> {
    let store = AndroidCredentialStore::for_app()?;
    let first = Account::new(BASE, FIRST)?;
    let second = Account::new(PEER, SECOND)?;
    let neighbor = Account::new(NEIGHBOR, FIRST)?;
    let old = SessionToken::new("fixture-original-credential")?;
    let updated = SessionToken::new("fixture-rotated-credential")?;
    let peer = SessionToken::new("fixture-peer-credential")?;
    let verify = |a: &Account, token: &SessionToken| -> Result<(), CredentialError> {
        let loaded = store.read(a)?.ok_or(CredentialError::InvalidEntry)?;
        assert!(
            loaded.secret() == token.secret(),
            "wrong fixture credential"
        );
        Ok(())
    };
    let ciphertext = |db: &Connection| -> rusqlite::Result<Vec<u8>> {
        db.query_row(
            "SELECT sealed FROM sessions WHERE installation=?1 AND user_id=?2",
            [BASE, FIRST],
            |r| r.get(0),
        )
    };
    match phase {
        "seed" => {
            assert!(store.account_ids(BASE)?.is_empty());
            assert!(store.read(&first)?.is_none());
            store.remove(&first)?;
            store.save(&first, &old)?;
            assert_eq!(
                store.save(&Account::new(BASE, SECOND)?, &peer),
                Err(CredentialError::InstallationAccountConflict)
            );
            store.save(&second, &peer)?;
            store.save(&neighbor, &peer)?;
            racing_writers(&store)?;
        }
        "reject" => {
            assert_eq!(store.account_ids(BASE)?, [FIRST]);
            assert_eq!(store.account_ids(PEER)?, [SECOND]);
            let winners = store.account_ids(RACE)?;
            assert_eq!(winners.len(), 1);
            let winner = Account::new(RACE, &winners[0])?;
            verify(&winner, &SessionToken::new(winner.user_id())?)?;
            store.remove(&winner)?;
            legacy_accounts(&store)?;
            assert_eq!(store.account_ids(NEIGHBOR)?, [FIRST]);
            verify(&first, &old)?;
            let mut db = store.connect()?;
            let initial = ciphertext(&db)?;
            store.save(&first, &updated)?;
            let rotated = ciphertext(&db)?;
            assert_ne!(&initial[..12], &rotated[..12]);
            reject_commits(&db)?;
            // Both statements succeed before the deferred constraint rejects COMMIT.
            for sql in [
                "UPDATE sessions SET sealed=sealed WHERE installation=?1 AND user_id=?2",
                "DELETE FROM sessions WHERE installation=?1 AND user_id=?2",
            ] {
                let tx = db.transaction()?;
                assert_eq!(tx.execute(sql, [BASE, FIRST])?, 1);
                assert_eq!(
                    tx.commit().unwrap_err().sqlite_extended_error_code(),
                    Some(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY)
                );
            }
            assert_eq!(
                store.save(&first, &old),
                Err(CredentialError::StorageUnavailable)
            );
            assert_eq!(
                store.remove(&first),
                Err(CredentialError::StorageUnavailable)
            );
            assert_eq!(
                store.remove_matching(&first, &updated),
                Err(CredentialError::StorageUnavailable)
            );
            verify(&first, &updated)?;
            allow_commits(&db)?;
            // Copy a valid envelope to a different account and to a case-distinct installation.
            for a in [&second, &neighbor] {
                db.execute(
                    "UPDATE sessions SET sealed=?1 WHERE installation=?2 AND user_id=?3",
                    rusqlite::params![rotated, a.installation(), a.user_id()],
                )?;
                assert!(matches!(store.read(a), Err(CredentialError::InvalidEntry)));
                store.save(a, &peer)?;
            }
            let parent = store.path.parent().ok_or("missing fixture directory")?;
            for file in std::fs::read_dir(parent)? {
                let file = file?;
                if file
                    .file_name()
                    .to_string_lossy()
                    .starts_with("account-sessions.sqlite")
                {
                    let bytes = std::fs::read(file.path())?;
                    for secret in [&old, &updated, &peer] {
                        assert!(
                            !bytes
                                .windows(secret.secret().len())
                                .any(|s| s == secret.secret()),
                            "plaintext fixture in database"
                        );
                    }
                }
            }
        }
        "remove" => {
            assert_eq!(store.remove_matching(&first, &old)?, Removal::Superseded);
            verify(&first, &updated)?;
            verify(&second, &peer)?;
            verify(&neighbor, &peer)?;
            assert_eq!(store.remove_matching(&first, &updated)?, Removal::Removed);
            assert_eq!(store.remove_matching(&first, &updated)?, Removal::Removed);
        }
        "confirm" => {
            assert!(store.read(&first)?.is_none());
            assert!(store.account_ids(BASE)?.is_empty());
            assert_eq!(store.account_ids(PEER)?, [SECOND]);
            let next = Account::new(BASE, SECOND)?;
            store.save(&next, &peer)?;
            verify(&next, &peer)?;
            store.remove(&next)?;
            verify(&second, &peer)?;
            verify(&neighbor, &peer)?;
        }
        "missing_key" => {
            assert!(matches!(
                store.read(&second),
                Err(CredentialError::StorageUnavailable)
            ));
            assert_eq!(
                store.save(&first, &old),
                Err(CredentialError::StorageUnavailable)
            );
            store.remove(&second)?;
            store.remove(&neighbor)?;
        }
        _ => return Err("unknown vault fixture phase".into()),
    }
    Ok(())
}

fn racing_writers(store: &AndroidCredentialStore) -> Result<(), Box<dyn Error>> {
    let barrier = std::sync::Barrier::new(2);
    let save = |id| {
        let independent = AndroidCredentialStore {
            path: store.path.clone(),
        };
        let account = Account::new(RACE, id).unwrap();
        let token = SessionToken::new(id).unwrap();
        barrier.wait();
        independent.save(&account, &token)
    };
    let (first, second) = std::thread::scope(|scope| {
        let first = scope.spawn(|| save(FIRST));
        let second = save(SECOND);
        (first.join().unwrap(), second)
    });
    let conflict = Err(CredentialError::InstallationAccountConflict);
    assert!(matches!((&first, &second), (Ok(()), e) | (e, Ok(())) if e == &conflict));
    let winner = if first.is_ok() { FIRST } else { SECOND };
    assert_eq!(store.account_ids(RACE)?, [winner]);
    Ok(())
}

fn legacy_accounts(store: &AndroidCredentialStore) -> Result<(), Box<dyn Error>> {
    let base = "https://vault.example.test/legacy";
    let first = Account::new(base, FIRST)?;
    let peer = Account::new(base, SECOND)?;
    let old = SessionToken::new("legacy-original")?;
    let next = SessionToken::new("replacement")?;
    store.save(&first, &old)?;
    let db = store.connect()?;
    let sealed = super::keystore::seal(
        &super::associated_data(&peer),
        peer.user_id().as_bytes(),
        false,
    )?;
    db.execute(
        "INSERT INTO sessions (installation,user_id,sealed) VALUES (?1,?2,?3)",
        rusqlite::params![base, SECOND, sealed],
    )?;
    assert_eq!(
        store.save(&first, &next),
        Err(CredentialError::InstallationAccountConflict)
    );
    assert_eq!(store.account_ids(base)?, [FIRST, SECOND]);
    assert_eq!(store.read(&first)?.unwrap().secret(), old.secret());
    assert_eq!(store.read(&peer)?.unwrap().secret(), SECOND.as_bytes());
    // A valid envelope from the same installation still belongs to its original user.
    db.execute(
        "UPDATE sessions SET sealed=?1 WHERE installation=?2 AND user_id=?3",
        rusqlite::params![sealed, base, FIRST],
    )?;
    assert!(matches!(
        store.read(&first),
        Err(CredentialError::InvalidEntry)
    ));
    store.remove(&peer)?;
    store.save(&first, &next)?;
    db.execute(
        "INSERT INTO sessions (installation,user_id,sealed) VALUES (?1,'malformed',?2)",
        rusqlite::params![base, sealed],
    )?;
    assert_eq!(store.save(&first, &old), Err(CredentialError::InvalidEntry));
    db.execute(
        "DELETE FROM sessions WHERE installation=?1 AND user_id='malformed'",
        [base],
    )?;
    assert_eq!(store.read(&first)?.unwrap().secret(), next.secret());
    store.remove(&first)?;
    Ok(())
}

#[jni::jni_mangle("io.github.muxx.ummka.dev.HttpCheckInstrumentation")]
pub fn check_vault<'local>(
    mut env: jni::EnvUnowned<'local>,
    _: JObject<'local>,
    phase: JString<'local>,
) {
    env.with_env(|env| {
        if run(&phase.try_to_string(env)?).is_err() {
            env.throw_new(
                jni::jni_str!("java/lang/AssertionError"),
                jni::jni_str!("native credential check failed"),
            )?;
        }
        Ok::<(), jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}
