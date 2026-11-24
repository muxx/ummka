use super::*;
use crate::models::SecretInput;

mod persistence;

fn input(id: &str) -> LoginRequest {
    LoginRequest {
        login_id: Some(id.into()),
        password: Some(SecretInput::new("fixture-password".into())),
        token: Some(SecretInput::new("fixture-code".into())),
        ldap_only: Some("true".into()),
        ..Default::default()
    }
}

pub(crate) async fn exchange(
    http: &NativeHttp,
    base: &str,
    other: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let prefixed = format!("{base}/Login%20Site//Blue");
    let open = |base: &str| NativeAuthentication::with_client(base, || Ok(http.clone()));
    let client = open(&prefixed)?;
    assert!(matches!(
        open("http://vault.example.test"),
        Err(TransportError::CleartextDenied)
    ));
    let good = client.login(&input("ordinary")).await?;
    assert_eq!(good.account().installation(), prefixed);
    assert_eq!(good.account().user_id(), "Abc01234567890123456789012");
    for scope in [base, other] {
        assert_eq!(
            open(scope)?.logout(&good).await,
            Err(AuthError::Transport(TransportError::OutsideInstallation))
        );
    }
    client.logout(&good).await?;
    for name in ["mfa", "foreign-header", "broken-error"] {
        let Err(AuthError::Server(error)) = client.login(&input(name)).await else {
            return Err("missing native server error".into());
        };
        assert_eq!(
            error.status_code,
            if name == "broken-error" { 403 } else { 401 }
        );
        if name == "broken-error" {
            assert!(error.id.is_none());
        } else {
            assert_eq!(
                error.id.as_deref(),
                Some("mfa.validate_token.authenticate.app_error")
            );
        }
        assert!(error.message.is_none());
        assert_eq!(
            error.request_id.as_deref(),
            (name == "foreign-header").then_some("request-1")
        );
    }
    for name in [
        "missing",
        "duplicate",
        "bad-id",
        "wrong-status",
        "broken-success",
        "too-large",
    ] {
        assert!(
            matches!(
                client.login(&input(name)).await,
                Err(AuthError::InvalidResponse)
            ),
            "invalid success accepted for {name}"
        );
    }
    assert!(matches!(
        client.login(&input("redirect")).await,
        Err(AuthError::Transport(TransportError::Redirect))
    ));
    let bad = client.login(&input("bad-logout")).await?;
    assert_eq!(client.logout(&bad).await, Err(AuthError::InvalidResponse));
    let bad = client.login(&input("refused-logout")).await?;
    let Err(AuthError::Server(error)) = client.logout(&bad).await else {
        return Err("missing logout refusal".into());
    };
    assert_eq!(error.status_code, 403);
    assert_eq!(error.id.as_deref(), Some("logout.refused"));
    assert!(error.message.is_none());
    persistence::check(&client, base).await
}
