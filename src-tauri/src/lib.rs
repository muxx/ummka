mod app_error;
pub mod authentication;
pub mod credentials;
pub mod history;
mod installation_url;
#[cfg(all(test, desktop))]
mod ipc_test;
pub mod models;
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
    let sessions = sessions::AccountSessions::for_application(context.config().identifier.clone());
    builder
        .manage(sessions)
        .invoke_handler(tauri::generate_handler![
            rest_ipc::open_rest_connection,
            rest_ipc::get_current_account_id,
            rest_ipc::list_account_ids,
            rest_ipc::forget_local_account,
            rest_ipc::sign_out_account,
            rest_ipc::sign_out_on_device,
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
    let config = context();
    #[cfg(all(feature = "webview-check", target_os = "macos"))]
    if std::env::var("UMMKA_CHECK_SEED_ACCOUNTS").as_deref() == Ok("1") {
        let port = config.config().plugins.0["ummkaFixture"]["dataPort"]
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .expect("missing fixture port");
        let sessions =
            sessions::AccountSessions::for_application(config.config().identifier.clone());
        rest_ipc::seed_check_sessions(&sessions, port)
            .expect("cannot seed isolated credential store");
        println!("UMMKA_WEBVIEW_CHECK credentials-seeded");
        return;
    }
    build(Builder::default(), config)
        .expect("could not start ummka")
        .run(|_, _| {});
}
