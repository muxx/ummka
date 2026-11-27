//! Browser callbacks belong to a native presentation, including its cancellation and lifetime.
use super::{SignInError, browser::BrowserSignIn};
use crate::sessions::{Account, AccountSessions};
pub use crate::system_presentation::PresentationError;
use crate::system_presentation::Presentations;
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

#[derive(Debug, Eq, PartialEq)]
pub enum SystemSignInError {
    Browser(PresentationError),
    SignIn(SignInError),
}

type Returned = Result<String, PresentationError>;

static PRESENTATION: Presentations<String> = Presentations::new();

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
