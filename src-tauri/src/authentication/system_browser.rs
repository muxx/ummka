//! Browser callbacks belong to a native presentation, including its cancellation and lifetime.
use super::{SignInError, browser::BrowserSignIn};
use crate::sessions::{Account, AccountSessions};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime, WebviewWindow};
use tokio::sync::oneshot;
use uuid::Uuid;

#[cfg(target_os = "android")]
mod android;
#[cfg(all(feature = "webview-check", target_os = "android"))]
pub(crate) mod android_check;
#[cfg(all(feature = "webview-check", target_os = "macos"))]
pub(crate) mod checks;
#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationError {
    Busy,
    Cancelled,
    Unsupported,
    Unavailable,
}

#[derive(Debug, Eq, PartialEq)]
pub enum SystemSignInError {
    Browser(PresentationError),
    SignIn(SignInError),
}

type Returned = Result<String, PresentationError>;

struct Pending {
    id: Uuid,
    result: Option<oneshot::Sender<Returned>>,
}

#[derive(Default)]
struct Presentations(Mutex<Option<Pending>>);

static PRESENTATION: Presentations = Presentations(Mutex::new(None));

impl Presentations {
    fn reserve(&self) -> Result<(Uuid, oneshot::Receiver<Returned>), PresentationError> {
        let mut state = self.0.lock().expect("browser presentation mutex poisoned");
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

    fn waiting(&self) -> Option<Uuid> {
        let state = self.0.lock().expect("browser presentation mutex poisoned");
        state
            .as_ref()
            .filter(|slot| slot.result.is_some())
            .map(|slot| slot.id)
    }

    fn deliver(&self, id: Uuid, result: Returned) -> bool {
        let mut state = self.0.lock().expect("browser presentation mutex poisoned");
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
    fn release(&self, id: Uuid) -> bool {
        self.0
            .lock()
            .expect("browser presentation mutex poisoned")
            .take_if(|slot| slot.id == id)
            .is_some_and(|slot| slot.result.is_some())
    }
}

struct Owner<R: Runtime> {
    app: AppHandle<R>,
    id: Uuid,
}

impl<R: Runtime> Drop for Owner<R> {
    fn drop(&mut self) {
        if PRESENTATION.release(self.id) {
            dismiss(&self.app, self.id);
        }
    }
}

fn dismiss<R: Runtime>(_app: &AppHandle<R>, _id: Uuid) {
    #[cfg(target_os = "macos")]
    macos::dismiss(_app, _id);
    #[cfg(target_os = "android")]
    android::dismiss(_app, _id);
}

pub(crate) fn cancel<R: Runtime>(app: &AppHandle<R>, id: Uuid) -> bool {
    let cancelled = PRESENTATION.deliver(id, Err(PresentationError::Cancelled));
    if cancelled {
        dismiss(app, id);
    }
    cancelled
}

pub(crate) fn owner_closed<R: Runtime>(app: &AppHandle<R>) {
    if let Some(id) = PRESENTATION.waiting() {
        cancel(app, id);
    }
}

impl BrowserSignIn {
    /// The caller supplies a native window and a verified installation-bound attempt.
    pub async fn sign_in_using_system_browser<R: Runtime>(
        self,
        window: &WebviewWindow<R>,
        sessions: &AccountSessions,
        on_reserved: impl FnOnce(Uuid) -> Result<(), PresentationError>,
    ) -> Result<Account, SystemSignInError> {
        let (_owner, receive) = begin(window, self.browser_url(), on_reserved)
            .await
            .map_err(SystemSignInError::Browser)?;
        let result = receive
            .await
            .map_err(|_| SystemSignInError::Browser(PresentationError::Unavailable))?;
        let callback = result.map_err(SystemSignInError::Browser)?;
        self.complete(sessions, callback)
            .await
            .map_err(SystemSignInError::SignIn)
    }
}

async fn begin<R: Runtime>(
    window: &WebviewWindow<R>,
    url: reqwest::Url,
    on_reserved: impl FnOnce(Uuid) -> Result<(), PresentationError>,
) -> Result<(Owner<R>, oneshot::Receiver<Returned>), PresentationError> {
    use tauri::Manager;
    let (id, receive) = PRESENTATION.reserve()?;
    let owner = Owner {
        app: window.app_handle().clone(),
        id,
    };
    on_reserved(id)?;
    open(window, id, url).await?;
    Ok((owner, receive))
}

#[cfg(target_os = "macos")]
use macos::open;

#[cfg(target_os = "android")]
use android::open;

#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn open<R: Runtime>(
    _window: &WebviewWindow<R>,
    _id: Uuid,
    _url: reqwest::Url,
) -> Result<(), PresentationError> {
    Err(PresentationError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_os_result_belongs_to_one_request_and_cannot_finish_the_next_one() {
        let broker = Presentations::default();
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
