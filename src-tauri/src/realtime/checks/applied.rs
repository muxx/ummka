use super::{CheckResult, Continuity, EventConnectionError, EventSettings, NativeHttp, signed};
use crate::{history::HistoryError, realtime::StreamError, sessions::AccountSessions};
use tokio::sync::oneshot;

pub(super) async fn check(
    client: &NativeHttp,
    sessions: &AccountSessions,
    base: &str,
) -> CheckResult {
    let account = signed(client, sessions, base, "applied").await?;
    let mut events = account.account_events()?;
    let mut seen = Vec::new();
    let failure = EventConnectionError::History(HistoryError::Storage);
    let result = events
        .consume(EventSettings::default(), async |event, continuity| {
            seen.push((event.name.clone(), continuity));
            if event.name == "posted" {
                return Err(EventConnectionError::History(HistoryError::Storage));
            }
            Ok(())
        })
        .await;
    assert_eq!(result, Err(failure));
    assert_eq!(
        seen,
        [
            ("hello".into(), Continuity::FirstConnection),
            ("custom_notice".into(), Continuity::Continuing),
            ("posted".into(), Continuity::Continuing),
        ]
    );
    seen.clear();
    let result = events
        .consume(EventSettings::default(), async |event, continuity| {
            seen.push((event.name, continuity));
            if continuity == Continuity::ReplacedConnection {
                return Err(EventConnectionError::Network);
            }
            Ok(())
        })
        .await;
    assert_eq!(result, Err(EventConnectionError::Network));
    assert_eq!(
        seen,
        [
            ("posted".into(), Continuity::Continuing),
            ("hello".into(), Continuity::ReplacedConnection),
        ]
    );
    seen.clear();
    let result = events
        .consume(EventSettings::default(), async |event, continuity| {
            seen.push((event.name, continuity));
            Ok(())
        })
        .await;
    assert_eq!(
        result,
        Err(EventConnectionError::Protocol(
            StreamError::SequenceMismatch {
                expected: 2,
                received: 9
            }
        ))
    );
    assert_eq!(
        seen,
        [
            ("hello".into(), Continuity::ReplacedConnection),
            ("post_edited".into(), Continuity::Continuing),
        ]
    );
    seen.clear();
    events
        .consume(EventSettings::default(), async |event, continuity| {
            seen.push((event.name, continuity));
            Ok(())
        })
        .await?;
    assert_eq!(seen, [("post_deleted".into(), Continuity::Continuing)]);

    // End the login while its consumer is applying an event.
    let (entered, wait) = oneshot::channel();
    let mut entered = Some(entered);
    let read = events.consume(EventSettings::default(), async |event, _| {
        assert_eq!(event.name, "notification");
        entered.take().unwrap().send(()).unwrap();
        std::future::pending().await
    });
    let retire = async {
        wait.await.unwrap();
        account.sign_out_on_device(sessions).await
    };
    let (ended, removed) = tokio::join!(read, retire);
    removed?;
    assert_eq!(ended, Err(EventConnectionError::SessionUnavailable));
    assert_eq!(
        events
            .consume(EventSettings::default(), async |_, _| panic!(
                "retired login delivered another event"
            ))
            .await,
        Err(EventConnectionError::SessionUnavailable)
    );

    let replacement = signed(client, sessions, base, "applied").await?;
    seen.clear();
    replacement
        .account_events()?
        .consume(EventSettings::default(), async |event, continuity| {
            seen.push((event.name, continuity));
            Ok(())
        })
        .await?;
    assert_eq!(seen, [("hello".into(), Continuity::FirstConnection)]);
    Ok(())
}
