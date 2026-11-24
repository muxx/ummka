mod installation_url;
mod native_http;
pub mod registry;
pub mod rest;
mod rest_ipc;

use tauri::{App, Builder, Runtime};

fn build<R: Runtime>(builder: Builder<R>) -> tauri::Result<App<R>> {
    builder
        .invoke_handler(tauri::generate_handler![
            rest_ipc::open_rest_connection,
            rest_ipc::close_rest_connection,
            rest_ipc::prepare_rest_request,
            rest_ipc::send_rest_request,
            rest_ipc::read_rest_body,
            rest_ipc::cancel_rest_request
        ])
        .setup(|app| {
            use tauri::Manager;
            let main = app
                .get_webview_window("main")
                .ok_or("missing main WebView")?;
            rest_ipc::watch_window(main.as_ref());
            Ok(())
        })
        .on_page_load(|webview, load| {
            if load.event() == tauri::webview::PageLoadEvent::Started {
                rest_ipc::clear_connections(webview);
            }
            #[cfg(feature = "webview-check")]
            if load.event() == tauri::webview::PageLoadEvent::Finished {
                rest_ipc::report_check(webview, load.url());
            }
        })
        .build(tauri::generate_context!())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    build(Builder::default())
        .expect("could not start ummka")
        .run(|_, _| {});
}
