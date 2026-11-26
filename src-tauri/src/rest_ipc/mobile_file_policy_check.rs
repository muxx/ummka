use super::exchange::Session;
use crate::{
    native_http::NativeHttp,
    rest::{
        RestConnection, TransportError, mobile_file_policy::MobileFilePolicyError as PolicyError,
    },
    sessions::{
        AccountSessions,
        fixture::{TestVault, using},
    },
};
use reqwest::{Method, Request};
use std::sync::Arc;
use tauri::Resource;
use tokio_util::sync::CancellationToken;

type Check<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const USER: &str = "Abc01234567890123456789012";

async fn signed(
    client: &NativeHttp,
    accounts: &AccountSessions,
    site: &str,
    token: &str,
) -> Check<Arc<Session>> {
    accounts.activate(site, USER, token).await?;
    let rest = RestConnection::with_client(site, || Ok(client.clone()))?
        .for_account(accounts, USER)
        .await?;
    Ok(Arc::new(Session::new(rest)))
}
async fn observed(client: &NativeHttp, base: &str, event: &str) -> Check {
    let url = format!("{base}/mobile-policy-check/{event}").parse()?;
    assert!(
        client
            .send(Request::new(Method::GET, url))
            .await?
            .status()
            .is_success()
    );
    Ok(())
}

pub(crate) async fn wire(client: &NativeHttp, base: &str) -> Check {
    let site = format!("{base}/Policy%20Site//A%2FB");
    let accounts = using(Arc::new(TestVault::default()));
    let unsigned = RestConnection::with_client(&site, || Ok(client.clone()))?;
    let cancel = CancellationToken::new();
    assert_eq!(
        unsigned.mobile_file_download_allowed(&cancel).await,
        Err(PolicyError::Transport(TransportError::SessionUnavailable))
    );
    let owner = signed(client, &accounts, &site, "mobile-policy-member").await?;
    let peer = signed(
        client,
        &accounts,
        &format!("{base}/Peer%20Policy//A%2FB"),
        "mobile-policy-peer",
    )
    .await?;
    let aborted = owner.lifetime.child_token();
    aborted.cancel();
    assert_eq!(
        owner.http.mobile_file_download_allowed(&aborted).await,
        Err(PolicyError::Cancelled)
    );
    let check = || owner.http.mobile_file_download_allowed(&owner.lifetime);
    assert!(check().await?);
    assert!(!check().await?);
    for _ in 0..3 {
        assert_eq!(check().await, Err(PolicyError::InvalidResponse));
    }
    let Err(PolicyError::Server(refused)) = check().await else {
        return Err("expected server refusal".into());
    };
    assert_eq!(refused.status_code, 403);
    assert_eq!(refused.id.as_deref(), Some("config.refused"));
    assert_eq!(refused.request_id.as_deref(), Some("policy-request"));
    assert!(refused.message.is_none());
    assert_eq!(check().await, Err(PolicyError::UnexpectedStatus(204)));
    assert_eq!(check().await, Err(PolicyError::InvalidResponse));
    assert!(matches!(
        check().await,
        Err(PolicyError::InvalidResponse | PolicyError::Transport(TransportError::Network))
    ));
    for action in ["cancel", "close"] {
        let stop = owner.lifetime.child_token();
        let (result, ended) = tokio::join!(owner.http.mobile_file_download_allowed(&stop), async {
            observed(client, base, action).await?;
            if action == "close" {
                owner.clone().close();
            } else {
                stop.cancel();
            }
            Check::Ok(())
        });
        ended?;
        assert_eq!(result, Err(PolicyError::Cancelled));
    }
    assert!(
        !peer
            .http
            .mobile_file_download_allowed(&peer.lifetime)
            .await?
    );
    let replacement = RestConnection::with_client(&site, || Ok(client.clone()))?
        .for_account(&accounts, USER)
        .await?;
    let (result, retired) =
        tokio::join!(replacement.mobile_file_download_allowed(&cancel), async {
            observed(client, base, "retire").await?;
            accounts.forget(&site, USER).await?;
            Check::Ok(())
        });
    retired?;
    assert_eq!(
        result,
        Err(PolicyError::Transport(TransportError::SessionUnavailable))
    );
    assert_eq!(
        replacement.mobile_file_download_allowed(&cancel).await,
        result
    );
    observed(client, base, "departed").await?;
    Ok(())
}
