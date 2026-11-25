use super::*;
use crate::ipc_test::{LOCAL, invoke, sibling};
use serde_json::{Value, json};
use tauri::WebviewWindowBuilder;
use tauri::test::{MockRuntime, mock_builder};

const SERVER: &str = "https://chat.example.test";

fn open(view: &Webview<MockRuntime>, base: &str) -> ResourceId {
    invoke(
        view,
        "open_rest_connection",
        LOCAL,
        json!({"basePath": base}),
    )
    .unwrap()
    .deserialize()
    .unwrap()
}

fn close(view: &Webview<MockRuntime>, rid: ResourceId) -> Result<(), Value> {
    invoke(view, "close_rest_connection", LOCAL, json!({"rid": rid})).map(drop)
}

struct Marker;
impl Resource for Marker {}

#[test]
fn only_the_local_main_webview_can_manage_its_own_connections() {
    let app = crate::build(mock_builder(), crate::context()).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let sibling = sibling(main);
    assert_eq!(main.window().label(), sibling.window().label());
    for (view, origin) in [(&sibling, LOCAL), (main, "https://remote.example.test/")] {
        for (command, body) in [
            ("open_rest_connection", json!({"basePath": SERVER})),
            ("get_current_account_id", json!({"serverUrl":SERVER})),
            ("list_account_ids", json!({"serverUrl":SERVER})),
            (
                "forget_local_account",
                json!({"serverUrl":SERVER,"userId":"Abc01234567890123456789012"}),
            ),
            ("sign_out_account", json!({"rid": 0})),
            ("sign_out_on_device", json!({"rid": 0})),
            (
                "begin_channel_history_load",
                json!({"rid":0,"channelId":"c".repeat(26)}),
            ),
            (
                "store_channel_history_page",
                json!({"rid":0,"load":0,"page":null}),
            ),
            ("cancel_channel_history_load", json!({"rid":0,"load":0})),
            ("read_joined_teams", json!({"rid":0})),
            ("select_joined_team", json!({"rid":0, "teamId":"x"})),
            ("begin_team_directory_load", json!({"rid":0})),
            ("store_team_directory", json!({"rid":0,"load":0,"teams":[]})),
            ("cancel_team_directory_load", json!({"rid":0,"load":0})),
            (
                "read_saved_profiles",
                json!({"rid":0,"query":{"ids":[],"usernames":[]}}),
            ),
            ("store_channel_profiles", json!({"rid":0,"profiles":[]})),
            ("read_team_sidebar", json!({"rid":0,"teamId":"x"})),
            (
                "select_sidebar_channel",
                json!({"rid":0,"teamId":"x","channelId":"y"}),
            ),
            ("begin_sidebar_load", json!({"rid":0,"teamId":"x"})),
            ("store_team_sidebar", json!({"rid":0,"load":1,"data":{}})),
            ("cancel_sidebar_load", json!({"rid":0,"load":1})),
            (
                "read_channel_window",
                json!({"rid":0,"query":{"kind":"latest","channelId":"c".repeat(26),"collapsedThreads":false,"limit":1}}),
            ),
            ("close_rest_connection", json!({"rid": 0})),
            ("prepare_rest_request", json!({"connection": 0})),
            (
                "send_rest_request",
                json!({"connection": 0, "exchange": 0, "method":"GET","url":SERVER,"headers":[]}),
            ),
            ("read_rest_body", json!({"connection": 0, "exchange": 0})),
            (
                "cancel_rest_request",
                json!({"connection": 0, "exchange": 0}),
            ),
        ] {
            let error = invoke(view, command, origin, body).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"), "{error}");
        }
        assert_eq!(view.resources_table().names().count(), 0);
    }
    assert_eq!(
        invoke(
            main,
            "open_rest_connection",
            LOCAL,
            json!({"basePath": "invalid"})
        )
        .unwrap_err(),
        "invalid_installation"
    );
    assert_eq!(main.resources_table().names().count(), 0);

    for (command, body, code) in [
        (
            "get_current_account_id",
            json!({"serverUrl":"http://chat.example.test"}),
            "cleartext_denied",
        ),
        (
            "get_current_account_id",
            json!({"serverUrl":"invalid"}),
            "invalid_installation",
        ),
        (
            "list_account_ids",
            json!({"serverUrl":"http://chat.example.test"}),
            "cleartext_denied",
        ),
        (
            "forget_local_account",
            json!({"serverUrl":SERVER,"userId":"invalid"}),
            "invalid_account",
        ),
        (
            "open_rest_connection",
            json!({"basePath":SERVER,"userId":"invalid"}),
            "invalid_account",
        ),
    ] {
        assert_eq!(invoke(main, command, LOCAL, body).unwrap_err(), code);
    }
    let pending = main.resources_table().add(PendingAccountOpen);
    clear_connections(main);
    assert!(
        main.resources_table()
            .get::<PendingAccountOpen>(pending)
            .is_err()
    );

    let foreign = sibling
        .resources_table()
        .add(Session::new(RestConnection::new(SERVER).unwrap()));
    assert_eq!(close(main, foreign).unwrap_err(), "unknown_connection");

    let first = open(main, SERVER);
    let remaining = open(main, "https://other.example.test/path");
    assert_ne!(first, remaining);
    let read = |rid| {
        invoke(main, "read_channel_window", LOCAL, json!({
        "rid": rid, "query": {"kind":"latest","channelId":"c".repeat(26),"collapsedThreads":false,"limit":1}
    })).map(drop)
    };
    assert_eq!(read(foreign).unwrap_err(), "unknown_connection");
    assert_eq!(read(first).unwrap_err(), "session_unavailable");
    for (rid, expected) in [
        (foreign, "unknown_connection"),
        (first, "session_unavailable"),
    ] {
        assert_eq!(
            invoke(
                main,
                "begin_channel_history_load",
                LOCAL,
                json!({"rid":rid,"channelId":"c".repeat(26)})
            )
            .unwrap_err(),
            expected
        );
    }
    for command in ["sign_out_account", "sign_out_on_device"] {
        assert_eq!(
            invoke(main, command, LOCAL, json!({"rid":foreign})).unwrap_err(),
            "unknown_connection"
        );
        assert_eq!(
            invoke(main, command, LOCAL, json!({"rid":first})).unwrap_err(),
            "session_unavailable"
        );
    }
    close(main, first).unwrap();
    assert_eq!(read(first).unwrap_err(), "unknown_connection");
    for command in ["sign_out_account", "sign_out_on_device"] {
        assert_eq!(
            invoke(main, command, LOCAL, json!({"rid":first})).unwrap_err(),
            "unknown_connection"
        );
    }
    assert_eq!(close(main, first).unwrap_err(), "unknown_connection");
    assert!(main.resources_table().get::<Session>(remaining).is_ok());

    let marker = main.resources_table().add(Marker);
    assert_eq!(close(main, marker).unwrap_err(), "unknown_connection");
    let another = open(main, SERVER);

    clear_connections(main);
    assert_eq!(close(main, remaining).unwrap_err(), "unknown_connection");
    assert_eq!(close(main, another).unwrap_err(), "unknown_connection");
    assert!(main.resources_table().get::<Marker>(marker).is_ok());
    assert!(sibling.resources_table().get::<Session>(foreign).is_ok());
    close(main, open(main, SERVER)).unwrap();
}
