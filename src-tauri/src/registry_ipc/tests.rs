use super::FILE_NAME;
use crate::ipc_test::{LOCAL, invoke, sibling};
use serde_json::json;
use tauri::WebviewWindowBuilder;
use tauri::test::mock_builder;
use tauri::utils::config::AppDirectoriesOverride;

#[test]
fn only_local_main_can_open_and_change_the_private_registry() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("private-marker");
    let file = root.join(FILE_NAME);
    let mut context = crate::context();
    context.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Root(root.clone()));
    let app = crate::build(mock_builder(), context).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let sibling = sibling(main);
    let address = "https://chat.example.test/Team";
    let change = json!({"serverUrl": address});
    for (view, origin) in [(&sibling, LOCAL), (main, "https://remote.example.test/")] {
        for (command, body) in [
            ("list_installations", json!({})),
            ("remember_installation", change.clone()),
            ("forget_installation", change.clone()),
        ] {
            let error = invoke(view, command, origin, body).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"), "{error}");
        }
    }
    assert!(
        !file.exists(),
        "startup and rejected IPC must leave the registry unopened"
    );
    let list = || {
        invoke(main, "list_installations", LOCAL, json!({}))
            .map(|v| v.deserialize::<Vec<String>>().unwrap())
    };
    assert!(list().unwrap().is_empty());
    for command in ["remember_installation", "forget_installation"] {
        let invalid = json!({"serverUrl": "https://private-marker@chat.example.test"});
        assert_eq!(
            invoke(main, command, LOCAL, invalid).unwrap_err(),
            "invalid_installation"
        );
    }
    assert!(list().unwrap().is_empty());
    invoke(main, "remember_installation", LOCAL, change.clone()).unwrap();
    assert_eq!(list().unwrap(), [address]);
    invoke(main, "forget_installation", LOCAL, change).unwrap();
    assert!(list().unwrap().is_empty());
    std::fs::remove_file(&file).unwrap();
    {
        let db = rusqlite::Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE foreign_data(value TEXT); INSERT INTO foreign_data VALUES ('keep'); PRAGMA user_version = 3;").unwrap();
    }
    let before = std::fs::read(&file).unwrap();
    assert_eq!(list().unwrap_err(), "unsupported_schema");
    assert_eq!(std::fs::read(&file).unwrap(), before);
    std::fs::remove_dir_all(&root).unwrap();
    std::fs::write(root, b"not a directory").unwrap();
    assert_eq!(list().unwrap_err(), "storage");
}
