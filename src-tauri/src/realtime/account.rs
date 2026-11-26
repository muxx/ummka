use super::{
    Continuity, EventConnectionError, EventCursor, EventSettings, IncomingFrame, ServerEvent,
};
use crate::rest::RestConnection;

/// One in-memory sequence for a signed login. Reuse this value to resume after losing the socket.
pub struct AccountEvents<'a> {
    account: &'a RestConnection,
    applied: Option<EventCursor>,
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
        mut apply: impl AsyncFnMut(ServerEvent, Continuity) -> Result<(), EventConnectionError>,
    ) -> Result<(), EventConnectionError> {
        let start = self.applied.clone();
        self.account
            .with_event_stream(settings, start.as_ref(), async |reader| {
                while let Some(frame) = reader.next_frame(self.applied.as_ref()).await? {
                    if let IncomingFrame::Event {
                        event,
                        continuity,
                        after,
                    } = frame
                    {
                        apply(event, continuity).await?;
                        self.applied = Some(after);
                    }
                }
                Ok(())
            })
            .await
    }
}
