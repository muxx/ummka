// The main test window keeps the process alive while the test closes a second window.
use super::{exchange::ExchangeError, open_rest_connection, open_transport, session, watch_window};
use crate::rest::RestConnection;
use reqwest::{Method, Request, StatusCode};
use tauri::{Manager, Runtime, Webview, WebviewUrl, WebviewWindowBuilder};

pub(super) fn run<R: Runtime>(main: &Webview<R>) {
    let app = main.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let result = check(&app).await;
        println!(
            "UMMKA_WEBVIEW_CHECK {}",
            if result.is_ok() { "PASS" } else { "FAIL" }
        );
        if let Err(error) = result {
            eprintln!("Window destruction check stopped at {error}");
        }
        app.exit(i32::from(result.is_err()));
    });
}

async fn check<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), &'static str> {
    let ports = std::env::var("UMMKA_WEBVIEW_CHECK_PORTS").map_err(|_| "server ports")?;
    let mut ports = ports.split(',');
    let base = format!(
        "https://127.0.0.1:{}/team/chat",
        ports.next().ok_or("data port")?
    );
    let control_base = format!("https://127.0.0.1:{}", ports.next().ok_or("control port")?);
    let control = open_transport(&control_base).map_err(|_| "control connection")?;
    let window = WebviewWindowBuilder::new(
        app,
        "window-lifetime-check",
        WebviewUrl::App("ipc-result.html".into()),
    )
    .visible(false)
    .build()
    .map_err(|_| "test window")?;
    let owner: &Webview<R> = window.as_ref();
    watch_window(owner);
    let connection = open_rest_connection(owner.clone(), base.clone(), None)
        .await
        .map_err(|_| "open")?;
    let pending = session(owner, connection).map_err(|_| "connection")?;
    let id = pending.prepare().map_err(|_| "prepare")?;
    let task = tauri::async_runtime::spawn(async move {
        pending
            .send(
                id,
                "GET",
                &format!("{base}/api/v4/system/ping?check=window"),
                vec![],
                None,
            )
            .await
    });
    observe(&control, &control_base, "received").await?;
    window.destroy().map_err(|_| "destroy")?;
    if !matches!(task.await, Ok(Err(ExchangeError::Cancelled))) {
        return Err("active exchange survived");
    }
    if session(owner, connection).is_ok() {
        return Err("connection still registered");
    }
    observe(&control, &control_base, "closed").await
}

async fn observe(control: &RestConnection, base: &str, step: &str) -> Result<(), &'static str> {
    let url = format!("{base}/api/v4/system/ping?step={step}&case=window")
        .parse()
        .map_err(|_| "control URL")?;
    let response = control
        .send(Request::new(Method::GET, url))
        .await
        .map_err(|_| "control GET")?;
    if response.status() == StatusCode::NO_CONTENT {
        Ok(())
    } else {
        Err("control status")
    }
}
