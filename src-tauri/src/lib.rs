mod app_error;
pub mod authentication;
mod browser_ipc;
mod channels_links;
#[cfg(all(feature = "webview-check", target_os = "macos"))]
mod check_keyboard;
#[cfg(all(feature = "webview-check", target_os = "macos"))]
mod check_link_window;
pub mod credentials;
#[cfg(any(target_os = "macos", target_os = "android"))]
pub mod device_document;
mod external_post_link;
pub mod history;
mod installation_url;
#[cfg(all(test, desktop))]
mod ipc_test;
pub mod models;
mod native_http;
pub mod realtime;
pub mod registry;
mod registry_ipc;
pub mod rest;
mod rest_ipc;
pub mod sessions;

#[cfg(any(target_os = "macos", target_os = "android"))]
pub use rest_ipc::draft_files;
mod system_presentation;

use tauri::{App, Builder, Context, Runtime};

fn context<R: Runtime>() -> Context<R> {
    tauri::generate_context!()
}

fn build<R: Runtime>(builder: Builder<R>, context: Context<R>) -> tauri::Result<App<R>> {
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<R>::new("clipboard-policy")
            .setup(|_, api| {
                api.register_android_plugin("io.github.muxx.ummka.dev", "ClipboardPolicyPlugin")?;
                Ok(())
            })
            .build(),
    );
    let sessions = sessions::AccountSessions::for_application(context.config().identifier.clone());
    builder
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(sessions)
        .manage(channels_links::ChannelsLinks::default())
        .invoke_handler(tauri::generate_handler![
            external_post_link::open_external_post_link,
            channels_links::pending_channels_link,
            channels_links::acknowledge_channels_link,
            rest_ipc::open_rest_connection,
            rest_ipc::get_current_account_id,
            rest_ipc::list_account_ids,
            rest_ipc::forget_local_account,
            rest_ipc::sign_out_account,
            rest_ipc::sign_out_on_device,
            rest_ipc::close_rest_connection,
            #[cfg(all(feature = "webview-check", any(target_os = "android", target_os = "macos")))]
            rest_ipc::trace_webview_check,
            #[cfg(all(feature = "webview-check", target_os = "macos"))]
            check_link_window::check_system_post_window,
            rest_ipc::drafts::read_composer_draft,
            rest_ipc::drafts::save_composer_draft,
            rest_ipc::drafts::transition_draft_command,
            rest_ipc::delivery::stage_composer_post,
            rest_ipc::delivery::read_pending_posts,
            rest_ipc::delivery::confirm_post_delivery,
            rest_ipc::delivery::retire_delivered_posts,
            rest_ipc::delivery::record_post_refusal,
            rest_ipc::delivery::retry_pending_post,
            rest_ipc::delivery::dismiss_pending_post,
            rest_ipc::settings::read_workspace_settings,
            rest_ipc::settings::begin_workspace_policy_load,
            rest_ipc::settings::store_workspace_policy,
            rest_ipc::settings::cancel_workspace_policy_load,
            rest_ipc::directory::read_joined_teams,
            rest_ipc::directory::read_recent_team_searches,
            rest_ipc::directory::remember_team_search,
            rest_ipc::directory::forget_team_search,
            rest_ipc::directory::select_joined_team,
            rest_ipc::directory::begin_team_directory_load,
            rest_ipc::directory::store_team_directory,
            rest_ipc::directory::cancel_team_directory_load,
            rest_ipc::profiles::read_saved_profiles,
            rest_ipc::profiles::store_channel_profiles,
            rest_ipc::sidebar::read_team_sidebar,
            rest_ipc::sidebar::select_sidebar_channel,
            rest_ipc::sidebar::begin_sidebar_load,
            rest_ipc::sidebar::store_team_sidebar,
            rest_ipc::sidebar::cancel_sidebar_load,
            rest_ipc::team_roles::read_team_roles,
            rest_ipc::team_roles::begin_team_role_load,
            rest_ipc::team_roles::store_team_roles,
            rest_ipc::team_roles::cancel_team_role_load,
            rest_ipc::history::read_saved_post,
            rest_ipc::history::read_channel_window,
            rest_ipc::history::begin_channel_history_load,
            rest_ipc::history::store_channel_history_page,
            rest_ipc::history::cancel_channel_history_load,
            rest_ipc::prepare_rest_request,
            rest_ipc::send_rest_request,
            rest_ipc::read_rest_body,
            rest_ipc::cancel_rest_request,
            browser_ipc::sign_in_with_browser,
            browser_ipc::cancel_browser_sign_in,
            registry_ipc::list_installations,
            registry_ipc::read_installation_selection,
            registry_ipc::select_installation,
            registry_ipc::connect_installation,
            registry_ipc::remember_installation,
            registry_ipc::forget_installation
        ])
        .setup(|app| {
            use tauri::Manager;
            let main = app
                .get_webview_window("main")
                .ok_or("missing main WebView")?;
            #[cfg(all(feature = "webview-check", any(target_os = "android", target_os = "macos")))]
            app.add_capability(
                r#"{"identifier":"fixture-progress","local":true,"webviews":["main"],"permissions":["allow-trace-webview-check"]}"#,
            )?;
            #[cfg(all(target_os = "macos", feature = "webview-check"))]
            {
                if std::env::var("UMMKA_CHECK_SCENARIO")
                    .is_ok_and(|scenario| check_link_window::enabled(&scenario))
                {
                    app.add_capability(
                        r#"{"identifier":"fixture-system-post-window","local":true,"webviews":["main"],"permissions":["allow-check-system-post-window"]}"#,
                    )?;
                }
                // Setup runs on the main thread. The Tauri window owns this NSWindow.
                let native = unsafe { &*main.ns_window()?.cast::<objc2_app_kit::NSWindow>() };
                if std::env::var_os("UMMKA_CHECK_KEY_INPUT").is_some() {
                    main.set_focus()?;
                    main.with_webview(check_keyboard::listen)?;
                }
                if native.minSize().width != 400.0 {
                    return Err("unexpected native minimum window width".into());
                }
            }
            rest_ipc::watch_window(main.as_ref());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                authentication::system_browser::owner_closed(window.app_handle());
                #[cfg(any(target_os = "macos", target_os = "android"))]
                device_document::picker::owner_closed(window.app_handle());
            }
        })
        .on_page_load(|webview, load| {
            if load.event() == tauri::webview::PageLoadEvent::Started {
                rest_ipc::clear_connections(webview);
                if webview.label() == "main" {
                    use tauri::Manager;
                    authentication::system_browser::owner_closed(webview.app_handle());
                    #[cfg(any(target_os = "macos", target_os = "android"))]
                    device_document::picker::owner_closed(webview.app_handle());
                }
            }
            #[cfg(feature = "webview-check")]
            if load.event() == tauri::webview::PageLoadEvent::Finished {
                #[cfg(target_os = "macos")]
                if load.url().path() == "/picker-check.html"
                    && webview.label() == "main"
                    && let Ok(mode) = std::env::var("UMMKA_CHECK_DOCUMENT_PICKER")
                {
                    use tauri::Manager;
                    let window = webview
                        .app_handle()
                        .get_webview_window("main")
                        .expect("picker fixture window");
                    device_document::picker::mac_check::run(window, mode == "manual");
                    return;
                }
                rest_ipc::report_check(webview, load.url());
            }
        })
        .build(context)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = context();
    #[cfg(all(feature = "webview-check", target_os = "macos"))]
    let check_picker = std::env::var_os("UMMKA_CHECK_DOCUMENT_PICKER").is_some();
    #[cfg(all(feature = "webview-check", target_os = "macos"))]
    let config = {
        let mut config = config;
        if check_picker {
            let main = &mut config.config_mut().app.windows[0];
            main.url = tauri::WebviewUrl::App("picker-check.html".into());
            main.visible = true;
        }
        let visible = std::env::var_os("UMMKA_CHECK_SYSTEM_POST_WINDOW").is_some()
            || std::env::var_os("UMMKA_CHECK_KEY_INPUT").is_some();
        let scenario = std::env::var("UMMKA_CHECK_SCENARIO").ok();
        if visible || scenario.is_some() {
            let main = config
                .config_mut()
                .app
                .windows
                .iter_mut()
                .find(|window| window.label == "main")
                .expect("missing main test window");
            // AppKit focus and scrolling need a normally presented WKWebView.
            main.visible = visible;
            if let Some(scenario) = scenario {
                let check_link_window = check_link_window::enabled(&scenario);
                assert!(
                    matches!(
                        scenario.as_str(),
                        "formatting-320" | "formatting-820" | "workspace-back" | "external-handoff"
                    ) || check_link_window
                );
                if check_link_window {
                    // Background scheduling is part of restoring a real window.
                    main.background_throttling = None;
                }
                main.url = tauri::WebviewUrl::App(format!("index.html?fixture={scenario}").into());
            }
        }
        config
    };
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
    #[cfg(all(feature = "webview-check", target_os = "macos"))]
    if let Ok(mode) = std::env::var("UMMKA_CHECK_BROWSER_PRESENTATION") {
        authentication::system_browser::checks::run(config, &mode);
        return;
    }
    build(Builder::default(), config)
        .expect("could not start ummka")
        .run(move |app, event| {
            #[cfg(all(feature = "webview-check", target_os = "macos"))]
            if check_picker
                && let tauri::RunEvent::ExitRequested {
                    code: None, api, ..
                } = event
            {
                // Let the fixture verify cancellation after the last window closes.
                api.prevent_exit();
                return;
            }
            #[cfg(all(target_os = "macos", feature = "webview-check"))]
            let rejected_control = check_link_window::is_rejected_control(&event);
            channels_links::receive(app, event);
            #[cfg(all(target_os = "macos", feature = "webview-check"))]
            if rejected_control {
                check_link_window::observe_rejected_control(app);
            }
        });
}
