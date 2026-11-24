use super::*;
use crate::authentication::form::{PasswordForm, PasswordFormError, PasswordResult, PasswordStage};
use crate::sessions::fixture::{TestVault, using};
use std::sync::Arc;
use tokio::sync::oneshot;

pub(super) async fn check(client: &NativeAuthentication) -> CheckResult {
    let vault = Arc::new(TestVault::default());
    let sessions = using(vault.clone());
    let form = Arc::new(PasswordForm::new(client.clone(), sessions.clone()));
    let password = || " fixture password ".to_owned();
    assert_eq!(
        form.submit_code("123456").await,
        Err(PasswordFormError::Unavailable)
    );
    assert_eq!(
        form.submit_password(" ", password(), false).await,
        Err(PasswordFormError::MissingLogin)
    );
    assert_eq!(
        form.submit_password("form-mfa", String::new(), false).await,
        Err(PasswordFormError::MissingPassword)
    );
    let first_step = || form.submit_password("  form-mfa\t", password(), true);
    assert_eq!(first_step().await?, PasswordResult::SecondFactorRequired);
    assert!(form.back());
    assert_eq!(form.stage(), PasswordStage::Password);
    assert_eq!(first_step().await?, PasswordResult::SecondFactorRequired);
    assert_eq!(first_step().await, Err(PasswordFormError::Unavailable));
    assert_eq!(
        form.submit_code("1234").await,
        Err(PasswordFormError::InvalidCode)
    );
    assert_eq!(
        form.submit_code("000-000").await,
        Err(PasswordFormError::InvalidCode)
    );
    assert_eq!(form.stage(), PasswordStage::SecondFactor);

    let (started, saving) = oneshot::channel();
    let (release, blocked) = std::sync::mpsc::channel();
    *vault.save_gate.lock().unwrap() = Some((started, blocked));
    let observer = tokio::spawn({
        let form = form.clone();
        async move { form.submit_code("01 2-345").await }
    });
    saving.await?;
    assert_eq!(form.stage(), PasswordStage::Submitting);
    assert!(!form.cancel() && !form.back());
    assert_eq!(first_step().await, Err(PasswordFormError::Unavailable));
    assert_eq!(
        form.submit_code("012345").await,
        Err(PasswordFormError::Unavailable)
    );
    observer.abort();
    assert!(matches!(observer.await, Err(error) if error.is_cancelled()));
    release.send(())?;
    tokio::time::timeout(Duration::from_secs(10), async {
        while form.stage() == PasswordStage::Submitting {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    assert_eq!(form.stage(), PasswordStage::SignedIn);
    let user = "Abc01234567890123456789012";
    let restarted = using(vault);
    assert_eq!(restarted.account_ids(&client.base).await?, [user]);
    me(&open(client, &restarted, user).await?, client).await?;
    assert!(!form.back() && !form.cancel());

    let cancelled = PasswordForm::new(client.clone(), sessions);
    assert_eq!(
        cancelled
            .submit_password("form-mfa", password(), true)
            .await?,
        PasswordResult::SecondFactorRequired
    );
    assert!(cancelled.cancel());
    assert_eq!(cancelled.stage(), PasswordStage::Cancelled);
    assert_eq!(
        cancelled.submit_code("012345").await,
        Err(PasswordFormError::Unavailable)
    );
    Ok(())
}
