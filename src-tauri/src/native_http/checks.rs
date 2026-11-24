use super::{NativeHttp, TransportError};
use crate::rest::RestConnection;
use reqwest::{Method, Request, StatusCode, Version};
use std::error::Error;

type CheckResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

fn get(base: &str, path: &str) -> Request {
    Request::new(Method::GET, format!("{base}/{path}").parse().unwrap())
}

async fn expect_ok(client: &NativeHttp, base: &str, path: &str) -> CheckResult<Version> {
    let response = client.send(get(base, path)).await?;
    assert_eq!(response.status(), StatusCode::OK, "{path}");
    let version = response.version();
    assert_eq!(response.text().await?, "OK", "{path}");
    Ok(version)
}

async fn check_scope(
    connection: &RestConnection,
    selected: &str,
    other: &str,
    control: &NativeHttp,
    control_base: &str,
) -> CheckResult {
    const PING: &str = "api/v4/system/ping";
    const READ_ROUTES: [&str; 4] = [
        "api/v4/config/client?format=old",
        "api/v4/license/client?format=old",
        "api/v4/users/me",
        "api/v4/users/Abc01234567890123456789012",
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
    let mut cookie = get(selected, PING);
    cookie
        .headers_mut()
        .insert("cookie", "private=value".parse()?);
    let mut authority = get(selected, PING);
    authority
        .headers_mut()
        .insert("host", "elsewhere.invalid".parse()?);
    for request in [
        get(selected, "api/v4/unknown?private=value"),
        get(selected, "api/v4/config"),
        get(selected, "api/v4/users/stats"),
        get(selected, "api/v4/users/login"),
        get(selected, "api/v4/users/short"),
        get(selected, "api/v4/users/Abc012345678901234567890123"),
        get(selected, "api/v4/users/%6de"),
        get(selected, "api/v4/users/me%2Fimage"),
        get(selected, "api/v4/users/me/image"),
        get(selected, "api/v4/users/me/"),
        post,
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
    Ok(())
}

async fn check_wire(
    client: NativeHttp,
    connect: impl FnOnce(&str) -> Result<RestConnection, TransportError>,
    spec: &str,
) -> CheckResult {
    let ports = spec
        .split(',')
        .map(str::parse::<u16>)
        .collect::<Result<Vec<_>, _>>()?;
    let [tls, unknown_ca, wrong_name, http2, plain, selected, other] = ports[..] else {
        return Err("expected seven fixture ports".into());
    };
    let base = format!("https://127.0.0.1:{tls}");
    let prefix = "/Teams/Blue%20Sky//A%2FB";
    let selected = format!("https://127.0.0.1:{selected}{prefix}");
    let other = format!("https://127.0.0.1:{other}{prefix}");
    let connection = connect(&selected)?;
    check_scope(&connection, &selected, &other, &client, &base).await?;
    for path in ["team/chat/one", "team/chat/two"] {
        assert_eq!(expect_ok(&client, &base, path).await?, Version::HTTP_11);
    }
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
    )
    .await
}

#[cfg(target_os = "android")]
#[jni::jni_mangle("io.github.muxx.ummka.dev.HttpCheckInstrumentation")]
pub fn run_checks<'local>(
    mut env: jni::EnvUnowned<'local>,
    _: jni::objects::JObject<'local>,
    ports: jni::objects::JString<'local>,
    registry_path: jni::objects::JString<'local>,
) {
    env.with_env(|env| {
        let ports = ports.try_to_string(env)?;
        let registry_path = registry_path.try_to_string(env)?;
        let result = tauri::async_runtime::block_on(async {
            crate::registry::checks::round_trip(std::path::Path::new(&registry_path))?;
            check_wire(NativeHttp::new()?, RestConnection::new, &ports).await
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
