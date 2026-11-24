//! Real native sign-in, isolated platform credentials and a file-backed history view.
use super::*;
use crate::credentials::Removal;
use crate::history::HistoryError;
use crate::sessions::AccountSessions;
use std::path::Path;

const USER: &str = "Abc01234567890123456789012";

#[cfg(target_os = "macos")]
fn sessions(root: &Path) -> AccountSessions {
    use crate::credentials::macos::MacCredentialStore;
    let path = root.join("history.keychain-db");
    AccountSessions::with_store(move || {
        Ok(Box::new(MacCredentialStore::at_keychain(
            &path,
            "io.github.muxx.ummka.history-test",
        )?))
    })
}

#[cfg(target_os = "android")]
fn sessions(root: &Path) -> AccountSessions {
    use crate::credentials::android::AndroidCredentialStore;
    let path = root.join("fixture-credentials.sqlite");
    AccountSessions::with_store(move || Ok(Box::new(AndroidCredentialStore::at_path(path.clone()))))
}

#[cfg(target_os = "macos")]
fn vault(root: &Path, verb: &str) -> CheckResult {
    let mut cmd = std::process::Command::new("/usr/bin/security");
    cmd.arg(verb);
    if matches!(verb, "create-keychain" | "unlock-keychain") {
        cmd.args(["-p", root.to_str().ok_or("invalid fixture path")?]);
    }
    if !cmd
        .arg(root.join("history.keychain-db"))
        .output()?
        .status
        .success()
    {
        return Err("temporary keychain command failed".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
struct DisposableVault<'a>(&'a Path);

#[cfg(target_os = "macos")]
impl Drop for DisposableVault<'_> {
    fn drop(&mut self) {
        let _ = vault(self.0, "delete-keychain");
    }
}

fn refuse_write(root: &Path, refuse: bool) -> CheckResult {
    #[cfg(target_os = "macos")]
    {
        vault(
            root,
            if refuse {
                "lock-keychain"
            } else {
                "unlock-keychain"
            },
        )?;
    }
    #[cfg(target_os = "android")]
    {
        use crate::credentials::android::checks::{allow_commits, reject_commits};
        let db = rusqlite::Connection::open(root.join("fixture-credentials.sqlite"))?;
        if refuse {
            reject_commits(&db)?;
            db.execute_batch("CREATE TRIGGER fixture_refuse_insert AFTER INSERT ON sessions BEGIN INSERT INTO fixture_child VALUES (1); END")?;
        } else {
            db.execute_batch("DROP TRIGGER fixture_refuse_insert")?;
            allow_commits(&db)?;
        }
    }
    Ok(())
}

pub(super) async fn check(
    client: &NativeAuthentication,
    base: &str,
    fixtures: &Path,
) -> CheckResult {
    let root = fixtures.join("login-history");
    std::fs::create_dir(&root)?;
    #[cfg(target_os = "macos")]
    let (_vault, _interaction) = {
        vault(&root, "create-keychain")?;
        (
            DisposableVault(&root),
            security_framework::os::macos::keychain::SecKeychain::disable_user_interaction()?,
        )
    };
    let first = sessions(&root);
    let second = sessions(&root);
    assert!(first.account_ids(&client.base).await?.is_empty());
    refuse_write(&root, true)?;
    assert!(matches!(
        client.sign_in(&first, input("history-first-fail")).await,
        Err(SignInError::NotSaved {
            revocation: Revocation::Confirmed,
            ..
        })
    ));
    assert!(!root.join("history").exists());
    refuse_write(&root, false)?;
    let peer = client.sign_in(&first, input("peer-history-first")).await?;
    open(client, &first, peer.user_id())
        .await?
        .sign_out_on_device(&first)
        .await?;
    assert!(!root.join("history").exists());

    client.sign_in(&first, input("history-a")).await?;
    let previous = open(client, &first, USER).await?;
    let external = open(client, &second, USER).await?;
    let mut page = previous.open_history(&first).await?;
    let mut restored = external.open_history(&second).await?;
    use crate::history::{
        PageWrite,
        checks::posts::{CHANNEL, ROOT, fixture},
    };
    let load = page.begin_channel_load(CHANNEL)?;
    assert_eq!(
        page.apply_channel_page(load, &fixture())?,
        PageWrite::Applied
    );
    let earlier = restored.begin_channel_load(CHANNEL)?;
    let cached = restored
        .read_post(ROOT)?
        .expect("stored authenticated post");
    let owner_generation = |tx: &rusqlite::Transaction<'_>| {
        tx.query_row("SELECT generation FROM history_owner", [], |r| {
            r.get::<_, Vec<u8>>(0)
        })
    };
    assert_eq!(
        page.read(owner_generation)?,
        restored.read(owner_generation)?
    );
    refuse_write(&root, true)?;
    let rejected = tokio::spawn({
        let client = client.clone();
        let first = first.clone();
        async move { client.sign_in(&first, input("history-rejected")).await }
    });
    sign_out::control(client, base, "history-rejected", "received").await?;
    refuse_write(&root, false)?;
    assert_eq!(page.write(|_| Ok(())), Err(HistoryError::StaleOwner));
    let mut reopened = external.open_history(&second).await?;
    assert_eq!(
        reopened.apply_channel_page(earlier, &[]),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(reopened.read_post(ROOT)?, Some(cached));
    reopened.read(owner_generation)?;
    me(&previous, client).await?;
    sign_out::control(client, base, "history-rejected", "release").await?;
    assert!(matches!(
        rejected.await?,
        Err(SignInError::NotSaved {
            revocation: Revocation::Confirmed,
            ..
        })
    ));

    client.sign_in(&second, input("history-old-out")).await?;
    assert!(matches!(
        previous.open_history(&first).await,
        Err(TransportError::SessionUnavailable)
    ));
    let old = open(client, &second, USER).await?;
    let mut old_page = old.open_history(&second).await?;
    let logout = tokio::spawn({
        let second = second.clone();
        async move { old.sign_out(&second).await }
    });
    sign_out::control(client, base, "history-old-out", "received").await?;
    client.sign_in(&first, input("history-unconfirmed")).await?;
    let current = open(client, &first, USER).await?;
    let mut current_page = current.open_history(&first).await?;
    sign_out::control(client, base, "history-old-out", "release").await?;
    assert_eq!(logout.await??, SignOut::Superseded);
    assert_eq!(old_page.write(|_| Ok(())), Err(HistoryError::StaleOwner));
    assert_eq!(current.sign_out(&first).await?, SignOut::Unconfirmed);
    current_page.read(owner_generation)?;
    assert_eq!(current.sign_out_on_device(&first).await?, Removal::Removed);
    assert_eq!(
        current_page.read(owner_generation),
        Err(HistoryError::StaleOwner)
    );

    client.sign_in(&first, input("history-unreadable")).await?;
    let unavailable = open(client, &first, USER).await?;
    let mut saved_page = unavailable.open_history(&first).await?;
    let path: String = saved_page.read(|tx| {
        tx.query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |row| row.get(0),
        )
    })?;
    let fixture = rusqlite::Connection::open(path)?;
    let version: i64 = fixture.pragma_query_value(None, "user_version", |row| row.get(0))?;
    fixture.pragma_update(None, "user_version", version + 10)?;
    assert_eq!(
        unavailable.sign_out(&first).await?,
        SignOut::ServerConfirmedLocalRemovalFailed {
            cause: TransportError::HistoryStorageUnavailable
        }
    );
    assert_eq!(
        second.current_account_id(&client.base).await?.as_deref(),
        Some(USER)
    );
    fixture.pragma_update(None, "user_version", version)?;
    drop(fixture);
    saved_page.read(owner_generation)?;
    assert_eq!(
        unavailable.sign_out_on_device(&first).await?,
        Removal::Removed
    );

    client.sign_in(&first, input("history-final")).await?;
    let current = open(client, &first, USER).await?;
    let mut final_page = current.open_history(&first).await?;
    assert_eq!(final_page.read_post(ROOT)?, None);
    assert_eq!(current.sign_out(&first).await?, SignOut::SignedOut);
    assert_eq!(
        final_page.read(owner_generation),
        Err(HistoryError::StaleOwner)
    );
    assert!(second.account_ids(&client.base).await?.is_empty());
    Ok(())
}
