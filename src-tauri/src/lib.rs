mod installation_url;
#[cfg(all(test, desktop))]
mod ipc_test;
mod native_http;
pub mod registry;
mod registry_ipc;
pub mod rest;
mod rest_ipc;
pub mod sessions;

use tauri::{App, Builder, Context, Runtime};

fn context<R: Runtime>() -> Context<R> {
    tauri::generate_context!()
}

fn build<R: Runtime>(builder: Builder<R>, context: Context<R>) -> tauri::Result<App<R>> {
    builder
        .manage(sessions::AccountSessions::default())
        .invoke_handler(tauri::generate_handler![
            rest_ipc::open_rest_connection,
            rest_ipc::close_rest_connection,
            rest_ipc::prepare_rest_request,
            rest_ipc::send_rest_request,
            rest_ipc::read_rest_body,
            rest_ipc::cancel_rest_request,
            registry_ipc::list_installations,
            registry_ipc::remember_installation,
            registry_ipc::forget_installation
        ])
        .setup(|app| {
            use tauri::Manager;
            #[cfg(all(feature = "webview-check", not(test)))]
            rest_ipc::seed_check_sessions(app)?;
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
        .build(context)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    build(Builder::default(), context())
        .expect("could not start ummka")
        .run(|_, _| {});
}
