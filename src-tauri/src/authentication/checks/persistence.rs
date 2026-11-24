use super::*;
use crate::rest::RestConnection;
use crate::sessions::fixture::{TestVault, using};
use std::sync::{Arc, atomic::Ordering::SeqCst};
use tokio::sync::oneshot;

type CheckResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

async fn open(
    client: &NativeAuthentication,
    sessions: &crate::sessions::AccountSessions,
    user_id: &str,
) -> Result<RestConnection, TransportError> {
    RestConnection::with_client(&client.base, || Ok(client.http.clone()))?
        .for_account(sessions, user_id)
        .await
}

async fn me(
    connection: &RestConnection,
    client: &NativeAuthentication,
) -> Result<(), TransportError> {
    let url = format!("{}/api/v4/users/me", client.base).parse().unwrap();
    let response = connection.send(Request::new(Method::GET, url)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(())
}

pub(super) async fn check(client: &NativeAuthentication, fixture_base: &str) -> CheckResult {
    let vault = Arc::new(TestVault::default());
    let sessions = using(vault.clone());
    let account = client.sign_in(&sessions, input("saved")).await?;
    assert_eq!(account.installation(), client.base);
    let user = account.user_id();
    assert_eq!(user, "Abc01234567890123456789012");
    assert_eq!(sessions.account_ids(&client.base).await?, [user]);
    let previous = open(client, &sessions, user).await?;
    me(&previous, client).await?;
    assert!(matches!(
        client.sign_in(&sessions, input("mfa")).await,
        Err(SignInError::Authentication(AuthError::Server(_)))
    ));
    assert_eq!(vault.saves.load(SeqCst), 1);

    vault.refuse.store(true, SeqCst);
    for (name, expected) in [
        ("confirmed", Revocation::Confirmed),
        ("refused", Revocation::Unconfirmed),
        ("no-reply", Revocation::Unconfirmed),
    ] {
        let Err(error) = client.sign_in(&sessions, input(name)).await else {
            return Err("sign-in accepted after storage refused the token".into());
        };
        assert_eq!(
            error,
            SignInError::NotSaved {
                cause: TransportError::CredentialStorageUnavailable,
                revocation: expected
            }
        );
        let diagnostic = format!("{error} {error:?}");
        for secret in ["fixture-password", "fixture-code", "fixture-grant-"] {
            assert!(!diagnostic.contains(secret));
        }
    }
    me(&previous, client).await?;
    me(&open(client, &using(vault.clone()), user).await?, client).await?;

    let empty = Arc::new(TestVault::default());
    empty.refuse.store(true, SeqCst);
    assert!(matches!(
        client.sign_in(&using(empty.clone()), input("empty")).await,
        Err(SignInError::NotSaved {
            revocation: Revocation::Confirmed,
            ..
        })
    ));
    assert!(using(empty).account_ids(&client.base).await?.is_empty());

    // Drop the real caller after the server issued a grant, while the platform save is blocked.
    let (started, saving) = oneshot::channel();
    let (release, gate) = std::sync::mpsc::channel();
    *vault.save_gate.lock().unwrap() = Some((started, gate));
    let waiter = tokio::spawn({
        let client = client.clone();
        let sessions = sessions.clone();
        async move { client.sign_in(&sessions, input("detached")).await }
    });
    saving.await?;
    waiter.abort();
    assert!(matches!(waiter.await, Err(e) if e.is_cancelled()));
    release.send(())?;
    let url = format!("{fixture_base}/auth-check/detached-revoked").parse()?;
    let mut observation = Request::new(Method::GET, url);
    *observation.timeout_mut() = Some(Duration::from_secs(10));
    assert_eq!(
        client.http.send(observation).await?.status(),
        StatusCode::OK
    );
    me(&previous, client).await?;

    vault.refuse.store(false, SeqCst);
    let replacement = client.sign_in(&sessions, input("replaced")).await?;
    assert_eq!(replacement.user_id(), user);
    assert_eq!(
        me(&previous, client).await,
        Err(TransportError::SessionUnavailable)
    );
    me(&open(client, &sessions, user).await?, client).await?;
    me(&open(client, &using(vault), user).await?, client).await?;
    Ok(())
}
