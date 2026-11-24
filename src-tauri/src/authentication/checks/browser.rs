use super::*;
use crate::authentication::browser::{BrowserProvider, BrowserSignIn};
use crate::sessions::fixture::{TestVault, using};
use reqwest::Url;
use std::sync::{Arc, atomic::Ordering::SeqCst};

pub(super) async fn check(client: &NativeAuthentication) -> CheckResult {
    let vault = Arc::new(TestVault::default());
    let sessions = using(vault.clone());
    let begin = || BrowserSignIn::new(client.clone(), BrowserProvider::GitLab);
    let callback = |name: &str, server: Option<&str>| {
        let mut url = Url::parse("io.github.muxx.ummka.auth://callback").unwrap();
        url.query_pairs_mut()
            .append_pair("MMAUTHTOKEN", &format!("fixture-grant-browser-{name}"))
            .append_pair("MMCSRF", "synthetic-browser-csrf");
        if let Some(server) = server {
            url.query_pairs_mut().append_pair("srv", server);
        }
        url.to_string()
    };
    drop(begin());
    assert_eq!(sessions.current_account_id(&client.base).await?, None);
    assert!(matches!(
        begin()
            .complete(&sessions, callback("unused", Some("https://other.test")))
            .await,
        Err(SignInError::Authentication(AuthError::InvalidResponse))
    ));
    let signed = begin().complete(&sessions, callback("ten", None)).await?;
    assert_eq!(signed.user_id(), "Abc01234567890123456789012");
    assert_eq!(signed.installation(), client.base);
    let original = open(client, &sessions, signed.user_id()).await?;
    me(&original, client).await?;
    let Err(SignInError::Authentication(AuthError::Server(denied))) = begin()
        .complete(&sessions, callback("expired", Some(&client.base)))
        .await
    else {
        return Err("missing browser sign-in refusal".into());
    };
    assert_eq!(denied.status_code, 401);
    assert!(denied.message.is_none());
    assert_eq!(denied.id.as_deref(), Some("sign_in.expired"));
    assert!(matches!(
        begin().complete(&sessions, callback("invalid", None)).await,
        Err(SignInError::Authentication(AuthError::InvalidResponse))
    ));
    assert_eq!(vault.saves.load(SeqCst), 1);
    vault.refuse.store(true, SeqCst);
    assert!(matches!(
        begin()
            .complete(&sessions, callback("not-saved", Some(&client.base)))
            .await,
        Err(SignInError::NotSaved {
            revocation: Revocation::Confirmed,
            ..
        })
    ));
    vault.refuse.store(false, SeqCst);
    // A failed save of the new grant keeps both the old verified account and its token.
    me(&original, client).await?;
    let replacement = begin()
        .complete(&sessions, callback("twelve", Some(&client.base)))
        .await?;
    assert!(replacement == signed);
    let latest = open(client, &sessions, signed.user_id()).await?;
    me(&latest, client).await?;
    Ok(())
}
