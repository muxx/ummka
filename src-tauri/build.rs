fn main() {
    let manifest = tauri_build::AppManifest::new()
        .commands(&["open_rest_connection", "close_rest_connection"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("could not build the Tauri application manifest");
}
