use super::fixture::{TestVault, using};
use super::*;
use tokio::sync::oneshot;

const BASE: &str = "https://chat.example.test/Team";
const PEER: &str = "https://chat.example.test/peer";
const FIRST: &str = "Abc01234567890123456789012";
const SECOND: &str = "bbc01234567890123456789012";

async fn verify(session: &AccountSession, expected: &[u8]) -> Result<(), TransportError> {
    session
        .dispatch(|token| async move {
            assert!(token.appears_in(expected));
            assert!(token.0.is_sensitive());
            assert!(!format!("{:?}", token.0).contains(std::str::from_utf8(expected).unwrap()));
            Ok(())
        })
        .await
}

#[tokio::test]
async fn isolates_accounts_installations_and_each_login() {
    let sessions = AccountSessions::default();
    let other = "https://chat.example.test/team";
    sessions.activate(BASE, FIRST, "first-one").await.unwrap();
    sessions
        .activate(PEER, SECOND, "second-token")
        .await
        .unwrap();
    sessions
        .activate(other, FIRST, "other-token")
        .await
        .unwrap();
    let old = sessions.restore(BASE, FIRST).await.unwrap();
    let second = sessions.restore(PEER, SECOND).await.unwrap();
    let adjacent = sessions.restore(other, FIRST).await.unwrap();
    verify(&old, b"first-one").await.unwrap();
    sessions
        .activate(BASE, FIRST, "replacement.+/_~==")
        .await
        .unwrap();
    assert_eq!(
        verify(&old, b"first-one").await,
        Err(TransportError::SessionUnavailable)
    );
    assert_eq!(
        sessions.activate(BASE, SECOND, "conflicting-login").await,
        Err(TransportError::InstallationAccountConflict)
    );
    let current = sessions.restore(BASE, FIRST).await.unwrap();
    verify(&current, b"replacement.+/_~==").await.unwrap();
    sessions.forget(BASE, FIRST).await.unwrap();
    sessions.forget(BASE, FIRST).await.unwrap();
    assert!(matches!(
        sessions.restore(BASE, FIRST).await,
        Err(TransportError::SessionUnavailable)
    ));
    assert_eq!(
        verify(&current, b"replacement").await,
        Err(TransportError::SessionUnavailable)
    );
    sessions
        .activate(BASE, SECOND, "after-sign-out")
        .await
        .unwrap();
    verify(
        &sessions.restore(BASE, SECOND).await.unwrap(),
        b"after-sign-out",
    )
    .await
    .unwrap();
    verify(&second, b"second-token").await.unwrap();
    verify(&adjacent, b"other-token").await.unwrap();
}

#[tokio::test]
async fn invalid_input_keeps_the_current_session() {
    let sessions = AccountSessions::default();
    sessions
        .activate(BASE, FIRST, "already-active")
        .await
        .unwrap();
    for invalid in ["", " ", "a b", "a\r\nb", "a=b", "==", "нет"] {
        assert_eq!(
            sessions.activate(BASE, FIRST, invalid).await,
            Err(TransportError::InvalidSession)
        );
    }
    for invalid in ["me", "", "abc", "Абв01234567890123456789012"] {
        assert!(matches!(
            sessions.restore(BASE, invalid).await,
            Err(TransportError::InvalidAccount)
        ));
    }
    assert!(matches!(
        sessions.restore("https://CHAT.example.test", FIRST).await,
        Err(TransportError::InvalidInstallation)
    ));
    assert!(matches!(
        sessions.restore("http://chat.example.test", FIRST).await,
        Err(TransportError::CleartextDenied)
    ));
    verify(
        &sessions.restore(BASE, FIRST).await.unwrap(),
        b"already-active",
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn retiring_before_dispatch_never_calls_the_sender() {
    let sessions = Arc::new(AccountSessions::default());
    sessions.activate(BASE, FIRST, "before-send").await.unwrap();
    let session = sessions.restore(BASE, FIRST).await.unwrap();
    let gate = session.token.write().await;
    let (ready, waiting) = oneshot::channel();
    let request = tokio::spawn({
        let session = session.clone();
        async move {
            ready.send(()).unwrap();
            session
                .dispatch::<(), _>(|_| async { panic!("retired request reached HTTP") })
                .await
        }
    });
    waiting.await.unwrap();
    let retire = tokio::spawn({
        let sessions = sessions.clone();
        async move { sessions.forget(BASE, FIRST).await }
    });
    session.end.cancelled().await;
    assert!(!retire.is_finished());
    drop(gate);
    assert_eq!(
        request.await.unwrap(),
        Err(TransportError::SessionUnavailable)
    );
    retire.await.unwrap().unwrap();
}

#[tokio::test]
async fn retirement_drains_a_pending_send_without_waiting_for_the_network() {
    let sessions = AccountSessions::default();
    sessions.activate(BASE, FIRST, "pending-one").await.unwrap();
    sessions
        .activate(PEER, SECOND, "stays-active")
        .await
        .unwrap();
    let session = sessions.restore(BASE, FIRST).await.unwrap();
    let (started, received) = oneshot::channel();
    let request = tokio::spawn(async move {
        session
            .dispatch(|_| async move {
                started.send(()).unwrap();
                std::future::pending::<Result<(), TransportError>>().await
            })
            .await
    });
    received.await.unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sessions.forget(BASE, FIRST),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        request.await.unwrap(),
        Err(TransportError::SessionUnavailable)
    );
    verify(
        &sessions.restore(PEER, SECOND).await.unwrap(),
        b"stays-active",
    )
    .await
    .unwrap();
}

impl Default for AccountSessions {
    fn default() -> Self {
        using(Arc::new(TestVault::default()))
    }
}

#[tokio::test]
async fn warm_requests_and_opens_skip_storage_and_failed_changes_preserve_the_login() {
    use std::sync::atomic::Ordering::SeqCst;
    let vault = Arc::new(TestVault::default());
    let first = using(vault.clone());
    first.activate(BASE, FIRST, "previous-login").await.unwrap();
    let restarted = using(vault.clone());
    let handle = restarted.restore(BASE, FIRST).await.unwrap();
    assert!(Arc::ptr_eq(
        &handle,
        &restarted.restore(BASE, FIRST).await.unwrap()
    ));
    verify(&handle, b"previous-login").await.unwrap();
    assert_eq!(vault.reads.load(SeqCst), 1);
    vault.refuse.store(true, SeqCst);
    assert_eq!(
        restarted.activate(BASE, FIRST, "failed-login").await,
        Err(TransportError::CredentialStorageUnavailable)
    );
    assert_eq!(
        restarted.forget(BASE, FIRST).await,
        Err(TransportError::CredentialStorageUnavailable)
    );
    verify(&handle, b"previous-login").await.unwrap();
    verify(
        &using(vault).restore(BASE, FIRST).await.unwrap(),
        b"previous-login",
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn pending_restore_cannot_resurrect_a_forgotten_account() {
    let vault = Arc::new(TestVault::default());
    using(vault.clone())
        .activate(BASE, FIRST, "before-forget")
        .await
        .unwrap();
    let restarted = using(vault.clone());
    let (started, reading) = oneshot::channel();
    let (unblock, gate) = std::sync::mpsc::channel();
    *vault.read_gate.lock().unwrap() = Some((started, gate));
    let restore = tokio::spawn({
        let owner = restarted.clone();
        async move { owner.restore(BASE, FIRST).await }
    });
    reading.await.unwrap();
    let forget = tokio::spawn({
        let owner = restarted.clone();
        async move { owner.forget(BASE, FIRST).await }
    });
    unblock.send(()).unwrap();
    let old = restore.await.unwrap().unwrap();
    forget.await.unwrap().unwrap();
    assert_eq!(
        verify(&old, b"before-forget").await,
        Err(TransportError::SessionUnavailable)
    );
    assert!(matches!(
        restarted.restore(BASE, FIRST).await,
        Err(TransportError::SessionUnavailable)
    ));
    assert!(restarted.account_ids(BASE).await.unwrap().is_empty());
}

#[tokio::test]
async fn deferred_removal_protects_replacements_in_this_host_and_another_host() {
    use std::sync::atomic::Ordering::SeqCst;
    let vault = Arc::new(TestVault::default());
    let local = using(vault.clone());
    let peer = using(vault.clone());
    local.activate(BASE, FIRST, "first-grant").await.unwrap();
    local.activate(PEER, SECOND, "other-grant").await.unwrap();
    let old = local.restore(BASE, FIRST).await.unwrap();
    local.activate(BASE, FIRST, "second-grant").await.unwrap();
    let second = local.restore(BASE, FIRST).await.unwrap();
    assert_eq!(local.forget_current(old).await, Ok(Removal::Superseded));
    verify(&second, b"second-grant").await.unwrap();

    peer.activate(BASE, FIRST, "third-grant").await.unwrap();
    assert_eq!(
        local.forget_current(second.clone()).await,
        Ok(Removal::Superseded)
    );
    assert_eq!(
        verify(&second, b"second-grant").await,
        Err(TransportError::SessionUnavailable)
    );
    let current = local.restore(BASE, FIRST).await.unwrap();
    verify(&current, b"third-grant").await.unwrap();

    vault.refuse.store(true, SeqCst);
    assert_eq!(
        local.forget_current(current.clone()).await,
        Err(TransportError::CredentialStorageUnavailable)
    );
    verify(&current, b"third-grant").await.unwrap();
    vault.refuse.store(false, SeqCst);
    assert_eq!(
        local.forget_current(current.clone()).await,
        Ok(Removal::Removed)
    );
    assert_eq!(
        verify(&current, b"third-grant").await,
        Err(TransportError::SessionUnavailable)
    );
    assert_eq!(using(vault).account_ids(PEER).await.unwrap(), [SECOND]);
}
