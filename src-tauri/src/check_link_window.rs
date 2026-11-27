use dispatch2::DispatchQueue;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSWindow, NSWindowOcclusionState};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{Runtime, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Clone, Copy)]
enum Mode {
    Hidden,
    Minimized,
}

impl Mode {
    fn for_scenario(scenario: &str) -> Option<Self> {
        match scenario {
            "system-post-hidden" => Some(Self::Hidden),
            "system-post-minimized" => Some(Self::Minimized),
            _ => None,
        }
    }

    fn reached(&self, state: &Observation) -> bool {
        !state.key
            && !state.visible
            && !state.onscreen
            && match self {
                Self::Hidden => state.hidden && !state.active && !state.minimized,
                Self::Minimized => !state.hidden && state.minimized,
            }
    }
}

pub(crate) fn enabled(scenario: &str) -> bool {
    Mode::for_scenario(scenario).is_some()
}

#[derive(Debug, Serialize)]
pub(crate) struct Observation {
    number: isize,
    active: bool,
    hidden: bool,
    minimized: bool,
    visible: bool,
    onscreen: bool,
    key: bool,
}

impl Observation {
    fn read(app: &NSApplication, window: &NSWindow) -> Self {
        Self {
            number: window.windowNumber(),
            active: app.isActive(),
            hidden: app.isHidden(),
            minimized: window.isMiniaturized(),
            visible: window.isVisible(),
            onscreen: window
                .occlusionState()
                .contains(NSWindowOcclusionState::Visible),
            key: window.isKeyWindow(),
        }
    }

    fn presented(&self) -> bool {
        self.number > 0
            && self.active
            && !self.hidden
            && !self.minimized
            && self.visible
            && self.onscreen
            && self.key
    }
}

async fn on_main<R: Runtime, T: Send + 'static>(
    window: WebviewWindow<R>,
    read: impl FnOnce(&NSApplication, &NSWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (result, receive) = oneshot::channel();
    DispatchQueue::main().exec_async(move || {
        let observed = window
            .ns_window()
            .map_err(|error| error.to_string())
            .and_then(|native| {
                // The captured Tauri window owns this NSWindow and this callback runs on AppKit's queue.
                let native = unsafe { &*native.cast::<NSWindow>() };
                let main =
                    MainThreadMarker::new().expect("observe link fixture on the main thread");
                read(&NSApplication::sharedApplication(main), native)
            });
        let _ = result.send(observed);
    });
    receive.await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn check_system_post_window<R: Runtime>(
    window: WebviewWindow<R>,
    prepare: bool,
) -> Result<Observation, String> {
    let scenario = std::env::var("UMMKA_CHECK_SCENARIO").unwrap_or_default();
    let mode = Mode::for_scenario(&scenario).ok_or("not a system link window fixture")?;
    if window.label() != "main" {
        return Err("not the fixture's main window".into());
    }
    if !prepare {
        return on_main(window, |app, window| {
            let state = Observation::read(app, window);
            if state.presented() {
                println!(
                    "UMMKA_LINK_WINDOW presented {} {state:?}",
                    std::process::id()
                );
            }
            Ok(state)
        })
        .await;
    }
    let initial = on_main(window.clone(), move |app, window| {
        let state = Observation::read(app, window);
        println!("UMMKA_LINK_WINDOW initial {} {state:?}", std::process::id());
        if !state.presented() {
            return Err(format!("window must start visible and focused: {state:?}"));
        }
        match mode {
            Mode::Hidden => app.hide(None),
            Mode::Minimized => window.miniaturize(None),
        }
        Ok(state)
    })
    .await?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let state = on_main(window.clone(), |app, window| {
            Ok(Observation::read(app, window))
        })
        .await?;
        if mode.reached(&state) {
            println!(
                "UMMKA_LINK_WINDOW prepared {} {state:?}",
                std::process::id()
            );
            return Ok(initial);
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{scenario} did not reach its AppKit state: {state:?}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
