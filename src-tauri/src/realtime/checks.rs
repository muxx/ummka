use super::{
    Continuity, EventConnectionError, EventReader, EventSettings, IncomingFrame, StreamError,
};
use crate::{
    native_http::NativeHttp,
    rest::RestConnection,
    sessions::{
        AccountSessions,
        fixture::{TestVault, using},
    },
};
use reqwest::{Method, Request};
use std::sync::Arc;
use tokio::sync::oneshot;

const USER: &str = "Abc01234567890123456789012";
type CheckResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

async fn signed(
    client: &NativeHttp,
    sessions: &AccountSessions,
    base: &str,
    mode: &str,
) -> CheckResult<RestConnection> {
    let url = format!("{base}/Event%20Site//{mode}");
    sessions.activate(&url, USER, "event-fixture-token").await?;
    Ok(RestConnection::with_client(&url, || Ok(client.clone()))?
        .for_account(sessions, USER)
        .await?)
}

pub(crate) async fn wire(client: &NativeHttp, base: &str) -> CheckResult {
    let sessions = using(Arc::new(TestVault::default()));
    let connection = signed(client, &sessions, base, "events").await?;
    let cursor = connection
        .with_event_stream(EventSettings::default(), None, async |reader| match reader
            .next_frame(None)
            .await?
        {
            Some(IncomingFrame::Event {
                event,
                continuity: Continuity::FirstConnection,
                after,
            }) if event.name == "hello" => Ok(after),
            _ => panic!("expected a fresh Mattermost hello"),
        })
        .await?;
    let (ready, opened) = oneshot::channel();
    let url = format!("{base}/Event%20Site//events");
    let consuming =
        connection.with_event_stream(EventSettings::default(), Some(&cursor), async |reader| {
            let Some(IncomingFrame::Event {
                event,
                continuity: Continuity::Continuing,
                after,
            }) = reader.next_frame(Some(&cursor)).await?
            else {
                panic!("expected the next event on the same connection ID");
            };
            assert_eq!(event.name, "posted");
            assert_eq!(after.next_sequence(), 2);
            ready.send(()).unwrap();
            reader.next_frame(Some(&after)).await?;
            Ok(())
        });
    let retire = async {
        opened.await.unwrap();
        sessions.forget(&url, USER).await.unwrap();
    };
    let (result, ()) = tokio::join!(consuming, retire);
    assert_eq!(result, Err(EventConnectionError::SessionUnavailable));
    for (mode, expected) in [
        ("closed", Ok(())),
        (
            "malformed",
            Err(EventConnectionError::Protocol(StreamError::InvalidFrame)),
        ),
        ("denied", Err(EventConnectionError::Http(403))),
    ] {
        let connection = signed(client, &sessions, base, mode).await?;
        let result = connection
            .with_event_stream(
                EventSettings::default(),
                None,
                async |reader: &mut EventReader| {
                    let first = reader.next_frame(None).await;
                    assert!(reader.next_frame(None).await?.is_none());
                    assert!(first?.is_none());
                    Ok(())
                },
            )
            .await;
        assert_eq!(result, expected);
    }
    let held = signed(client, &sessions, base, "hold").await?;
    let control = async |path: &str| -> CheckResult {
        let response = client
            .send(Request::new(Method::GET, format!("{base}/{path}").parse()?))
            .await?;
        assert_eq!(response.text().await?, "OK");
        Ok(())
    };
    let handshake =
        held.with_event_stream(EventSettings::default(), None, async |_| -> Result<(), _> {
            panic!("the fixture holds this handshake before 101")
        });
    let retire = async {
        control("event-handshake-arrived").await?;
        sessions
            .forget(&format!("{base}/Event%20Site//hold"), USER)
            .await?;
        control("event-handshake-closed").await
    };
    let (result, cleanup) = tokio::join!(handshake, retire);
    assert_eq!(result, Err(EventConnectionError::SessionUnavailable));
    cleanup
}
