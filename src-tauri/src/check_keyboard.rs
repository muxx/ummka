use std::io::{self, BufRead};
use tauri::{Runtime, WebviewWindow};

/// The disposable WKWebView accepts keyboard input only from its test parent's stdin.
pub(crate) fn listen<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            let key_code = match line.as_str() {
                "right" => 124,
                "escape" => 53,
                _ => break,
            };
            // WebKit scrolls while the key is down. Deliver both physical phases on
            // separate UI turns, holding the key for an ordinary keyboard press.
            for down in [true, false] {
                let (sent, dispatched) = std::sync::mpsc::channel();
                window
                    .with_webview(move |view| {
                        use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSResponder, NSWindow};
                        use objc2_foundation::{NSPoint, NSProcessInfo, ns_string};
                        // Tauri owns the window. with_webview runs on the UI thread.
                        let window = unsafe { &*view.ns_window().cast::<NSWindow>() };
                        let webview = unsafe { &*view.inner().cast::<NSResponder>() };
                        if down {
                            // DOM focus can survive a reload without the WKWebView owning native input.
                            // Wry's WebView::focus uses this same AppKit first-responder operation.
                            assert!(window.makeFirstResponder(Some(webview)), "focus the keyboard fixture WebView");
                        }
                        let kind = if down { NSEventType::KeyDown } else { NSEventType::KeyUp };
                        let key = if key_code == 124 { ns_string!("\u{f703}") } else { ns_string!("\u{1b}") };
                        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                            kind, NSPoint::ZERO, NSEventModifierFlags::empty(), NSProcessInfo::processInfo().systemUptime(),
                            window.windowNumber(), None, key, key, false, key_code,
                        ).expect("create fixture keyboard input event");
                        // Deliver the AppKit event to this test WebView, even when
                        // the runner's window server has a different key window.
                        if down {
                            webview.keyDown(&event);
                        } else {
                            webview.keyUp(&event);
                        }
                        let _ = sent.send(());
                    })
                    .expect("deliver fixture keyboard input to its window");
                // with_webview enqueues work. Start the hold only after AppKit received keyDown.
                if dispatched.recv().is_err() {
                    return;
                }
                if down && key_code == 124 {
                    std::thread::sleep(std::time::Duration::from_millis(160));
                }
            }
            println!("UMMKA_KEY_DISPATCHED {line}");
        }
    });
}
