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
fn cached_post_observation_is_consumed_even_when_ipc_payload_is_invalid() {
    use crate::{
        history::{AccountHistory, PageWrite},
        sessions::{Account, fixture},
    };
    use std::sync::Arc;

    let app = crate::build(mock_builder(), crate::context()).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let user = "a".repeat(26);
    let channel = "c".repeat(26);
    let post = "p".repeat(26);
    let storage = tempfile::tempdir().unwrap();
    let mut history =
        AccountHistory::open(storage.path(), &Account::new(SERVER, &user).unwrap()).unwrap();
    let initial = history.begin_channel_load(&channel).unwrap();
    assert_eq!(
        history
            .apply_channel_page(
                initial,
                &[serde_json::from_value(json!({
                    "kind": "save", "id": post, "channelId": channel, "userId": user,
                    "createAt": 100, "updateAt": 100, "editAt": 0, "type": "",
                    "message": "Cached post", "hashtags": "", "isPinned": false,
                    "displayPriority": "urgent"
                }))
                .unwrap()],
            )
            .unwrap(),
        PageWrite::Applied
    );

    let sessions = fixture::using(Arc::new(fixture::TestVault::default()));
    let connection = tauri::async_runtime::block_on(async {
        sessions
            .activate(SERVER, &user, "fixture-token")
            .await
            .unwrap();
        RestConnection::new(SERVER)
            .unwrap()
            .for_account(&sessions, &user)
            .await
            .unwrap()
    });
    let history = Arc::new(tokio::sync::Mutex::new(history));
    let owner = Session::new(connection);
    // Supply the cached SQLite connection without touching the platform credential store.
    assert!(owner.history.set(Arc::downgrade(&history)).is_ok());
    let rid = main.resources_table().add(owner);
    let begin = || {
        invoke(
            main,
            "begin_cached_post_observation",
            LOCAL,
            json!({ "rid": rid, "postId": post }),
        )
        .unwrap()
        .deserialize::<ResourceId>()
        .unwrap()
    };
    let finish = |load, observation: Value| {
        invoke(
            main,
            "finish_cached_post_observation",
            LOCAL,
            json!({ "rid": rid, "load": load, "observation": observation }),
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    };
    let priority = || {
        invoke(
            main,
            "read_saved_post",
            LOCAL,
            json!({ "rid": rid, "channelId": channel, "postId": post }),
        )
        .unwrap()
        .deserialize::<Value>()
        .unwrap()["displayPriority"]
            .clone()
    };
    let valid = json!({ "channelId": channel, "updateAt": 100, "displayPriority": "standard" });
    let load = begin();
    let mut malformed = valid.clone();
    malformed["displayPriority"] = json!(false);
    let error = finish(load, malformed).unwrap_err();
    assert_eq!(
        finish(load, valid.clone()),
        Err(json!("unknown_history_load"))
    );
    assert_eq!(error, json!("invalid_history_request"));

    let cancelled = begin();
    assert_eq!(finish(cancelled, Value::Null), Ok(Value::Null));
    assert_eq!(
        finish(cancelled, valid.clone()),
        Err(json!("unknown_history_load"))
    );
    assert_eq!(priority(), json!("urgent"));

    let completed = begin();
    assert_eq!(
        finish(completed, valid),
        Ok(json!({"kind": "cached", "changed": true, "cards": null}))
    );
    assert_eq!(
        finish(completed, Value::Null),
        Err(json!("unknown_history_load"))
    );
    assert_eq!(priority(), json!("standard"));
    close(main, rid).unwrap();
}

#[test]
fn only_the_local_main_webview_can_manage_its_own_connections() {
    let app = crate::build(mock_builder(), crate::context()).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let sibling = sibling(main);
    #[cfg(any(target_os = "android", target_os = "macos"))]
    let file_draft = json!({"channelId":"a".repeat(26),"rootId":null});
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
                "begin_cached_post_observation",
                json!({"rid":0,"postId":"p".repeat(26)}),
            ),
            (
                "finish_cached_post_observation",
                json!({"rid":0,"load":0,"observation":null}),
            ),
            (
                "begin_channel_history_load",
                json!({"rid":0,"channelId":"c".repeat(26)}),
            ),
            (
                "store_channel_history_page",
                json!({"rid":0,"load":0,"page":null}),
            ),
            (
                "store_channel_history_changes",
                json!({"rid":0,"load":0,"changes":null}),
            ),
            ("cancel_channel_history_load", json!({"rid":0,"load":0})),
            ("read_joined_teams", json!({"rid":0})),
            ("select_joined_team", json!({"rid":0, "teamId":"x"})),
            ("read_recent_team_searches", json!({"rid":0,"teamId":"x"})),
            (
                "remember_team_search",
                json!({"rid":0,"teamId":"x","term":"fixture"}),
            ),
            (
                "forget_team_search",
                json!({"rid":0,"teamId":"x","term":"fixture"}),
            ),
            ("begin_team_directory_load", json!({"rid":0})),
            (
                "read_composer_draft",
                json!({"rid":0,"channelId":"a".repeat(26),"rootId":null}),
            ),
            (
                "transition_draft_command",
                json!({"rid":0,"channelId":"a".repeat(26),"rootId":null,"revision":"1".repeat(32),"action":"start"}),
            ),
            (
                "save_composer_draft",
                json!({"rid":0,"channelId":"a".repeat(26),"rootId":null,"expectedRevision":null,"message":"local"}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            ("open_draft_file_workspace", json!({"rid":0})),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "choose_draft_files",
                json!({"rid":0,"workspace":0,"draft":file_draft,"policy":{"kind":"allowed","maxFileBytes":"10"}}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "read_draft_files",
                json!({"rid":0,"workspace":0,"draft":file_draft}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "start_draft_file_upload",
                json!({"rid":0,"workspace":0,"draft":file_draft,"file":"00000000-0000-0000-0000-000000000000","policy":{"kind":"unknown"}}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "remove_draft_file",
                json!({"rid":0,"workspace":0,"draft":file_draft,"file":"00000000-0000-0000-0000-000000000000"}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "confirm_draft_file_upload_policy",
                json!({"rid":0,"workspace":0,"draft":file_draft,"observedDenial":"00000000-0000-0000-0000-000000000000","policy":{"kind":"unknown"}}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            (
                "stage_draft_post_with_files",
                json!({"rid":0,"workspace":0,"draft":file_draft,"expectedRevision":null,"selected":[]}),
            ),
            #[cfg(any(target_os = "android", target_os = "macos"))]
            ("close_draft_file_workspace", json!({"rid":0,"workspace":0})),
            (
                "stage_composer_post",
                json!({"rid":0,"channelId":"a".repeat(26),"rootId":null,"revision":"a".repeat(32)}),
            ),
            (
                "read_pending_posts",
                json!({"rid":0,"channelId":"a".repeat(26),"rootId":null,"after":0,"limit":20}),
            ),
            (
                "confirm_post_delivery",
                json!({"rid":0,"source":{"kind":"posted"},"wirePendingId":"pending","post":{"id":"a","channelId":"b","userId":"c","rootId":null}}),
            ),
            ("retire_delivered_posts", json!({"rid":0,"postIds":[]})),
            (
                "record_post_refusal",
                json!({"rid":0,"pendingId":"id","attempt":1,"refusal":{"status":403,"code":"refused","message":null}}),
            ),
            (
                "retry_pending_post",
                json!({"rid":0,"pendingId":"id","attempt":1,"choice":{"kind":"despiteUnknownDelivery"}}),
            ),
            (
                "dismiss_pending_post",
                json!({"rid":0,"pendingId":"id","attempt":1}),
            ),
            ("prepare_channel_observer", json!({"rid":0,"active":true})),
            (
                "run_channel_observer",
                json!({"rid":0,"observer":"owner","events":"__CHANNEL__:1"}),
            ),
            (
                "set_channel_observer_active",
                json!({"rid":0,"observer":"owner","active":true,"generation":1}),
            ),
            (
                "acknowledge_channel_notice",
                json!({"rid":0,"observer":"owner","receipt":"ticket"}),
            ),
            (
                "close_channel_observer",
                json!({"rid":0,"observer":"owner"}),
            ),
            ("read_workspace_settings", json!({"rid":0})),
            ("begin_workspace_policy_load", json!({"rid":0})),
            (
                "store_workspace_policy",
                json!({"rid":0,"load":0,"server":{}}),
            ),
            ("cancel_workspace_policy_load", json!({"rid":0,"load":0})),
            (
                "store_team_directory",
                json!({"rid":0,"load":0,"teams":[],"preferences":{}}),
            ),
            ("cancel_team_directory_load", json!({"rid":0,"load":0})),
            (
                "read_saved_profiles",
                json!({"rid":0,"query":{"ids":[],"usernames":[]}}),
            ),
            ("store_channel_profiles", json!({"rid":0,"profiles":[]})),
            (
                "read_saved_post",
                json!({"rid":0,"channelId":"x","postId":"y"}),
            ),
            ("read_team_sidebar", json!({"rid":0,"teamId":"x"})),
            (
                "select_sidebar_channel",
                json!({"rid":0,"teamId":"x","channelId":"y"}),
            ),
            ("begin_sidebar_load", json!({"rid":0,"teamId":"x"})),
            ("store_team_sidebar", json!({"rid":0,"load":1,"data":{}})),
            ("cancel_sidebar_load", json!({"rid":0,"load":1})),
            ("read_team_roles", json!({"rid":0,"teamId":"x"})),
            ("begin_team_role_load", json!({"rid":0,"teamId":"x"})),
            ("store_team_roles", json!({"rid":0,"load":1,"data":{}})),
            ("cancel_team_role_load", json!({"rid":0,"load":1})),
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
        for command in [
            "read_recent_team_searches",
            "remember_team_search",
            "forget_team_search",
        ] {
            assert_eq!(
                invoke(
                    main,
                    command,
                    LOCAL,
                    json!({"rid":rid,"teamId":"t".repeat(26),"term":"fixture"})
                )
                .unwrap_err(),
                expected
            );
        }
        assert_eq!(
            invoke(
                main,
                "read_saved_post",
                LOCAL,
                json!({"rid":rid,"channelId":"c".repeat(26),"postId":"p".repeat(26)})
            )
            .unwrap_err(),
            expected
        );
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
        assert_eq!(
            invoke(
                main,
                "begin_cached_post_observation",
                LOCAL,
                json!({"rid":rid,"postId":"p".repeat(26)})
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
