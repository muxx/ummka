use super::*;
use crate::credentials::Removal;
use crate::sessions::{
    AccountSessions,
    fixture::{TestVault, using},
};
use std::sync::{Arc, atomic::Ordering::SeqCst};

const USER: &str = "Abc01234567890123456789012";

async fn login(
    client: &NativeAuthentication,
    sessions: &AccountSessions,
    name: &str,
) -> Result<RestConnection, Box<dyn std::error::Error + Send + Sync>> {
    client.sign_in(sessions, input(name)).await?;
    Ok(open(client, sessions, USER).await?)
}

pub(super) async fn control(
    client: &NativeAuthentication,
    base: &str,
    name: &str,
    step: &str,
) -> CheckResult {
    let mut req = Request::new(
        Method::GET,
        format!("{base}/auth-check/{name}/{step}").parse()?,
    );
    *req.timeout_mut() = Some(Duration::from_secs(10));
    assert_eq!(client.http.send(req).await?.status(), StatusCode::OK);
    Ok(())
}

pub(super) async fn check(client: &NativeAuthentication, base: &str) -> CheckResult {
    let vault = Arc::new(TestVault::default());
    let sessions = using(vault.clone());
    let anonymous = RestConnection::with_client(&client.base, || Ok(client.http.clone()))?;
    assert_eq!(
        anonymous.sign_out(&sessions).await,
        Err(TransportError::SessionUnavailable)
    );
    let account = login(client, &sessions, "out-success").await?;
    assert_eq!(account.sign_out(&sessions).await?, SignOut::SignedOut);
    assert_eq!(
        me(&account, client).await,
        Err(TransportError::SessionUnavailable)
    );
    assert!(
        using(vault.clone())
            .account_ids(&client.base)
            .await?
            .is_empty()
    );

    for name in ["out-refused", "out-lost", "out-invalid"] {
        let account = login(client, &sessions, name).await?;
        assert_eq!(account.sign_out(&sessions).await?, SignOut::Unconfirmed);
        me(&account, client).await?;
        assert_eq!(
            using(vault.clone()).account_ids(&client.base).await?,
            [USER]
        );
        assert_eq!(
            account.sign_out_on_device(&sessions).await?,
            Removal::Removed
        );
    }
    let account = login(client, &sessions, "out-local-fail").await?;
    vault.refuse.store(true, SeqCst);
    assert_eq!(
        account.sign_out(&sessions).await?,
        SignOut::ServerConfirmedLocalRemovalFailed {
            cause: TransportError::CredentialStorageUnavailable,
        }
    );
    assert_eq!(sessions.account_ids(&client.base).await?, [USER]);
    vault.refuse.store(false, SeqCst);
    assert_eq!(
        account.sign_out_on_device(&sessions).await?,
        Removal::Removed
    );

    for name in ["out-dismiss", "out-race"] {
        let account = Arc::new(login(client, &sessions, name).await?);
        let retired = account.lifetime();
        let waiter = tokio::spawn({
            let account = account.clone();
            let sessions = sessions.clone();
            async move { account.sign_out(&sessions).await }
        });
        control(client, base, name, "received").await?;
        if name == "out-dismiss" {
            waiter.abort();
            assert!(matches!(waiter.await, Err(e) if e.is_cancelled()));
            control(client, base, name, "release").await?;
            tokio::time::timeout(Duration::from_secs(10), retired.cancelled()).await?;
            assert!(sessions.account_ids(&client.base).await?.is_empty());
        } else {
            let current = login(client, &sessions, "out-new").await?;
            control(client, base, name, "release").await?;
            assert_eq!(waiter.await??, SignOut::Superseded);
            assert_eq!(
                account.sign_out_on_device(&sessions).await?,
                Removal::Superseded
            );
            me(&current, client).await?;
        }
    }
    Ok(())
}
