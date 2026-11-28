use super::{
    Continuity, EventConnectionError, EventCursor, EventSettings, IncomingFrame, ServerEvent,
};
use crate::rest::RestConnection;
use futures_util::FutureExt;

pub(crate) trait EventConsumer {
    type Item;
    const LIMIT: usize;
    fn project(
        &self,
        event: ServerEvent,
        continuity: Continuity,
    ) -> Result<Option<Self::Item>, EventConnectionError>;
    async fn apply(&mut self, items: Vec<Self::Item>) -> Result<(), EventConnectionError>;
}

pub(super) struct Each<A>(pub(super) A);

impl<A: AsyncFnMut(ServerEvent, Continuity) -> Result<(), EventConnectionError>> EventConsumer
    for Each<A>
{
    type Item = (ServerEvent, Continuity);
    const LIMIT: usize = 1;
    fn project(
        &self,
        event: ServerEvent,
        continuity: Continuity,
    ) -> Result<Option<Self::Item>, EventConnectionError> {
        Ok(Some((event, continuity)))
    }
    async fn apply(&mut self, items: Vec<Self::Item>) -> Result<(), EventConnectionError> {
        for (event, continuity) in items {
            (self.0)(event, continuity).await?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub(super) struct Attempt {
    pub(super) opened: bool,
    pub(super) consumer_failed: bool,
}

/// One in-memory sequence for a signed login. Reuse this value to resume after losing the socket.
pub struct AccountEvents<'a> {
    pub(super) account: &'a RestConnection,
    pub(super) applied: Option<EventCursor>,
}

impl<'a> AccountEvents<'a> {
    pub(crate) fn new(account: &'a RestConnection) -> Self {
        Self {
            account,
            applied: None,
        }
    }

    /// Consume one connection, advancing the position after each successful application.
    /// On a replaced queue the handler must also complete its REST reconciliation.
    pub async fn consume(
        &mut self,
        settings: EventSettings<'_>,
        apply: impl AsyncFnMut(ServerEvent, Continuity) -> Result<(), EventConnectionError>,
    ) -> Result<(), EventConnectionError> {
        consume_groups(
            self.account,
            &mut self.applied,
            settings,
            &mut Attempt::default(),
            &mut Each(apply),
        )
        .await
    }
}

pub(super) async fn consume_groups<C: EventConsumer>(
    account: &RestConnection,
    applied: &mut Option<EventCursor>,
    settings: EventSettings<'_>,
    attempt: &mut Attempt,
    consumer: &mut C,
) -> Result<(), EventConnectionError> {
    let start = applied.clone();
    account
        .with_event_reader(settings, start.as_ref(), |mut reader| async move {
            attempt.opened = true;
            while let Some(mut frame) = reader.next_frame(applied.as_ref()).await? {
                let mut projected = Vec::new();
                let mut through = None;
                let mut read_error = None;
                for index in 1..=C::LIMIT {
                    if let IncomingFrame::Event {
                        event,
                        continuity,
                        after,
                    } = frame
                    {
                        let hello = event.name == "hello";
                        match consumer.project(event, continuity) {
                            Ok(Some(item)) => projected.push(item),
                            Ok(None) => {}
                            Err(error) => {
                                read_error = Some(error);
                                break;
                            }
                        }
                        through = Some(after);
                        if hello {
                            break;
                        }
                    }
                    if index == C::LIMIT {
                        break;
                    }
                    // Never wait for a second frame. Decode against the tentative position,
                    // but advertise it to the server only after the consumer has committed.
                    let tentative = through.as_ref().or(applied.as_ref());
                    match reader.next_frame(tentative).now_or_never() {
                        Some(Ok(Some(next))) => frame = next,
                        Some(Err(error)) => {
                            read_error = Some(error);
                            break;
                        }
                        _ => break,
                    }
                }
                if let Some(through) = through {
                    if !projected.is_empty()
                        && let Err(error) = consumer.apply(projected).await
                    {
                        attempt.consumer_failed = true;
                        return Err(error);
                    }
                    *applied = Some(through);
                }
                if let Some(error) = read_error {
                    return Err(error);
                }
            }
            Ok(())
        })
        .await
}
