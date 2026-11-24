use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response};
use tauri::webview::InvokeRequest;
use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder};

pub(crate) const LOCAL: &str = "tauri://localhost/";

pub(crate) fn invoke(
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

pub(crate) fn sibling(main: &Webview<MockRuntime>) -> Webview<MockRuntime> {
    main.window()
        .add_child(
            WebviewBuilder::new("sibling", Default::default()),
            LogicalPosition::new(0., 0.),
            LogicalSize::new(100., 100.),
        )
        .unwrap()
}
