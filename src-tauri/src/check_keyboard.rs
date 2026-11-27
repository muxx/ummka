use dispatch2::{DispatchQueue, DispatchTime, MainThreadBound};
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSResponder, NSWindow};
use objc2_foundation::{NSInteger, NSPoint, NSProcessInfo, ns_string};
use std::{
    io::{self, BufRead},
    time::Duration,
};
use tauri::{Runtime, WebviewWindow};

/// The disposable WKWebView accepts keyboard input only from its test parent's stdin.
pub(crate) fn listen<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            let (key_code, hold) = match line.as_str() {
                "right" => (124, Duration::from_millis(160)),
                "escape" => (53, Duration::ZERO),
                "enter" => (36, Duration::ZERO),
                _ => break,
            };
            println!("UMMKA_KEY_PHASE {line} received");
            println!("UMMKA_KEY_PHASE {line} keydown-queued");
            let (sent, dispatched) = std::sync::mpsc::channel();
            window
                .with_webview(move |view| {
                    let main_thread =
                        MainThreadMarker::new().expect("deliver fixture keys on the main thread");
                    // Tauri supplies live native objects on the AppKit thread.
                    // The asynchronous release keeps its own reference to the same WKWebView.
                    let window = unsafe { &*view.ns_window().cast::<NSWindow>() };
                    let webview = unsafe { Retained::retain(view.inner().cast::<NSResponder>()) }
                        .expect("get the fixture's WKWebView");
                    let window_number = window.windowNumber();
                    println!("UMMKA_KEY_PHASE keydown-started");
                    // DOM focus can survive a reload without the WKWebView owning native input.
                    assert!(
                        window.makeFirstResponder(Some(&webview)),
                        "focus the keyboard fixture WebView"
                    );
                    webview.keyDown(&key_event(NSEventType::KeyDown, window_number, key_code));
                    println!("UMMKA_KEY_PHASE keydown-returned");

                    // WebKit scrolls while the key is held. Let AppKit keep running and
                    // deliver the release without another Tauri user event.
                    let webview = MainThreadBound::new(webview, main_thread);
                    let release_at =
                        DispatchTime::try_from(hold).expect("schedule fixture key release");
                    println!("UMMKA_KEY_PHASE keyup-scheduled");
                    DispatchQueue::main()
                        .after(release_at, move || {
                            let main_thread = MainThreadMarker::new()
                                .expect("release fixture key on the main thread");
                            let webview = webview.into_inner(main_thread);
                            println!("UMMKA_KEY_PHASE keyup-started");
                            webview.keyUp(&key_event(NSEventType::KeyUp, window_number, key_code));
                            println!("UMMKA_KEY_PHASE keyup-returned");
                            let _ = sent.send(());
                        })
                        .expect("deliver fixture key release");
                })
                .expect("deliver fixture keyboard input to its window");
            if dispatched.recv().is_err() {
                return;
            }
            println!("UMMKA_KEY_DISPATCHED {line}");
        }
    });
}

fn key_event(kind: NSEventType, window_number: NSInteger, key_code: u16) -> Retained<NSEvent> {
    // Deliver to the fixture's WKWebView even if its NSWindow is not the key window.
    let key = match key_code {
        124 => ns_string!("\u{f703}"),
        53 => ns_string!("\u{1b}"),
        36 => ns_string!("\r"),
        _ => unreachable!("invalid fixture key"),
    };
    NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
        kind,
        NSPoint::ZERO,
        NSEventModifierFlags::empty(),
        NSProcessInfo::processInfo().systemUptime(),
        window_number,
        None,
        key,
        key,
        false,
        key_code,
    )
    .expect("create fixture keyboard input event")
}
