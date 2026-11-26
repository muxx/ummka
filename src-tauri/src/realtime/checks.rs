mod activity;
mod applied;

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

async fn check_actions(
    reader: &mut EventReader,
    check_typing: bool,
) -> Result<(), EventConnectionError> {
    let Some(IncomingFrame::Event { after: hello, .. }) = reader.next_frame(None).await? else {
        panic!("expected the action fixture hello");
    };
    let channel = "c".repeat(26);
    assert_eq!(
        reader.send_typing("invalid", None).await,
        Err(EventConnectionError::InvalidAction)
    );
    assert_eq!(
        reader.send_typing(&channel, Some("")).await,
        Err(EventConnectionError::InvalidAction)
    );
    let ping = reader.send_ping().await?;
    assert_eq!(ping, 1);
    let Some(IncomingFrame::Event { event, after, .. }) = reader.next_frame(Some(&hello)).await?
    else {
        panic!("expected the typing event before pong");
    };
    let typing = event
        .typing()
        .expect("valid fixture event")
        .expect("peer is typing");
    let root = "r".repeat(26);
    assert_eq!(typing.channel_id, channel);
    assert_eq!(typing.user_id, "p".repeat(26));
    assert_eq!(typing.root_id, Some(root.as_str()));
    let reply = reader.next_frame(Some(&after)).await?.expect("pong reply");
    assert!(reply.confirms_ping(ping));
    assert!(!reply.confirms_ping(2));
    if check_typing {
        for (seq, parent, status) in [
            (2, None, super::ReplyStatus::Ok),
            (3, Some(root.as_str()), super::ReplyStatus::Fail),
        ] {
            assert_eq!(reader.send_typing(&channel, parent).await?, seq);
            let reply = reader
                .next_frame(Some(&after))
                .await?
                .expect("typing reply");
            assert!(!reply.confirms_ping(seq));
            assert!(
                matches!(reply, IncomingFrame::Reply { request_sequence, status: actual, .. } if request_sequence == seq && actual == status)
            );
        }
    }
    assert_eq!(after.next_sequence(), 2);
    Ok(())
}

pub(crate) async fn wire(client: &NativeHttp, base: &str) -> CheckResult {
    let sessions = using(Arc::new(TestVault::default()));
    applied::check(client, &sessions, base).await?;
    activity::check(client, &sessions, base).await?;
    let actions = signed(client, &sessions, base, "actions").await?;
    for check_typing in [true, false] {
        actions
            .with_event_stream(EventSettings::default(), None, async |reader| {
                check_actions(reader, check_typing).await
            })
            .await?;
    }
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
    let verify_retirement = async {
        match handshake.await {
            Err(EventConnectionError::SessionUnavailable) => Ok(()),
            Err(error) => Err(error.into()),
            Ok(()) => Err("held handshake completed before the session retired".into()),
        }
    };
    tokio::try_join!(verify_retirement, retire)?;
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "macos"))]
pub(crate) async fn posted_delivery(
    client: &NativeHttp,
    sessions: &AccountSessions,
    base: &str,
) -> CheckResult {
    use crate::history::{DraftSave, StagePost};
    use crate::rest::TransportError;
    const CHANNEL: &str = "cccccccccccccccccccccccccc";
    const ROOT: &str = "rrrrrrrrrrrrrrrrrrrrrrrrrr";
    const POST: &str = "pppppppppppppppppppppppppp";
    let connection = signed(client, sessions, base, "delivery").await?;
    let mut history = connection.open_history(sessions).await?;
    let DraftSave::Saved(draft) = history.save_draft(CHANNEL, Some(ROOT), None, "fixture reply")?
    else {
        panic!("fixture draft was not saved");
    };
    let StagePost::Created { post, .. } =
        history.stage_post(CHANNEL, Some(ROOT), draft.revision.as_deref().unwrap())?
    else {
        panic!("fixture reply was not staged");
    };
    let mut send = Request::new(
        Method::POST,
        format!("{base}/Event%20Site//delivery/api/v4/posts").parse()?,
    );
    send.headers_mut()
        .insert("content-type", "application/json".parse()?);
    *send.body_mut() = Some(serde_json::json!({
        "channel_id": post.channel_id, "root_id": post.root_id, "message": post.message, "pending_post_id": post.pending_id
    }).to_string().into());
    connection
        .with_event_stream(EventSettings::default(), None, async |reader| {
            let Some(IncomingFrame::Event { event, after, .. }) = reader.next_frame(None).await?
            else {
                panic!("expected hello");
            };
            assert_eq!(event.name, "hello");
            // The server accepts the signed POST and deliberately drops its HTTP response.
            assert_eq!(
                connection.send(send).await.unwrap_err(),
                TransportError::Network
            );
            let Some(IncomingFrame::Event { event, .. }) = reader.next_frame(Some(&after)).await?
            else {
                panic!("expected posted");
            };
            assert!(event.confirm_delivery(&mut history)?);
            assert!(event.confirm_delivery(&mut history)?);
            Ok(())
        })
        .await?;
    drop(history);
    let mut reopened = connection.open_history(sessions).await?;
    let rows = reopened.pending_posts(CHANNEL, Some(ROOT), 0, 4)?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].pending_id, post.pending_id);
    assert_eq!(rows[0].confirmed_post_id.as_deref(), Some(POST));
    assert!(reopened.read_post(POST)?.is_none());
    connection.sign_out_on_device(sessions).await?;
    Ok(())
}
