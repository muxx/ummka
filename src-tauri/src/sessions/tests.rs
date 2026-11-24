use super::*;
use tokio::sync::oneshot;

const BASE: &str = "https://chat.example.test/Team";
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
        .activate(BASE, SECOND, "second-token")
        .await
        .unwrap();
    sessions
        .activate(other, FIRST, "other-token")
        .await
        .unwrap();
    let old = sessions.get(BASE, FIRST).unwrap();
    let second = sessions.get(BASE, SECOND).unwrap();
    let adjacent = sessions.get(other, FIRST).unwrap();
    verify(&old, b"first-one").await.unwrap();
    sessions
        .activate(BASE, FIRST, "replacement.+/_~==")
        .await
        .unwrap();
    assert_eq!(
        verify(&old, b"first-one").await,
        Err(TransportError::SessionUnavailable)
    );
    let current = sessions.get(BASE, FIRST).unwrap();
    verify(&current, b"replacement.+/_~==").await.unwrap();
    sessions.forget(BASE, FIRST).await.unwrap();
    sessions.forget(BASE, FIRST).await.unwrap();
    assert!(matches!(
        sessions.get(BASE, FIRST),
        Err(TransportError::SessionUnavailable)
    ));
    assert_eq!(
        verify(&current, b"replacement").await,
        Err(TransportError::SessionUnavailable)
    );
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
            sessions.get(BASE, invalid),
            Err(TransportError::InvalidAccount)
        ));
    }
    assert!(matches!(
        sessions.get("https://CHAT.example.test", FIRST),
        Err(TransportError::InvalidInstallation)
    ));
    assert!(matches!(
        sessions.get("http://chat.example.test", FIRST),
        Err(TransportError::CleartextDenied)
    ));
    verify(&sessions.get(BASE, FIRST).unwrap(), b"already-active")
        .await
        .unwrap();
}

#[tokio::test]
async fn retiring_before_dispatch_never_calls_the_sender() {
    let sessions = Arc::new(AccountSessions::default());
    sessions.activate(BASE, FIRST, "before-send").await.unwrap();
    let session = sessions.get(BASE, FIRST).unwrap();
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
        .activate(BASE, SECOND, "stays-active")
        .await
        .unwrap();
    let session = sessions.get(BASE, FIRST).unwrap();
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
    verify(&sessions.get(BASE, SECOND).unwrap(), b"stays-active")
        .await
        .unwrap();
}
