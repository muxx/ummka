//! Runs in the disposable Android HTTP-check package and emulator only.
use super::{Owner, PRESENTATION, PresentationError, Returned, begin};
use jni::{
    EnvUnowned,
    errors::ThrowRuntimeExAndDefault,
    jni_mangle,
    objects::{JObject, JString},
};
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::sync::Notify;
use uuid::Uuid;

static RECREATION_LAUNCHES: AtomicU32 = AtomicU32::new(0);
static OLD_PROVIDER_READY: Notify = Notify::const_new();
static OLD_RECEIVER_FINISHED: Notify = Notify::const_new();

#[jni_mangle("io.github.muxx.ummka.dev.BrowserLifecycleProbe")]
pub fn native_event(_env: EnvUnowned<'_>, _: JObject<'_>, code: i32) {
    match code {
        1 => {
            RECREATION_LAUNCHES.fetch_add(1, Ordering::SeqCst);
        }
        2 => OLD_PROVIDER_READY.notify_one(),
        3 => OLD_RECEIVER_FINISHED.notify_one(),
        _ => {}
    }
}

#[jni_mangle("io.github.muxx.ummka.dev.BrowserLifecycleProbe")]
pub fn native_has_other_waiting<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    id: JString<'local>,
) -> bool {
    env.with_env(|env| {
        let old = Uuid::try_parse(&id.try_to_string(env)?).ok();
        Ok::<_, jni::errors::Error>(
            old.is_some()
                && PRESENTATION
                    .waiting()
                    .is_some_and(|current| Some(current) != old),
        )
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}

use std::time::Duration;
use tauri::{Manager, Runtime, Webview, WebviewWindow};

pub(crate) fn run<R: Runtime>(view: &Webview<R>) {
    let Some(window) = view.app_handle().get_webview_window("main") else {
        println!("UMMKA_WEBVIEW_CHECK FAIL missing browser owner");
        return;
    };
    tauri::async_runtime::spawn(async move {
        let check = async {
            let returned = request(&window, "return").await;
            if returned.as_deref() != Ok("io.github.muxx.ummka.auth://callback?fixture=returned") {
                return Err("return");
            }
            if request(&window, "recreate").await.as_deref()
                != Ok("io.github.muxx.ummka.auth://callback?fixture=recreated")
            {
                return Err("recreated Activity result");
            }
            if !late_result(&window).await {
                return Err("late Activity result");
            }
            if RECREATION_LAUNCHES.load(Ordering::SeqCst) != 1 {
                return Err("recreated Activity launched another provider");
            }
            if request(&window, "cancel").await != Err(PresentationError::Cancelled) {
                return Err("cancel");
            }
            if request(&window, "return").await != Err(PresentationError::Unsupported) {
                return Err("unsupported");
            }
            Ok(())
        };
        match tokio::time::timeout(Duration::from_secs(30), check).await {
            Ok(Ok(())) => println!("UMMKA_WEBVIEW_CHECK browser-checked"),
            Ok(Err(stage)) => println!("UMMKA_WEBVIEW_CHECK FAIL browser {stage}"),
            Err(_) => println!("UMMKA_WEBVIEW_CHECK FAIL browser timeout"),
        }
    });
}

fn address(action: &str) -> reqwest::Url {
    reqwest::Url::parse(&format!("https://127.0.0.1/ummka-browser-check/{action}"))
        .expect("fixed Android check URL")
}

async fn late_result<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Ok((old, old_result)) = begin(window, address("late")).await else {
        return false;
    };
    OLD_PROVIDER_READY.notified().await;
    // Leave the old OS receiver alive deliberately. Its actual Activity Result must traverse
    // Kotlin and JNI after another native request has acquired the slot.
    PRESENTATION.deliver(old.id, Err(PresentationError::Cancelled));
    if old_result.await != Ok(Err(PresentationError::Cancelled)) {
        return false;
    }
    drop(old);
    let Ok((id, mut result)) = PRESENTATION.reserve() else {
        return false;
    };
    let _owner = Owner {
        app: window.app_handle().clone(),
        id,
    };
    OLD_RECEIVER_FINISHED.notified().await;
    if PRESENTATION.waiting() != Some(id)
        || result.try_recv() != Err(tokio::sync::oneshot::error::TryRecvError::Empty)
    {
        return false;
    }
    if super::open(window, id, address("return")).await.is_err() {
        return false;
    }
    matches!(result.await, Ok(Ok(url)) if url == "io.github.muxx.ummka.auth://callback?fixture=returned")
}

async fn request<R: Runtime>(window: &WebviewWindow<R>, action: &str) -> Returned {
    let url = address(action);
    let (_owner, received) = begin(window, url).await?;
    received.await.map_err(|_| PresentationError::Unavailable)?
}
