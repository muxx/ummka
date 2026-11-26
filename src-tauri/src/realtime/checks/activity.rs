use super::{CheckResult, NativeHttp, USER, signed};
use crate::{
    realtime::{EventActivity, EventConnectionError, EventSettings},
    sessions::AccountSessions,
};
use reqwest::{Method, Request};
use tokio::sync::mpsc;

pub(super) async fn check(
    client: &NativeHttp,
    sessions: &AccountSessions,
    base: &str,
) -> CheckResult {
    let connection = signed(client, sessions, base, "activity").await?;
    let mut events = connection.account_events()?;
    let (owner, active) = EventActivity::new(false);
    let (entered, mut arrivals) = mpsc::unbounded_channel();
    let mut visits = 0;
    let run = events.run_while_active(active, EventSettings::default(), async |event, _| {
        if event.name == "posted" {
            visits += 1;
            entered.send(visits).unwrap();
            if visits == 1 {
                // Pause before the application's write completes. This post must be replayed.
                std::future::pending::<()>().await;
            }
        }
        Ok(())
    });
    let control = async {
        let check = async |path: &str| -> CheckResult {
            let req = Request::new(
                Method::GET,
                format!("{base}/event-activity-{path}").parse()?,
            );
            assert_eq!(client.send(req).await?.text().await?, "OK");
            Ok(())
        };
        check("dormant").await?;
        owner.set_active(true);
        assert_eq!(arrivals.recv().await, Some(1));
        owner.set_active(false);
        check("closed").await?;
        owner.set_active(true);
        assert_eq!(arrivals.recv().await, Some(2));
        // Dropping the owner must cancel an idle read even if the socket remains open.
        drop(owner);
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    };
    let (result, checked) = tokio::join!(run, control);
    checked?;
    result?;
    assert_eq!(visits, 2);

    // A normal hello and seven failed upgrades reach the first long wait. Nine clean
    // resumes with no events must then each use the base wait. Skip only the wall time.
    let empty = signed(client, sessions, base, "activity-empty").await?;
    let (_owner, active) = EventActivity::new(true);
    let mut waits = Vec::new();
    let mut received = Vec::new();
    let result = empty
        .account_events()?
        .run_with_retry(
            active,
            EventSettings::default(),
            async |event, _| {
                received.push(event.name);
                Ok(())
            },
            |duration| {
                waits.push(duration.as_secs());
                std::future::ready(())
            },
        )
        .await;
    assert_eq!(result, Err(EventConnectionError::Http(403)));
    assert_eq!(received, ["hello"]);
    assert_eq!(waits, [3, 3, 3, 3, 3, 3, 3, 24, 3, 3, 3, 3, 3, 3, 3, 3, 3]);

    // Both errors are terminal. In particular a consumer's failed REST request must
    // reach the caller, even when its error has the same type as a socket failure.
    for (mode, expected) in [
        ("activity-denied", EventConnectionError::Http(403)),
        ("activity-consumer", EventConnectionError::Network),
    ] {
        let connection = signed(client, sessions, base, mode).await?;
        let mut events = connection.account_events()?;
        let (_owner, active) = EventActivity::new(true);
        let result = events
            .run_while_active(active, EventSettings::default(), async |_, _| {
                Err(EventConnectionError::Network)
            })
            .await;
        assert_eq!(result, Err(expected));
    }
    let (_owner, inactive) = EventActivity::new(false);
    let url = format!("{base}/Event%20Site//activity");
    let retire = sessions.forget(&url, USER);
    let stopped = events.run_while_active(inactive, EventSettings::default(), async |_, _| Ok(()));
    let (retired, closed) = tokio::join!(retire, stopped);
    retired?;
    assert_eq!(closed, Err(EventConnectionError::SessionUnavailable));
    Ok(())
}
