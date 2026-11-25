pub(crate) mod directory;
mod exchange;
pub(crate) mod history;
#[cfg(all(
    feature = "webview-check",
    any(
        target_os = "macos",
        all(feature = "native-http-check", target_os = "android")
    )
))]
mod history_check;
pub(crate) mod profiles;
mod response;
pub(crate) mod sidebar;
#[cfg(all(feature = "webview-check", target_os = "macos"))]
mod window_check;

use crate::rest::{RestConnection, TransportError};
use crate::sessions::AccountSessions;
use exchange::{ExchangeError, Session};
use response::ResponseHead;
use tauri::ipc::Response;
use tauri::{Manager, Resource, ResourceId, Runtime, Webview, WindowEvent};

pub(crate) fn watch_window<R: Runtime>(webview: &Webview<R>) {
    // Tauri removes the WebView from its registry before delivering Destroyed.
    let owner = webview.clone();
    webview.window().on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            clear_connections(&owner);
        }
    });
}

struct PendingAccountOpen;
impl Resource for PendingAccountOpen {}

#[tauri::command]
pub(crate) async fn open_rest_connection<R: Runtime>(
    webview: Webview<R>,
    base_path: String,
    user_id: Option<String>,
) -> Result<ResourceId, TransportError> {
    let transport = open_transport(&base_path)?;
    let Some(id) = user_id else {
        return Ok(webview.resources_table().add(Session::new(transport)));
    };
    // Navigation and window destruction can retire a pending Keychain/Keystore lookup.
    let pending = webview.resources_table().add(PendingAccountOpen);
    let restored = transport
        .for_account(&webview.state::<AccountSessions>(), &id)
        .await;
    let mut table = webview.resources_table();
    table
        .take::<PendingAccountOpen>(pending)
        .map_err(|_| TransportError::SessionUnavailable)?;
    Ok(table.add(Session::new(restored?)))
}

#[tauri::command]
pub(crate) async fn get_current_account_id<R: Runtime>(
    webview: Webview<R>,
    server_url: String,
) -> Result<Option<String>, TransportError> {
    webview
        .state::<AccountSessions>()
        .current_account_id(&server_url)
        .await
}

#[tauri::command]
pub(crate) async fn list_account_ids<R: Runtime>(
    webview: Webview<R>,
    server_url: String,
) -> Result<Vec<String>, TransportError> {
    webview
        .state::<AccountSessions>()
        .account_ids(&server_url)
        .await
}

#[tauri::command]
pub(crate) async fn forget_local_account<R: Runtime>(
    webview: Webview<R>,
    server_url: String,
    user_id: String,
) -> Result<(), TransportError> {
    webview
        .state::<AccountSessions>()
        .forget(&server_url, &user_id)
        .await
}

#[cfg(not(all(feature = "webview-check", target_os = "macos")))]
fn open_transport(base: &str) -> Result<RestConnection, TransportError> {
    RestConnection::new(base)
}

#[cfg(all(feature = "webview-check", target_os = "macos"))]
fn open_transport(base: &str) -> Result<RestConnection, TransportError> {
    use crate::native_http::NativeHttp;
    RestConnection::with_client(base, || {
        let path = std::env::var_os("UMMKA_HTTP_TEST_CA").ok_or(TransportError::Network)?;
        let pem = std::fs::read(path).map_err(|_| TransportError::Network)?;
        let ca = reqwest::Certificate::from_pem(&pem).map_err(|_| TransportError::Network)?;
        NativeHttp::from_builder(reqwest::Client::builder().tls_certs_merge([ca]))
    })
}

#[tauri::command]
pub(crate) fn close_rest_connection<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<(), ExchangeError> {
    webview
        .resources_table()
        .take::<Session>(rid)
        .map(Resource::close)
        .map_err(|_| ExchangeError::UnknownConnection)
}

fn session<R: Runtime>(
    view: &Webview<R>,
    connection: ResourceId,
) -> Result<std::sync::Arc<Session>, ExchangeError> {
    view.resources_table()
        .get::<Session>(connection)
        .map_err(|_| ExchangeError::UnknownConnection)
}

#[tauri::command]
pub(crate) async fn sign_out_account<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<crate::authentication::SignOut, ExchangeError> {
    session(&webview, rid)?
        .http
        .sign_out(&webview.state::<AccountSessions>())
        .await
        .map_err(ExchangeError::Transport)
}

#[tauri::command]
pub(crate) async fn sign_out_on_device<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<crate::credentials::Removal, ExchangeError> {
    session(&webview, rid)?
        .http
        .sign_out_on_device(&webview.state::<AccountSessions>())
        .await
        .map_err(ExchangeError::Transport)
}

#[tauri::command]
pub(crate) fn prepare_rest_request<R: Runtime>(
    webview: Webview<R>,
    connection: ResourceId,
) -> Result<ResourceId, ExchangeError> {
    session(&webview, connection)?.prepare()
}

#[tauri::command]
pub(crate) async fn send_rest_request<R: Runtime>(
    webview: Webview<R>,
    connection: ResourceId,
    exchange: ResourceId,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<ResponseHead, ExchangeError> {
    session(&webview, connection)?
        .send(exchange, &method, &url, headers, body)
        .await
}

#[tauri::command]
pub(crate) async fn read_rest_body<R: Runtime>(
    webview: Webview<R>,
    connection: ResourceId,
    exchange: ResourceId,
) -> Result<Response, ExchangeError> {
    session(&webview, connection)?
        .read(exchange)
        .await
        .map(Response::new)
}

#[tauri::command]
pub(crate) fn cancel_rest_request<R: Runtime>(
    webview: Webview<R>,
    connection: ResourceId,
    exchange: ResourceId,
) -> Result<(), ExchangeError> {
    session(&webview, connection)?.cancel(exchange)
}

pub(crate) fn clear_connections<R: Runtime>(webview: &Webview<R>) {
    let mut resources = webview.resources_table();
    let ids: Vec<_> = resources.names().map(|(id, _)| id).collect();
    for id in ids {
        // A typed take leaves resources belonging to other parts of the app in place.
        if let Ok(connection) = resources.take::<Session>(id) {
            connection.close();
        } else {
            let _ = resources.take::<PendingAccountOpen>(id);
        }
    }
}

#[cfg(all(
    feature = "webview-check",
    any(
        target_os = "macos",
        all(feature = "native-http-check", target_os = "android")
    )
))]
pub(crate) fn seed_check_sessions(
    sessions: &AccountSessions,
    port: u16,
) -> Result<(), TransportError> {
    let root = format!("https://127.0.0.1:{port}");
    let prefixed = format!("{root}/team/chat");
    let secondary = format!("{prefixed}/secondary");
    let confirmed = format!("{prefixed}/confirmed");
    tauri::async_runtime::block_on(async {
        for (base, account, token) in [
            (
                root.as_str(),
                "Abc01234567890123456789012",
                "fixture-root-session",
            ),
            (
                prefixed.as_str(),
                "Abc01234567890123456789012",
                "fixture-prefixed-session",
            ),
            (
                secondary.as_str(),
                "bbbbbbbbbbbbbbbbbbbbbbbbbb",
                "fixture-second-session",
            ),
            (
                confirmed.as_str(),
                "dddddddddddddddddddddddddd",
                "fixture-exit-session",
            ),
            (
                "https://chat.example.test/Team",
                "Abc01234567890123456789012",
                "fixture-offline-link-session",
            ),
        ] {
            sessions.activate(base, account, token).await?;
        }
        history_check::seed(sessions, &root).await?;
        #[cfg(target_os = "android")]
        sessions
            .activate(
                &format!("{root}/vault-refusal"),
                "Abc01234567890123456789012",
                "fixture-local-removal-failure",
            )
            .await?;
        Ok(())
    })
}

#[cfg(feature = "webview-check")]
pub(crate) fn report_check<R: Runtime>(webview: &Webview<R>, url: &tauri::Url) {
    let local = match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => !cfg!(target_os = "android"),
        ("http", Some("tauri.localhost")) => cfg!(target_os = "android"),
        _ => false,
    };
    if webview.label() == "main" && local && url.path() == "/ipc-result.html" {
        if let Some(phase @ ("registry-removed" | "registry-confirmed" | "registry-unsupported")) =
            url.query()
        {
            println!("UMMKA_WEBVIEW_CHECK {phase}");
            #[cfg(not(target_os = "android"))]
            webview.app_handle().exit(0);
            return;
        }
        let passed = url.query() == Some("pass");
        #[cfg(target_os = "macos")]
        if passed {
            window_check::run(webview);
            return;
        }
        #[cfg(target_os = "android")]
        if passed {
            crate::authentication::system_browser::android_check::run(webview);
            return;
        }
        println!(
            "UMMKA_WEBVIEW_CHECK {}",
            if passed { "PASS" } else { "FAIL" }
        );
        if !passed {
            eprintln!(
                "WebView check stopped at {}",
                url.query().unwrap_or("missing result")
            );
        }
        #[cfg(not(target_os = "android"))]
        webview.app_handle().exit(i32::from(!passed));
    }
}

#[cfg(all(test, desktop))]
mod tests;
