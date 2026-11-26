use std::io::{self, BufRead};
use tauri::{Runtime, WebviewWindow};

/// The disposable WKWebView accepts keyboard input only from its test parent's stdin.
pub(crate) fn listen<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            if line != "right" {
                break;
            }
            // WebKit scrolls while the key is down. Deliver both physical phases on
            // separate UI turns, holding the key for an ordinary keyboard press.
            for down in [true, false] {
                window
                    .with_webview(move |view| {
                        use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSWindow};
                        use objc2_foundation::{NSPoint, NSProcessInfo, ns_string};
                        // Tauri owns the window. with_webview runs on the UI thread.
                        let window = unsafe { &*view.ns_window().cast::<NSWindow>() };
                        let kind = if down { NSEventType::KeyDown } else { NSEventType::KeyUp };
                        let key = ns_string!("\u{f703}");
                        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                            kind, NSPoint::ZERO, NSEventModifierFlags::empty(), NSProcessInfo::processInfo().systemUptime(),
                            window.windowNumber(), None, key, key, false, 124,
                        ).expect("create fixture Right Arrow event");
                        window.sendEvent(&event);
                    })
                    .expect("deliver fixture Right Arrow to its window");
                if down {
                    std::thread::sleep(std::time::Duration::from_millis(160));
                }
            }
        }
    });
}
