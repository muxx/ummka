// The main test window keeps the process alive while the test closes a second window.
use super::{exchange::ExchangeError, open_rest_connection, open_transport, session, watch_window};
use crate::{device_document::SelectedDocument, draft_files};
use objc2_foundation::NSURL;
use reqwest::{Method, Request, StatusCode};
use std::{future::ready, sync::Arc, time::Duration};
use tauri::{Manager, Runtime, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::Notify;

fn stage(name: &str) {
    println!("UMMKA_WEBVIEW_STEP started window-lifetime-{name}");
}

pub(super) fn run<R: Runtime>(main: &Webview<R>) {
    let app = main.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let result = check(&app).await;
        println!(
            "UMMKA_WEBVIEW_CHECK {}",
            if result.is_ok() { "PASS" } else { "FAIL" }
        );
        if let Err(error) = &result {
            eprintln!("Window destruction check stopped at {error}");
        }
        stage("exit-app");
        app.exit(i32::from(result.is_err()));
    });
}

async fn check<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let ports = std::env::var("UMMKA_WEBVIEW_CHECK_PORTS").map_err(|_| "server ports")?;
    let mut ports = ports.split(',');
    let base = format!(
        "https://127.0.0.1:{}/team/chat",
        ports.next().ok_or("data port")?
    );
    let control_base = format!("https://127.0.0.1:{}", ports.next().ok_or("control port")?);
    stage("create-window");
    // This fixture owns only native resources. Leave WKWebView at its initial
    // blank document so navigation cannot retire those resources before destroy.
    let window = WebviewWindowBuilder::new(
        app,
        "window-lifetime-check",
        WebviewUrl::External("about:blank".parse().expect("blank fixture URL")),
    )
    .on_navigation(|_| false)
    .visible(false)
    .build()
    .map_err(|_| "test window")?;
    let owner: &Webview<R> = window.as_ref();
    watch_window(owner);
    let destroyed = Arc::new(Notify::new());
    let event = destroyed.clone();
    window.on_window_event(move |kind| {
        if matches!(kind, WindowEvent::Destroyed) {
            event.notify_one();
        }
    });
    stage("attach-draft-source");
    let signed = draft_files::fixture_connection(owner).await?;
    let workspace = draft_files::open(owner, signed).map_err(|_| "workspace")?;
    let draft = draft_files::DraftAddress::new("c".repeat(26), None).map_err(|_| "draft")?;
    let fixture_path = std::env::current_exe().map_err(|_| "fixture path")?;
    let selection = SelectedDocument::from_panel_url(
        NSURL::from_file_path(&fixture_path).ok_or("fixture URL")?,
    )
    .await
    .map_err(|_| "draft source")?;
    let retained = Arc::downgrade(&selection);
    let selected = draft_files::add(
        owner,
        signed,
        workspace,
        &draft,
        u64::MAX,
        [ready(Ok(selection))],
    )
    .await
    .map_err(|_| "attach draft source")?;
    if !matches!(selected.as_slice(), [draft_files::AddResult::Added(_)]) {
        return Err("draft source was not attached".into());
    }
    stage("start-exchange");
    let connection = open_rest_connection(owner.clone(), base.clone(), None)
        .await
        .map_err(|_| "open")?;
    let pending = session(owner, connection).map_err(|_| "connection")?;
    let id = pending.prepare().map_err(|_| "prepare")?;
    let lifetime = pending.lifetime.clone();
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
    stage("read-first-receipt");
    observe(&control_base, "received").await?;
    if lifetime.is_cancelled() {
        return Err("exchange was cancelled before destroy".into());
    }
    stage("queue-destroy");
    window.destroy().map_err(|_| "destroy")?;
    stage("wait-destroyed");
    destroyed.notified().await;
    stage("wait-exchange-cancel");
    if !matches!(task.await, Ok(Err(ExchangeError::Cancelled))) {
        return Err("active exchange survived".into());
    }
    stage("check-rest-owner");
    if session(owner, connection).is_ok() {
        return Err("connection still registered".into());
    }
    stage("check-draft-owner");
    if draft_files::list(owner, signed, workspace, &draft).is_ok() {
        return Err("draft workspace survived window destruction".into());
    }
    stage("wait-source-release");
    tokio::time::timeout(Duration::from_secs(1), async {
        while retained.upgrade().is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .map_err(|_| "draft source retained after window destruction")?;
    stage("read-closed-receipt");
    observe(&control_base, "closed").await
}

async fn observe(base: &str, step: &str) -> Result<(), String> {
    // Each receipt is a separate barrier around window destruction. Its
    // transport must not depend on the socket used for the previous receipt.
    let control = open_transport(base)
        .map_err(|error| format!("{step}(window) control connection: {error}"))?;
    let url = format!("{base}/api/v4/system/ping?step={step}&case=window")
        .parse()
        .map_err(|error| format!("{step}(window) control URL: {error}"))?;
    let response = control
        .send(Request::new(Method::GET, url))
        .await
        .map_err(|error| format!("{step}(window) control GET: {error}"))?;
    if response.status() == StatusCode::NO_CONTENT {
        Ok(())
    } else {
        Err(format!(
            "{step}(window) control status: {}",
            response.status()
        ))
    }
}
