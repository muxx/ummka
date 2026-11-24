fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "open_rest_connection",
        "get_current_account_id",
        "list_account_ids",
        "forget_local_account",
        "sign_out_account",
        "sign_out_on_device",
        "close_rest_connection",
        "read_channel_window",
        "begin_channel_history_load",
        "store_channel_history_page",
        "cancel_channel_history_load",
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
