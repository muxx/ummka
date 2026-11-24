use super::*;
use crate::ipc_test::{LOCAL, invoke, sibling};
use serde_json::{Value, json};
use tauri::{Manager, Url, WebviewWindowBuilder, test::mock_builder};

#[cfg(target_os = "macos")]
#[test]
fn platform_delivery_before_and_after_the_main_view_emits_only_a_wakeup() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tauri::Listener;
    let app = crate::build(mock_builder(), crate::context()).unwrap();
    let link = Url::parse("https://chat.example.test/prefix/team/channels/town-square").unwrap();
    let deliver = |urls| receive(app.handle(), RunEvent::Opened { urls });
    deliver(vec![link.clone()]);
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let wakeups = Arc::new(AtomicUsize::new(0));
    main.listen("channels-link-available", {
        let wakeups = Arc::clone(&wakeups);
        move |event| {
            assert_eq!(event.payload(), "null");
            wakeups.fetch_add(1, Ordering::SeqCst);
        }
    });
    sibling(main).listen("channels-link-available", |_| {
        panic!("unexpected sibling event")
    });
    deliver(vec![
        Url::parse("https://chat.example.test/oauth?code=private").unwrap(),
    ]);
    assert_eq!(wakeups.load(Ordering::SeqCst), 0);
    deliver(vec![link.clone(), link]);
    assert_eq!(wakeups.load(Ordering::SeqCst), 1);
    assert_eq!(
        app.state::<ChannelsLinks>().0.lock().unwrap().links.len(),
        3
    );
}

#[test]
fn receives_only_https_paths_and_bounds_pending_memory() {
    let inbox = ChannelsLinks::default();
    for href in [
        "http://chat.test/team/channels/town-square",
        "https://chat.test",
        "https://user:pass@chat.test/team",
        "https://chat.test/oauth?code=private",
        "https://chat.test/team#fragment",
        "https://chat.test/team/%00",
        "file:///tmp/link",
        "mattermost://chat.test/team",
    ] {
        assert_eq!(inbox.offer(&Url::parse(href).unwrap()), Ok(false));
    }
    let max = format!(
        "https://chat.test/{}",
        "x".repeat(8192 - "https://chat.test/".len())
    );
    assert_eq!(
        inbox.offer(&Url::parse(&(max.clone() + "x")).unwrap()),
        Ok(false)
    );
    let url = Url::parse(&max).unwrap();
    for _ in 0..32 {
        assert_eq!(inbox.offer(&url), Ok(true));
    }
    assert_eq!(inbox.offer(&url), Err(()));
    let state = inbox.0.lock().unwrap();
    assert_eq!(state.links.len(), 32);
    assert_eq!(state.links.front().unwrap().id, "1");
    assert_eq!(state.links.back().unwrap().id, "32");
}

#[test]
fn only_local_main_can_inspect_or_acknowledge_the_first_delivery() {
    let app = crate::build(mock_builder(), crate::context()).unwrap();
    let inbox = app.state::<ChannelsLinks>();
    let url = Url::parse("https://[::1]:8443/Login%20Site/team/channels/town-square").unwrap();
    assert_eq!(inbox.offer(&url), Ok(true));
    assert_eq!(inbox.offer(&url), Ok(true));
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let other = sibling(main);
    for (view, origin) in [(main, "https://other.example.test/"), (&other, LOCAL)] {
        for command in ["pending_channels_link", "acknowledge_channels_link"] {
            assert!(
                invoke(view, command, origin, json!({"id":"1"}))
                    .unwrap_err()
                    .to_string()
                    .contains("not allowed")
            );
        }
    }
    let head = || {
        invoke(main, "pending_channels_link", LOCAL, json!({}))
            .unwrap()
            .deserialize::<Value>()
            .unwrap()
    };
    let ack = |id: &str| {
        invoke(
            main,
            "acknowledge_channels_link",
            LOCAL,
            json!({ "id": id }),
        )
        .unwrap()
        .deserialize::<bool>()
        .unwrap()
    };
    let first = head();
    assert_eq!(first["href"], url.as_str());
    assert_eq!(head(), first);
    assert!(!ack("2"));
    assert!(ack(first["id"].as_str().unwrap()));
    assert!(!ack(first["id"].as_str().unwrap()));
    assert_eq!(head(), json!({"id":"2","href":url.as_str()}));
    assert!(ack("2"));
    assert_eq!(head(), Value::Null);
    assert!(!ack("2"));
}
