//! Runs only in the isolated WebView fixture. A developer's regular checks never open a browser.
use super::{PresentationError, begin, macos, owner_closed};
use crate::authentication::{
    NativeAuthentication,
    browser::{BrowserProvider, BrowserSignIn},
};
use tauri::{Builder, Context, Manager, RunEvent, WebviewWindow, Wry};

pub(crate) fn run(mut context: Context<Wry>, mode: &str) {
    let show = match mode {
        "anchor" => false,
        "start" => true,
        _ => panic!("unknown browser presentation check"),
    };
    let window = &mut context.config_mut().app.windows[0];
    window.url = tauri::WebviewUrl::External("about:blank".parse().unwrap());
    window.visible = show;
    let app = crate::build(Builder::default(), context).expect("browser fixture application");
    app.run(move |app, event| {
        if !matches!(event, RunEvent::Ready) {
            return;
        }
        let window = app.get_webview_window("main").unwrap();
        let attempt = BrowserSignIn::new(
            NativeAuthentication::new("https://127.0.0.1").unwrap(),
            BrowserProvider::GitLab,
        );
        let url = attempt.browser_url();
        if macos::check_anchor(&window, &url).is_err() {
            eprintln!("AuthenticationServices did not return the application's own window.");
            app.exit(1);
        } else if show {
            tauri::async_runtime::spawn(check_started(window, url));
        } else {
            println!("UMMKA_WEBVIEW_CHECK browser-anchor");
            app.exit(0);
        }
    });
}

async fn check_started(window: WebviewWindow, url: reqwest::Url) {
    let check = async {
        let (_owner, received) = begin(&window, url.clone(), |_| Ok(())).await?;
        if !matches!(
            begin(&window, url, |_| Ok(())).await,
            Err(PresentationError::Busy)
        ) {
            return Err(PresentationError::Unavailable);
        }
        owner_closed(window.app_handle());
        match received.await {
            Ok(Err(PresentationError::Cancelled)) => Ok(()),
            _ => Err(PresentationError::Unavailable),
        }
    }
    .await;
    if check.is_ok() {
        println!("UMMKA_WEBVIEW_CHECK browser-started");
    } else {
        eprintln!("The system browser session failed its start and cancellation check.");
    }
    window.app_handle().exit(i32::from(check.is_err()));
}
