use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};
use tauri::{AppHandle, RunEvent, Runtime, State};

#[derive(Clone, Serialize)]
pub(crate) struct Delivery {
    id: String,
    href: String,
}

#[derive(Default)]
struct Pending {
    links: VecDeque<Delivery>,
    #[cfg(any(test, target_os = "android", target_os = "macos", target_os = "ios"))]
    last_id: u64,
}

#[derive(Default)]
pub(crate) struct ChannelsLinks(Mutex<Pending>);

#[cfg(any(test, target_os = "android", target_os = "macos", target_os = "ios"))]
impl ChannelsLinks {
    /// Accept only the address itself. Authentication callbacks with parameters never reach the view.
    fn offer(&self, url: &tauri::Url) -> Result<bool, ()> {
        let href = url.as_str();
        if url.scheme() != "https"
            || !url.has_host()
            || url.path() == "/"
            || crate::installation_url::has_credentials(url)
            || url.query().is_some()
            || url.fragment().is_some()
            || href.contains("%00")
            || href.len() > 8192
        {
            return Ok(false);
        }
        let mut state = self.0.lock().expect("link inbox poisoned");
        if state.links.len() == 32 {
            return Err(());
        }
        state.last_id = state.last_id.checked_add(1).ok_or(())?;
        let id = state.last_id.to_string();
        state.links.push_back(Delivery {
            id,
            href: href.into(),
        });
        Ok(true)
    }
}

pub(crate) fn receive<R: Runtime>(_app: &AppHandle<R>, _event: RunEvent) {
    #[cfg(any(target_os = "android", target_os = "macos", target_os = "ios"))]
    if let RunEvent::Opened { urls } = _event {
        use tauri::{Emitter, EventTarget, Manager};

        let inbox = _app.state::<ChannelsLinks>();
        let mut accepted = false;
        for url in urls {
            match inbox.offer(&url) {
                Ok(added) => accepted |= added,
                Err(()) => eprintln!("The external link inbox is full."),
            }
        }
        if accepted {
            // The destination may still be starting. Reading the head on subscription covers this case.
            let _ = _app.emit_to(EventTarget::webview("main"), "channels-link-available", ());
        }
    }
}

#[tauri::command]
pub(crate) fn pending_channels_link(inbox: State<'_, ChannelsLinks>) -> Option<Delivery> {
    inbox
        .0
        .lock()
        .expect("link inbox poisoned")
        .links
        .front()
        .cloned()
}

#[tauri::command]
pub(crate) fn acknowledge_channels_link(inbox: State<'_, ChannelsLinks>, id: String) -> bool {
    let mut state = inbox.0.lock().expect("link inbox poisoned");
    if state.links.front().is_some_and(|link| link.id == id) {
        state.links.pop_front();
        true
    } else {
        false
    }
}

#[cfg(all(test, desktop))]
mod tests;
