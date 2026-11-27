use dispatch2::{DispatchQueue, MainThreadBound};
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{
    NSEvent, NSEventModifierFlags, NSEventType, NSResponder, NSWindow, NSWindowOcclusionState,
};
use objc2_foundation::{NSInteger, NSPoint, NSProcessInfo, ns_string};
use std::{
    io::{self, BufRead},
    sync::{Arc, mpsc},
};
use tauri::webview::PlatformWebview;

/// The disposable WKWebView accepts keyboard input only from its test parent's stdin.
pub(crate) fn listen(view: PlatformWebview) {
    let main_thread = MainThreadMarker::new().expect("capture keyboard fixture on the main thread");
    // Setup supplies the window and responder for this disposable fixture.
    let window = unsafe { Retained::retain(view.ns_window().cast::<NSWindow>()) }
        .expect("get the fixture's NSWindow");
    let webview = unsafe { Retained::retain(view.inner().cast::<NSResponder>()) }
        .expect("get the fixture's WKWebView");
    let target = Arc::new(MainThreadBound::new((window, webview), main_thread));
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            let (key_code, kind) = match line.as_str() {
                "right-down" => (124, NSEventType::KeyDown),
                "right-up" => (124, NSEventType::KeyUp),
                "escape" => (53, NSEventType::KeyDown),
                _ => break,
            };
            println!("UMMKA_KEY_PHASE {line} queued");
            let (sent, dispatched) = mpsc::channel();
            let target = Arc::clone(&target);
            // Tao drains proxy messages before the run loop waits. Dispatch the
            // fixture's native input without depending on that observer.
            DispatchQueue::main().exec_async(move || {
                let main_thread =
                    MainThreadMarker::new().expect("deliver fixture keys on the main thread");
                let (window, webview) = target.get(main_thread);
                let window_number = window.windowNumber();
                if kind == NSEventType::KeyUp {
                    key_up(webview, window_number, key_code);
                    let _ = sent.send(());
                    return;
                }
                println!("UMMKA_KEY_PHASE keydown-started");
                // DOM focus can survive a reload without the WKWebView owning native input.
                assert!(
                    window.makeFirstResponder(Some(webview)),
                    "focus the keyboard fixture WebView"
                );
                println!(
                    "UMMKA_KEY_WINDOW visible={} key={} unobscured={}",
                    window.isVisible(),
                    window.isKeyWindow(),
                    window
                        .occlusionState()
                        .contains(NSWindowOcclusionState::Visible),
                );
                webview.keyDown(&key_event(NSEventType::KeyDown, window_number, key_code));
                println!("UMMKA_KEY_PHASE keydown-returned");

                // The browser acknowledges arrow scrolling before asking for the release.
                if key_code == 124 {
                    let _ = sent.send(());
                    return;
                }

                // Keep Escape's release in a separate main queue dispatch.
                println!("UMMKA_KEY_PHASE keyup-scheduled");
                DispatchQueue::main().exec_async(move || {
                    let main_thread =
                        MainThreadMarker::new().expect("release fixture key on the main thread");
                    let (_, webview) = target.get(main_thread);
                    key_up(webview, window_number, key_code);
                    let _ = sent.send(());
                });
            });
            if dispatched.recv().is_err() {
                return;
            }
            println!("UMMKA_KEY_DISPATCHED {line}");
        }
    });
}

fn key_up(webview: &NSResponder, window_number: NSInteger, key_code: u16) {
    println!("UMMKA_KEY_PHASE keyup-started");
    webview.keyUp(&key_event(NSEventType::KeyUp, window_number, key_code));
    println!("UMMKA_KEY_PHASE keyup-returned");
}

fn key_event(kind: NSEventType, window_number: NSInteger, key_code: u16) -> Retained<NSEvent> {
    // Deliver to the fixture's WKWebView even if its NSWindow is not the key window.
    let key = if key_code == 124 {
        ns_string!("\u{f703}")
    } else {
        ns_string!("\u{1b}")
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
