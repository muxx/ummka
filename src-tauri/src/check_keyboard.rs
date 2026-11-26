use std::io::{self, BufRead};
use tauri::{Runtime, WebviewWindow};

/// The disposable WKWebView accepts keyboard input only from its test parent's stdin.
pub(crate) fn listen<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            if line != "escape" {
                break;
            }
            window
                .with_webview(|view| {
                    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSWindow};
                    use objc2_foundation::{NSPoint, ns_string};
                    // Tauri owns the window. with_webview runs on the UI thread.
                    let window = unsafe { &*view.ns_window().cast::<NSWindow>() };
                    for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
                        let key = ns_string!("\u{1b}");
                        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                            kind, NSPoint::ZERO, NSEventModifierFlags::empty(), 0.0,
                            window.windowNumber(), None, key, key, false, 53,
                        ).expect("create fixture Escape event");
                        window.sendEvent(&event);
                    }
                })
                .expect("deliver fixture Escape to its window");
        }
    });
}
