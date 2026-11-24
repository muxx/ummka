fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "open_rest_connection",
        "close_rest_connection",
        "prepare_rest_request",
        "send_rest_request",
        "read_rest_body",
        "cancel_rest_request",
        "list_installations",
        "remember_installation",
        "forget_installation",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("could not build the Tauri application manifest");
}
