mod exchange;
#[cfg(all(feature = "webview-check", target_os = "macos"))]
mod window_check;

use crate::rest::{RestConnection, TransportError};
use exchange::{ExchangeError, ResponseHead, Session};
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

#[tauri::command]
pub(crate) fn open_rest_connection<R: Runtime>(
    webview: Webview<R>,
    base_path: String,
) -> Result<ResourceId, TransportError> {
    let mut resources = webview.resources_table();
    Ok(resources.add(Session::new(open_transport(&base_path)?)))
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
) -> Result<ResponseHead, ExchangeError> {
    session(&webview, connection)?
        .send(exchange, &method, &url, headers)
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
        }
    }
}

#[cfg(feature = "webview-check")]
pub(crate) fn report_check<R: Runtime>(webview: &Webview<R>, url: &tauri::Url) {
    let local = match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => !cfg!(target_os = "android"),
        ("http", Some("tauri.localhost")) => cfg!(target_os = "android"),
        _ => false,
    };
    if webview.label() == "main" && local && url.path() == "/ipc-result.html" {
        let passed = url.query() == Some("pass");
        #[cfg(target_os = "macos")]
        if passed {
            window_check::run(webview);
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
