use super::*;
use crate::ipc_test::{LOCAL, invoke, sibling};
use serde_json::json;
use tauri::{WebviewWindowBuilder, test::mock_builder, utils::config::AppDirectoriesOverride};

#[test]
fn only_local_main_can_start_or_cancel_and_only_for_its_selected_server() {
    let directory = tempfile::tempdir().unwrap();
    let mut context = crate::context();
    context.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Root(directory.path().to_owned()));
    let app = crate::build(mock_builder(), context).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let main = window.as_ref();
    let other = sibling(main);
    let server = "https://chat.example.test/team";
    let start = json!({"serverUrl": server, "provider": "gitlab", "onStarted":"__CHANNEL__:1"});
    let cancel = json!({"requestId": Uuid::new_v4().to_string()});
    for (view, origin) in [(&other, LOCAL), (main, "https://remote.example.test")] {
        for (command, args) in [
            ("sign_in_with_browser", &start),
            ("cancel_browser_sign_in", &cancel),
        ] {
            let error = invoke(view, command, origin, args.clone()).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"));
        }
    }
    let sibling_installation = json!({"serverUrl":"https://chat.example.test"});
    invoke(main, "connect_installation", LOCAL, sibling_installation).unwrap();
    assert_eq!(
        invoke(main, "sign_in_with_browser", LOCAL, start).unwrap_err(),
        json!({"kind":"selection_changed"})
    );
    assert!(
        !invoke(main, "cancel_browser_sign_in", LOCAL, cancel)
            .unwrap()
            .deserialize::<bool>()
            .unwrap()
    );
}

#[test]
fn projects_public_fields_and_records_whether_a_failed_save_revoked_the_new_session() {
    let server = PublicError {
        status_code: 403,
        id: Some("fixture.signin".into()),
        message: None,
        request_id: Some("fixture-id".into()),
    };
    let error = SystemSignInError::SignIn(SignInError::Authentication(AuthError::Server(server)));
    assert_eq!(
        serde_json::to_value(BrowserActionError::from(error)).unwrap(),
        json!({"kind":"server","error":{"status_code":403,"id":"fixture.signin","request_id":"fixture-id"}})
    );
    for revocation in [Revocation::Confirmed, Revocation::Unconfirmed] {
        let err = SignInError::NotSaved {
            cause: TransportError::CredentialStorageUnavailable,
            revocation,
        };
        assert_eq!(
            serde_json::to_value(BrowserActionError::from(SystemSignInError::SignIn(err))).unwrap(),
            json!({"kind":"not_saved","cause":"credential_storage_unavailable","revocation_confirmed":revocation == Revocation::Confirmed})
        );
    }
}
