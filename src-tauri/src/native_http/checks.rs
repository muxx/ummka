use super::{NativeHttp, TransportError};
use crate::rest::RestConnection;
use reqwest::{Method, Request, StatusCode, Version};
use std::error::Error;

type CheckResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

fn get(base: &str, path: &str) -> Request {
    Request::new(Method::GET, format!("{base}/{path}").parse().unwrap())
}

fn user_batch(base: &str) -> Request {
    let mut request = get(base, "api/v4/users/ids?since=123");
    *request.method_mut() = Method::POST;
    request
        .headers_mut()
        .insert("content-type", "application/json".parse().unwrap());
    *request.body_mut() =
        Some(r#"["Abc01234567890123456789012","def01234567890123456789012"]"#.into());
    request
}

async fn expect_ok(client: &NativeHttp, base: &str, path: &str) -> CheckResult<Version> {
    let response = client.send(get(base, path)).await?;
    assert_eq!(response.status(), StatusCode::OK, "{path}");
    let version = response.version();
    assert_eq!(response.text().await?, "OK", "{path}");
    Ok(version)
}

async fn check_collection_writes(connection: &RestConnection, selected: &str) -> CheckResult {
    let preference = r#"[{"user_id":"Abc01234567890123456789012","category":"flagged_post","name":"Post0123456789012345678901","value":"true"}]"#;
    for (method, path, json) in [
        (
            Method::POST,
            "api/v4/posts/Post0123456789012345678901/pin",
            None,
        ),
        (
            Method::POST,
            "api/v4/posts/Post0123456789012345678901/unpin",
            None,
        ),
        (Method::PUT, "api/v4/users/me/preferences", Some(preference)),
        (
            Method::POST,
            "api/v4/users/me/preferences/delete",
            Some(preference),
        ),
    ] {
        let mut request = get(selected, path);
        *request.method_mut() = method;
        let mut wrong_body = request.try_clone().unwrap();
        if let Some(json) = json {
            request
                .headers_mut()
                .insert("content-type", "application/json".parse()?);
            *request.body_mut() = Some(json.into());
        } else {
            *wrong_body.body_mut() = Some("{}".into());
        }
        assert_eq!(
            connection.send(wrong_body).await.unwrap_err(),
            TransportError::OperationDenied
        );
        let response = connection.send(request).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await?, "OK");
    }
    Ok(())
}

async fn check_scope(
    connection: &RestConnection,
    selected: &str,
    other: &str,
    control: &NativeHttp,
    control_base: &str,
) -> CheckResult {
    const PING: &str = "api/v4/system/ping";
    const HISTORY: &str =
        "api/v4/channels/Channel0123456789012345678/posts?page=0&per_page=60&collapsedThreads=true";
    const READ_ROUTES: [&str; 17] = [
        "api/v4/channels/Channel0123456789012345678",
        "api/v4/config/client?format=old",
        "api/v4/license/client?format=old",
        "api/v4/users/me",
        "api/v4/users/me/image",
        "api/v4/users/Abc01234567890123456789012",
        "api/v4/users/me/teams",
        "api/v4/users/me/teams/members",
        "api/v4/users/Abc01234567890123456789012/teams/Team0123456789012345678901/channels?include_deleted=false",
        "api/v4/users/me/teams/Team0123456789012345678901/channels/members",
        "api/v4/users/me/teams/Team0123456789012345678901/channels/categories",
        "api/v4/users/me/preferences",
        HISTORY,
        "api/v4/channels/Channel0123456789012345678/pinned",
        "api/v4/users/me/posts/flagged?page=1&per_page=60",
        "api/v4/posts/Post0123456789012345678901/info",
        "api/v4/posts/Post0123456789012345678901/thread?direction=down&perPage=1",
    ];
    expect_ok(control, control_base, "scope-created").await?;
    let mut fragment = get(selected, PING);
    fragment.url_mut().set_fragment(Some("private"));
    let mut credentials = get(selected, PING);
    credentials.url_mut().set_username("private").unwrap();
    let mut scheme = get(selected, PING);
    scheme.url_mut().set_scheme("http").unwrap();
    let mut host = get(selected, PING);
    host.url_mut().set_host(Some("localhost")).unwrap();
    for request in [
        get(other, PING),
        get(&format!("{selected}-sibling"), PING),
        fragment,
        credentials,
        scheme,
        host,
    ] {
        let error = connection.send(request).await.unwrap_err();
        assert_eq!(error, TransportError::OutsideInstallation);
        assert_eq!(
            error.to_string(),
            "REST target is outside the selected installation"
        );
        assert_eq!(format!("{error:?}"), "OutsideInstallation");
    }
    let mut post = get(selected, PING);
    *post.method_mut() = Method::POST;
    let mut login = user_batch(selected);
    *login.url_mut() = format!("{selected}/api/v4/users/login").parse()?;
    let mut logout = get(selected, "api/v4/users/logout");
    *logout.method_mut() = Method::POST;
    let mut cookie = get(selected, PING);
    cookie
        .headers_mut()
        .insert("cookie", "private=value".parse()?);
    let mut authority = get(selected, PING);
    authority
        .headers_mut()
        .insert("host", "elsewhere.invalid".parse()?);
    let mut history_with_body = get(selected, HISTORY);
    *history_with_body.body_mut() = Some("[]".into());
    for request in [
        get(selected, "api/v4/unknown?private=value"),
        get(selected, "api/v4/config"),
        get(selected, "api/v4/users/stats"),
        get(selected, "api/v4/users/login"),
        get(selected, "api/v4/users/short"),
        get(selected, "api/v4/users/Abc012345678901234567890123"),
        get(selected, "api/v4/users/%6de"),
        get(selected, "api/v4/users/me%2Fimage"),
        get(selected, "api/v4/users/me/image/default"),
        get(selected, "api/v4/users/short/image"),
        get(selected, "api/v4/users/usernames"),
        get(selected, "api/v4/users/me/"),
        get(selected, "api/v4/posts/short/info"),
        get(selected, "api/v4/posts/me/info"),
        get(selected, "api/v4/posts/Post0123456789012345678901/pin"),
        get(selected, "api/v4/channels/me/posts"),
        get(selected, "api/v4/channels/short/posts"),
        get(
            selected,
            "api/v4/channels/Channel0123456789012345678%2F/posts",
        ),
        get(
            selected,
            "api/v4/channels/%43hannel0123456789012345678/posts",
        ),
        get(
            selected,
            "api/v4/channels/Channel0123456789012345678/posts/unread",
        ),
        get(selected, "api/v4/channels/short"),
        get(selected, "api/v4/channels/short/pinned"),
        get(selected, "api/v4/users/short/posts/flagged"),
        history_with_body,
        get(selected, "api/v4/users/me/teams/me/channels"),
        get(
            selected,
            "api/v4/users/short/teams/Team0123456789012345678901/channels",
        ),
        get(
            selected,
            "api/v4/users/me/teams/%54eam0123456789012345678901/channels",
        ),
        get(selected, "api/v4/users/me/teams/short/channels/members"),
        get(
            selected,
            "api/v4/users/me/teams/Team0123456789012345678901/channels/members/extra",
        ),
        get(
            selected,
            "api/v4/users/me/teams/Team0123456789012345678901/channels/categories/order",
        ),
        get(selected, "api/v4/users/me/preferences/direct_channel_show"),
        post,
        login,
        logout,
        cookie,
        authority,
    ] {
        let error = connection.send(request).await.unwrap_err();
        assert_eq!(error, TransportError::OperationDenied);
        assert_eq!(error.to_string(), "REST operation is not allowed");
        assert_eq!(format!("{error:?}"), "OperationDenied");
    }
    for path in READ_ROUTES {
        let mut post = get(selected, path);
        *post.method_mut() = Method::POST;
        assert_eq!(
            connection.send(post).await.unwrap_err(),
            TransportError::OperationDenied
        );
        assert_eq!(
            connection.send(get(other, path)).await.unwrap_err(),
            TransportError::OutsideInstallation
        );
    }
    let mut missing = user_batch(selected);
    *missing.body_mut() = None;
    let mut wrong_type = user_batch(selected);
    wrong_type
        .headers_mut()
        .insert("content-type", "text/plain".parse()?);
    let mut get_with_body = get(selected, PING);
    *get_with_body.body_mut() = Some("[]".into());
    for invalid in [
        missing,
        wrong_type,
        get_with_body,
        get(selected, "api/v4/users/ids"),
    ] {
        assert_eq!(
            connection.send(invalid).await.unwrap_err(),
            TransportError::OperationDenied
        );
    }
    for name in ["content-length", "transfer-encoding"] {
        for mut request in [user_batch(selected), get(selected, PING)] {
            request.headers_mut().insert(name, "0".parse()?);
            assert_eq!(
                connection.send(request).await.unwrap_err(),
                TransportError::OperationDenied
            );
        }
    }
    expect_ok(control, control_base, "scope-denied").await?;
    for _ in 0..2 {
        let mut request = get(
            selected,
            "api/v4/system/ping?use_rest_semantics=true&device_id=wire%20check",
        );
        request.headers_mut().insert("x-fixture", "scoped".parse()?);
        let response = connection.send(request).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await?, "OK");
    }
    for path in READ_ROUTES {
        let response = connection.send(get(selected, path)).await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.text().await?, "OK");
    }
    let response = connection.send(user_batch(selected)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await?, "OK");
    check_collection_writes(connection, selected).await
}

async fn check_wire(
    client: NativeHttp,
    connect: impl FnOnce(&str) -> Result<RestConnection, TransportError>,
    spec: &str,
    fixture_dir: &std::path::Path,
) -> CheckResult {
    let ports = spec
        .split(',')
        .map(str::parse::<u16>)
        .collect::<Result<Vec<_>, _>>()?;
    let [tls, unknown_ca, wrong_name, http2, plain, selected, other] = ports[..] else {
        return Err("expected seven fixture ports".into());
    };
    let base = format!("https://127.0.0.1:{tls}");
    // Probe the fresh pool before the concurrent sign-out cases leave multiple idle sockets.
    for path in ["team/chat/one", "team/chat/two"] {
        assert_eq!(expect_ok(&client, &base, path).await?, Version::HTTP_11);
    }
    crate::authentication::checks::exchange(
        &client,
        &base,
        &format!("https://127.0.0.1:{other}"),
        fixture_dir,
    )
    .await?;
    crate::realtime::checks::wire(&client, &base).await?;
    crate::rest::file_upload::checks::wire(&client, &base).await?;
    crate::rest_ipc::attachment_check::wire(&client, &base).await?;
    crate::rest_ipc::mobile_file_policy_check::wire(&client, &base).await?;
    let prefix = "/Teams/Blue%20Sky//A%2FB";
    let selected = format!("https://127.0.0.1:{selected}{prefix}");
    let other = format!("https://127.0.0.1:{other}{prefix}");
    let connection = connect(&selected)?;
    check_scope(&connection, &selected, &other, &client, &base).await?;
    for port in [unknown_ca, wrong_name] {
        let url = format!("https://127.0.0.1:{port}");
        assert_eq!(
            client.send(get(&url, "tls")).await.unwrap_err(),
            TransportError::Network
        );
    }
    let http = format!("http://127.0.0.1:{plain}");
    #[cfg(target_os = "android")]
    assert_eq!(
        client.send(get(&http, "cleartext")).await.unwrap_err(),
        TransportError::CleartextDenied
    );
    #[cfg(not(target_os = "android"))]
    expect_ok(&client, &http, "cleartext").await?;

    for code in [301, 302, 303, 307, 308] {
        for location in ["with", "without"] {
            let request = get(&base, &format!("redirect/{code}/{location}"));
            assert_eq!(
                client.send(request).await.unwrap_err(),
                TransportError::Redirect
            );
        }
    }
    for code in [304, 401, 503] {
        let response = client.send(get(&base, &format!("status/{code}"))).await?;
        assert_eq!(response.status().as_u16(), code);
        assert_eq!(response.headers()["x-fixture"], "received");
        assert_eq!(
            response.text().await?,
            if code == 304 { "" } else { "error body" }
        );
    }

    // The server acknowledges only after the pending request reaches its handler.
    tokio::select! {
        response = client.send(get(&base, "hold-headers")) => panic!("unexpected response {response:?}"),
        ready = expect_ok(&client, &base, "headers-received") => { ready?; }
    }
    expect_ok(&client, &base, "headers-closed").await?;
    let mut partial = client.send(get(&base, "hold-body")).await?;
    assert_eq!(partial.chunk().await?.as_deref(), Some(b"first".as_slice()));
    drop(partial);
    expect_ok(&client, &base, "body-closed").await?;
    assert_eq!(
        client.send(get(&base, "disconnect")).await.unwrap_err(),
        TransportError::Network
    );

    let h2 = format!("https://127.0.0.1:{http2}");
    assert_eq!(expect_ok(&client, &h2, "warm").await?, Version::HTTP_2);
    let (one, two) = tokio::try_join!(
        expect_ok(&client, &h2, "one"),
        expect_ok(&client, &h2, "two")
    )?;
    assert_eq!((one, two), (Version::HTTP_2, Version::HTTP_2));
    Ok(())
}

#[cfg(all(test, not(target_os = "android")))]
#[tokio::test]
async fn wire() -> CheckResult {
    let pem = std::fs::read(std::env::var("UMMKA_HTTP_TEST_CA")?)?;
    let ca = reqwest::Certificate::from_pem(&pem)?;
    let http =
        || NativeHttp::from_builder(reqwest::Client::builder().tls_certs_merge([ca.clone()]));
    check_wire(
        http()?,
        |base| RestConnection::with_client(base, http),
        &std::env::var("UMMKA_HTTP_PORTS")?,
        tempfile::tempdir()?.path(),
    )
    .await
}

#[cfg(target_os = "android")]
#[jni::jni_mangle("io.github.muxx.ummka.dev.HttpCheckInstrumentation")]
pub fn run_checks<'local>(
    mut env: jni::EnvUnowned<'local>,
    instrumentation: jni::objects::JObject<'local>,
    ports: jni::objects::JString<'local>,
    registry_path: jni::objects::JString<'local>,
    _account_port: jni::sys::jint,
) {
    env.with_env(|env| {
        let ports = ports.try_to_string(env)?;
        let registry_path = registry_path.try_to_string(env)?;
        #[cfg(feature = "webview-check")]
        {
            let sessions = crate::sessions::AccountSessions::for_application(String::new());
            crate::rest_ipc::seed_check_sessions(
                &sessions,
                u16::try_from(_account_port).expect("fixture port"),
            )
            .expect("could not seed Android fixture credentials");
            crate::credentials::android::checks::reject_first_account_removal()
                .expect("could not install fixture constraint");
        }
        let mut report_stage = |name: &str| -> jni::errors::Result<()> {
            let stage = env.new_string(name)?;
            env.call_method(
                &instrumentation,
                jni::jni_str!("reportStage"),
                jni::jni_sig!((JString) -> void),
                &[jni::objects::JValue::Object(stage.as_ref())],
            )?;
            Ok(())
        };
        let result = tauri::async_runtime::block_on(async {
            report_stage("sqlite")?;
            let registry = std::path::Path::new(&registry_path);
            crate::registry::checks::round_trip(registry)?;
            let fixtures = registry.parent().ok_or("missing fixture directory")?;
            crate::history::checks::round_trip(fixtures)?;
            crate::history::checks::migrations::round_trip(fixtures)?;
            crate::history::checks::posts::round_trip(fixtures)?;
            crate::history::checks::windows::round_trip(fixtures)?;
            crate::history::checks::reclamation::round_trip(fixtures)?;
            crate::history::checks::check_channel_departure(fixtures)?;
            report_stage("documents")?;
            crate::device_document::check_android().await?;
            report_stage("transport")?;
            check_wire(NativeHttp::new()?, RestConnection::new, &ports, fixtures).await
        });
        if let Err(error) = result {
            env.throw_new(
                jni::jni_str!("java/lang/AssertionError"),
                jni::strings::JNIString::from(error.to_string()),
            )?;
        }
        Ok::<(), jni::errors::Error>(())
    })
    .resolve::<jni::errors::ThrowRuntimeExAndDefault>();
}
