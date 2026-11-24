use super::*;
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{LogicalPosition, LogicalSize, WebviewBuilder, WebviewWindowBuilder};

const LOCAL: &str = "tauri://localhost/";
const SERVER: &str = "https://chat.example.test";

fn invoke(
    view: &Webview<MockRuntime>,
    command: &str,
    origin: &str,
    body: Value,
) -> Result<InvokeResponseBody, Value> {
    // The Tauri test helper accepts an AsRef wrapper for a child WebView.
    get_ipc_response(
        &Box::new(view.clone()),
        InvokeRequest {
            cmd: command.into(),
            callback: CallbackFn(1),
            error: CallbackFn(2),
            url: origin.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_owned(),
        },
    )
}

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
    let app = crate::build(mock_builder()).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let sibling = main
        .window()
        .add_child(
            WebviewBuilder::new("sibling", Default::default()),
            LogicalPosition::new(0., 0.),
            LogicalSize::new(100., 100.),
        )
        .unwrap();
    assert_eq!(main.window().label(), sibling.window().label());
    for (view, origin) in [(&sibling, LOCAL), (main, "https://remote.example.test/")] {
        for (command, body) in [
            ("open_rest_connection", json!({"basePath": SERVER})),
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

    let foreign = sibling
        .resources_table()
        .add(Session::new(RestConnection::new(SERVER).unwrap()));
    assert_eq!(close(main, foreign).unwrap_err(), "unknown_connection");

    let first = open(main, SERVER);
    let remaining = open(main, "https://other.example.test/path");
    assert_ne!(first, remaining);
    close(main, first).unwrap();
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
