use super::{NativeHttp, TransportError};
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

async fn check_wire(client: NativeHttp, spec: &str) -> CheckResult {
    let ports = spec
        .split(',')
        .map(str::parse::<u16>)
        .collect::<Result<Vec<_>, _>>()?;
    let [tls, unknown_ca, wrong_name, http2, plain] = ports[..] else {
        return Err("expected five fixture ports".into());
    };
    let base = format!("https://127.0.0.1:{tls}");
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
    let builder =
        reqwest::Client::builder().tls_certs_merge([reqwest::Certificate::from_pem(&pem)?]);
    let client = NativeHttp::from_builder(builder)?;
    check_wire(client, &std::env::var("UMMKA_HTTP_PORTS")?).await
}

#[cfg(target_os = "android")]
#[jni::jni_mangle("io.github.muxx.ummka.dev.HttpCheckActivity")]
pub fn run_checks<'local>(
    mut env: jni::EnvUnowned<'local>,
    _: jni::objects::JObject<'local>,
    ports: jni::objects::JString<'local>,
) {
    env.with_env(|env| {
        let ports = ports.try_to_string(env)?;
        let result =
            tauri::async_runtime::block_on(async { check_wire(NativeHttp::new()?, &ports).await });
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
