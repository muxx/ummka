use super::*;
use security_framework::os::macos::keychain::CreateOptions;
use std::path::{Path, PathBuf};
use std::process::Command;

const BASE: &str = "https://chat.example.test/Team";
const PREFIX: &str = "https://chat.example.test/team";
const FIRST: &str = "Abc01234567890123456789012";
const CASE_PEER: &str = "abc01234567890123456789012";
const SECOND: &str = "bbc01234567890123456789012";

fn keychain_command(args: &[&str]) -> Vec<u8> {
    let output = Command::new("/usr/bin/security")
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "fixture keychain command failed");
    output.stdout
}

struct DisposableKeychain(PathBuf);
impl Drop for DisposableKeychain {
    fn drop(&mut self) {
        let _ = Command::new("/usr/bin/security")
            .arg("delete-keychain")
            .arg(&self.0)
            .output();
    }
}

#[test]
fn accounts_survive_processes_in_an_explicit_disposable_keychain() {
    let original = keychain_command(&["list-keychains", "-d", "user"]);
    let dir = tempfile::tempdir().unwrap();
    let keyfile = dir.path().join("accounts.keychain-db");
    let password = dir.path().file_name().unwrap().to_str().unwrap();
    drop(
        CreateOptions::new()
            .password(password)
            .create(&keyfile)
            .unwrap(),
    );
    let cleanup = DisposableKeychain(keyfile.clone());
    let keyfile = keyfile.to_str().unwrap();
    let run = |phase: &str| {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "credentials::macos::tests::check_one_process",
                "--nocapture",
            ])
            .env("UMMKA_TEST_KEYCHAIN_PATH", keyfile)
            .env("UMMKA_TEST_KEYCHAIN_PHASE", phase)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "keychain phase {phase} failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(
            String::from_utf8_lossy(&result.stdout)
                .lines()
                .any(|line| line == format!("UMMKA_KEYCHAIN {phase}"))
        );
    };
    run("seed");
    let writer = File::open(Path::new(keyfile).with_extension("writers.lock")).unwrap();
    assert_eq!(writer.metadata().unwrap().len(), 0);
    writer.lock().unwrap();
    run("writer-held");
    drop(writer);
    run("rotate");
    keychain_command(&["lock-keychain", keyfile]);
    run("locked");
    keychain_command(&["unlock-keychain", "-p", password, keyfile]);
    run("remove");
    run("confirm");
    drop(cleanup);
    assert!(!Path::new(keyfile).exists());
    assert!(
        original == keychain_command(&["list-keychains", "-d", "user"]),
        "temporary keychain changed the user's search list"
    );
}

#[test]
fn check_one_process() {
    let Ok(phase) = std::env::var("UMMKA_TEST_KEYCHAIN_PHASE") else {
        return;
    };
    let file = std::env::var_os("UMMKA_TEST_KEYCHAIN_PATH").unwrap();
    let keychain = SecKeychain::open(Path::new(&file)).unwrap();
    let _interaction = SecKeychain::disable_user_interaction().unwrap();
    let writer = Path::new(&file).with_extension("writers.lock");
    let other_app = MacCredentialStore {
        writer: writer.clone(),
        keychain: keychain.clone(),
        application_id: "io.github.muxx.ummka.fixture-other".into(),
    };
    let store = MacCredentialStore {
        writer,
        keychain,
        application_id: "io.github.muxx.ummka.fixture".into(),
    };
    let first = Account::new(BASE, FIRST).unwrap();
    let second = Account::new(BASE, SECOND).unwrap();
    let case_peer = Account::new(BASE, CASE_PEER).unwrap();
    let neighbor = Account::new(PREFIX, FIRST).unwrap();
    let save = |store: &MacCredentialStore, account: &Account, raw| {
        store.save(account, &SessionToken::new(raw).unwrap())
    };
    let verify = |store: &MacCredentialStore, account: &Account, raw: &str| {
        assert!(
            store.read(account).unwrap().unwrap().secret() == raw.as_bytes(),
            "unexpected fixture credential"
        );
    };
    match phase.as_str() {
        "seed" => {
            assert!(store.account_ids(BASE).unwrap().is_empty());
            // The preceding release stored an ordinary generic password with these exact attributes.
            store
                .keychain
                .add_generic_password(&store.service(BASE), FIRST, b"fixture-first")
                .unwrap();
            save(&store, &second, "fixture-second").unwrap();
            save(&store, &case_peer, "fixture-case").unwrap();
            save(&store, &neighbor, "fixture-neighbor").unwrap();
            save(&other_app, &first, "fixture-other-app").unwrap();
        }
        "writer-held" => {
            let guard = File::open(&store.writer).unwrap();
            assert!(matches!(
                guard.try_lock(),
                Err(std::fs::TryLockError::WouldBlock)
            ));
            verify(&store, &first, "fixture-first");
            // An unusable coordinator must stop every writer before it reaches Keychain.
            let unavailable = MacCredentialStore {
                keychain: store.keychain.clone(),
                application_id: store.application_id.clone(),
                writer: Path::new(&file).parent().unwrap().to_path_buf(),
            };
            let expected = SessionToken::new("fixture-first").unwrap();
            assert_eq!(
                unavailable.save(&first, &expected),
                Err(CredentialError::StorageUnavailable)
            );
            assert_eq!(
                unavailable.remove(&first),
                Err(CredentialError::StorageUnavailable)
            );
            assert_eq!(
                unavailable.remove_matching(&first, &expected),
                Err(CredentialError::StorageUnavailable)
            );
            verify(&store, &first, "fixture-first");
        }
        "rotate" => {
            assert_eq!(store.account_ids(BASE).unwrap(), [FIRST, CASE_PEER, SECOND]);
            assert_eq!(store.account_ids(PREFIX).unwrap(), [FIRST]);
            verify(&store, &first, "fixture-first");
            save(&store, &first, "fixture-updated").unwrap();
            assert!(matches!(
                store.account_ids("http://chat.example.test"),
                Err(CredentialError::InvalidInstallation)
            ));
        }
        "locked" => {
            assert!(matches!(
                store.read(&first),
                Err(CredentialError::StorageUnavailable)
            ));
            assert_eq!(
                save(&store, &first, "fixture-refused"),
                Err(CredentialError::StorageUnavailable)
            );
            assert_eq!(
                store.remove(&first),
                Err(CredentialError::StorageUnavailable)
            );
        }
        "remove" => {
            let old = SessionToken::new("fixture-first").unwrap();
            let current = SessionToken::new("fixture-updated").unwrap();
            assert_eq!(store.remove_matching(&first, &old), Ok(Removal::Superseded));
            verify(&store, &first, "fixture-updated");
            assert_eq!(
                store.remove_matching(&first, &current),
                Ok(Removal::Removed)
            );
            assert_eq!(
                store.remove_matching(&first, &current),
                Ok(Removal::Removed)
            );
            store.remove(&first).unwrap();
        }
        "confirm" => {
            assert!(store.read(&first).unwrap().is_none());
            assert_eq!(store.account_ids(BASE).unwrap(), [CASE_PEER, SECOND]);
            verify(&store, &case_peer, "fixture-case");
            verify(&store, &second, "fixture-second");
            verify(&store, &neighbor, "fixture-neighbor");
            verify(&other_app, &first, "fixture-other-app");
            store
                .keychain
                .add_generic_password(&store.service(BASE), FIRST, &[0xff])
                .unwrap();
            assert!(matches!(
                store.read(&first),
                Err(CredentialError::InvalidEntry)
            ));
        }
        _ => panic!("unknown keychain fixture phase"),
    }
    println!("UMMKA_KEYCHAIN {phase}");
}
