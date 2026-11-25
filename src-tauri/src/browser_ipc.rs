use crate::app_error::PublicError;
use crate::authentication::{
    AuthError, NativeAuthentication, Revocation, SignInError,
    browser::{BrowserProvider, BrowserSignIn},
    system_browser::{self, PresentationError, SystemSignInError},
};
use crate::registry::RegistryError;
use crate::registry_ipc::read_installation_selection;
use crate::rest::TransportError;
use crate::sessions::AccountSessions;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, Webview, ipc::Channel};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum BrowserActionError {
    SelectionChanged,
    Registry {
        cause: RegistryError,
    },
    Browser {
        cause: PresentationError,
    },
    Transport {
        cause: TransportError,
    },
    Server {
        error: PublicError,
    },
    InvalidResponse,
    NotSaved {
        cause: TransportError,
        revocation_confirmed: bool,
    },
    Interrupted,
}

impl From<SystemSignInError> for BrowserActionError {
    fn from(error: SystemSignInError) -> Self {
        match error {
            SystemSignInError::Browser(cause) => Self::Browser { cause },
            SystemSignInError::SignIn(SignInError::Authentication(error)) => match error {
                AuthError::Server(error) => Self::Server { error },
                AuthError::Transport(cause) => Self::Transport { cause },
                AuthError::InvalidResponse => Self::InvalidResponse,
            },
            SystemSignInError::SignIn(SignInError::NotSaved { cause, revocation }) => {
                Self::NotSaved {
                    cause,
                    revocation_confirmed: revocation == Revocation::Confirmed,
                }
            }
            SystemSignInError::SignIn(SignInError::Interrupted) => Self::Interrupted,
        }
    }
}

#[tauri::command]
pub(crate) async fn sign_in_with_browser<R: Runtime>(
    webview: Webview<R>,
    server_url: String,
    provider: BrowserProvider,
    on_started: Channel<String>,
) -> Result<String, BrowserActionError> {
    let selection = read_installation_selection(webview.app_handle().clone())
        .await
        .map_err(|cause| BrowserActionError::Registry { cause })?;
    if selection.selected.as_deref() != Some(server_url.as_str()) {
        return Err(BrowserActionError::SelectionChanged);
    }
    let client = NativeAuthentication::new(&server_url)
        .map_err(|cause| BrowserActionError::Transport { cause })?;
    let window =
        webview
            .get_webview_window(webview.label())
            .ok_or(BrowserActionError::Browser {
                cause: PresentationError::Unavailable,
            })?;
    let sessions = webview.state::<AccountSessions>();
    let account = BrowserSignIn::new(client, provider)
        .sign_in_using_system_browser(&window, &sessions, |id| {
            on_started
                .send(id.to_string())
                .map_err(|_| PresentationError::Unavailable)
        })
        .await?;
    Ok(account.user_id().to_owned())
}

#[tauri::command]
pub(crate) fn cancel_browser_sign_in<R: Runtime>(app: AppHandle<R>, request_id: String) -> bool {
    Uuid::try_parse(&request_id).is_ok_and(|id| system_browser::cancel(&app, id))
}

#[cfg(all(test, desktop))]
mod tests;
