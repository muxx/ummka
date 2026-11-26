use super::{AccountEvents, Continuity, EventConnectionError, EventSettings, ServerEvent};
use std::time::Duration;
use tokio::sync::watch;

/// A single window owns this switch. Dropping it stops the reader and its retry timer.
pub struct EventActivity(watch::Sender<bool>);

/// Passed to the signed account that consumes the window's events.
pub struct EventAvailability(watch::Receiver<bool>);

impl EventActivity {
    pub fn new(active: bool) -> (Self, EventAvailability) {
        let (tx, rx) = watch::channel(active);
        (Self(tx), EventAvailability(rx))
    }

    pub fn set_active(&self, active: bool) {
        self.0.send_if_modified(|current| {
            let changed = *current != active;
            *current = active;
            changed
        });
    }
}

// Mattermost Mobile 2.29.1, app/client/websocket/index.ts.
fn retry_delay(failures: u32) -> Duration {
    let steps = if failures > 7 { failures.min(100) } else { 1 };
    Duration::from_secs(u64::from(steps) * 3)
}

impl AccountEvents<'_> {
    /// Run one connection at a time while the window requests events. An application error
    /// is returned even when it describes a transient failure of the consumer's own REST call.
    pub async fn run_while_active(
        &mut self,
        activity: EventAvailability,
        settings: EventSettings<'_>,
        apply: impl AsyncFnMut(ServerEvent, Continuity) -> Result<(), EventConnectionError>,
    ) -> Result<(), EventConnectionError> {
        self.run_with_retry(activity, settings, apply, tokio::time::sleep)
            .await
    }

    pub(super) async fn run_with_retry<F: Future<Output = ()>>(
        &mut self,
        mut activity: EventAvailability,
        settings: EventSettings<'_>,
        mut apply: impl AsyncFnMut(ServerEvent, Continuity) -> Result<(), EventConnectionError>,
        mut wait: impl FnMut(Duration) -> F,
    ) -> Result<(), EventConnectionError> {
        let login = self.account.lifetime();
        let run = async {
            let mut failures = 0_u32;
            while activity.0.wait_for(|active| *active).await.is_ok() {
                let mut consumer_failed = false;
                let mut opened = false;
                let attempt =
                    self.consume_attempt(settings, &mut opened, async |event, continuity| {
                        let result = apply(event, continuity).await;
                        if result.is_err() {
                            consumer_failed = true;
                        }
                        result
                    });
                let result = tokio::select! {
                    biased;
                    changed = activity.0.changed() => {
                        if changed.is_err() { break; }
                        failures = 0;
                        continue;
                    }
                    result = attempt => result,
                };
                match result {
                    Ok(()) => {}
                    Err(EventConnectionError::Network | EventConnectionError::Http(502..=504))
                        if !consumer_failed => {}
                    Err(error) => return Err(error),
                }
                // Mattermost resets the backoff on open, including an empty successful resume.
                failures = if opened {
                    1
                } else {
                    failures.saturating_add(1)
                };
                tokio::select! {
                    biased;
                    changed = activity.0.changed() => {
                        if changed.is_err() { break; }
                        failures = 0;
                    }
                    () = wait(retry_delay(failures)) => {}
                }
            }
            Ok(())
        };
        tokio::select! {
            biased;
            () = login.cancelled() => Err(EventConnectionError::SessionUnavailable),
            result = run => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_retry_intervals_are_bounded() {
        for (failures, seconds) in [
            (1, 3),
            (7, 3),
            (8, 24),
            (99, 297),
            (100, 300),
            (u32::MAX, 300),
        ] {
            assert_eq!(retry_delay(failures), Duration::from_secs(seconds));
        }
    }

    #[test]
    fn redundant_visibility_changes_do_not_interrupt_the_socket() {
        let (owner, activity) = EventActivity::new(true);
        owner.set_active(true);
        assert_eq!(activity.0.has_changed().ok(), Some(false));
        owner.set_active(false);
        owner.set_active(true);
        assert_eq!(activity.0.has_changed().ok(), Some(true));
        assert!(*activity.0.borrow());
    }
}
