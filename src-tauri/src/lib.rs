mod native_http;
pub mod rest;
mod rest_ipc;

use tauri::{App, Builder, Runtime};

fn build<R: Runtime>(builder: Builder<R>) -> tauri::Result<App<R>> {
    builder
        .invoke_handler(tauri::generate_handler![
            rest_ipc::open_rest_connection,
            rest_ipc::close_rest_connection
        ])
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
