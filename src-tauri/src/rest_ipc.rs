use crate::rest::{RestConnection, TransportError};
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};

impl Resource for RestConnection {}

#[tauri::command]
pub(crate) fn open_rest_connection<R: Runtime>(
    webview: Webview<R>,
    base_path: String,
) -> Result<ResourceId, TransportError> {
    let mut resources = webview.resources_table();
    Ok(resources.add(RestConnection::new(&base_path)?))
}

#[tauri::command]
pub(crate) fn close_rest_connection<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<(), &'static str> {
    webview
        .resources_table()
        .take::<RestConnection>(rid)
        .map(drop)
        .map_err(|_| "unknown_connection")
}

pub(crate) fn clear_connections<R: Runtime>(webview: &Webview<R>) {
    let mut resources = webview.resources_table();
    let ids: Vec<_> = resources.names().map(|(id, _)| id).collect();
    for id in ids {
        // A typed take leaves resources belonging to other parts of the app in place.
        let _ = resources.take::<RestConnection>(id);
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
