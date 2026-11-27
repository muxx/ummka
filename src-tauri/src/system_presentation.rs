//! Correlate each system dialog result with the native request that opened it.
use std::sync::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationError {
    Busy,
    Cancelled,
    Unsupported,
    Unavailable,
}

struct Pending<T> {
    id: Uuid,
    result: Option<oneshot::Sender<Result<T, PresentationError>>>,
}

pub(crate) struct Presentations<T>(Mutex<Option<Pending<T>>>);

type Reservation<T> = (Uuid, oneshot::Receiver<Result<T, PresentationError>>);

impl<T> Presentations<T> {
    pub(crate) const fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub(crate) fn reserve(&self) -> Result<Reservation<T>, PresentationError> {
        let mut state = self.0.lock().expect("native presentation mutex poisoned");
        if state.is_some() {
            return Err(PresentationError::Busy);
        }
        let (send, receive) = oneshot::channel();
        let id = Uuid::new_v4();
        *state = Some(Pending {
            id,
            result: Some(send),
        });
        Ok((id, receive))
    }

    pub(crate) fn waiting(&self) -> Option<Uuid> {
        let state = self.0.lock().expect("native presentation mutex poisoned");
        state
            .as_ref()
            .filter(|slot| slot.result.is_some())
            .map(|slot| slot.id)
    }

    pub(crate) fn deliver(&self, id: Uuid, result: Result<T, PresentationError>) -> bool {
        let mut state = self.0.lock().expect("native presentation mutex poisoned");
        if let Some(sender) = state
            .as_mut()
            .filter(|slot| slot.id == id)
            .and_then(|slot| slot.result.take())
        {
            let _ = sender.send(result);
            return true;
        }
        false
    }

    /// Returns true if an unfinished system dialog still needs to be dismissed.
    pub(crate) fn release(&self, id: Uuid) -> bool {
        self.0
            .lock()
            .expect("native presentation mutex poisoned")
            .take_if(|slot| slot.id == id)
            .is_some_and(|slot| slot.result.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_os_result_belongs_to_one_request_and_cannot_finish_the_next_one() {
        let broker = Presentations::<String>::new();
        let (first, mut first_result) = broker.reserve().unwrap();
        assert!(matches!(broker.reserve(), Err(PresentationError::Busy)));
        broker.deliver(first, Err(PresentationError::Cancelled));
        assert_eq!(
            first_result.try_recv(),
            Ok(Err(PresentationError::Cancelled))
        );
        assert!(!broker.release(first));
        let (second, mut next) = broker.reserve().unwrap();
        assert_ne!(first, second);
        broker.deliver(first, Ok("late".into()));
        assert_eq!(broker.waiting(), Some(second));
        assert!(!broker.release(first));
        broker.deliver(second, Ok("returned".into()));
        broker.deliver(second, Err(PresentationError::Cancelled));
        assert_eq!(next.try_recv(), Ok(Ok("returned".into())));
        assert!(!broker.release(second));
        let (abandoned, receive) = broker.reserve().unwrap();
        assert!(broker.release(abandoned));
        assert!(receive.blocking_recv().is_err());
    }
}
