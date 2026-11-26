use percent_encoding::percent_decode_str;
use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OpenError {
    InvalidUrl,
    HandlerUnavailable,
}

fn valid_mail_text(text: &str, body: bool) -> bool {
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\r' && body && chars.next() == Some('\n') {
            continue;
        }
        if c.is_control() {
            return false;
        }
    }
    true
}

fn valid_mail_fields(url: &Url) -> bool {
    // Inspect decoded fields only. The OS receives the original URL encoding.
    [url.path(), url.fragment().unwrap_or_default()]
        .into_iter()
        .all(|value| valid_mail_text(&percent_decode_str(value).decode_utf8_lossy(), false))
        && url.query_pairs().all(|(key, value)| {
            valid_mail_text(&key, false)
                && valid_mail_text(&value, key.eq_ignore_ascii_case("body"))
        })
}

fn external_url(href: &str) -> Option<Url> {
    if href.trim() != href || href.chars().any(|c| c.is_control() || c == '\\') {
        return None;
    }
    let (_, rest) = href.split_once(':')?;
    let url = Url::parse(href).ok()?;
    match url.scheme() {
        "http" | "https" => {
            // WHATWG parsing repairs missing slashes and discards an empty userinfo component.
            let authority = rest.strip_prefix("//")?.split(['/', '?', '#']).next()?;
            if authority.is_empty() || authority.contains('@') || !url.has_host() {
                return None;
            }
        }
        "mailto" if !rest.starts_with('/') && valid_mail_fields(&url) => {}
        _ => return None,
    }
    Some(url)
}

fn dispatch<E>(href: &str, open: impl FnOnce(&str) -> Result<(), E>) -> Result<(), OpenError> {
    let url = external_url(href).ok_or(OpenError::InvalidUrl)?;
    open(url.as_str()).map_err(|_| OpenError::HandlerUnavailable)
}

#[tauri::command]
pub(crate) async fn open_external_post_link<R: Runtime>(
    app: AppHandle<R>,
    href: String,
) -> Result<(), OpenError> {
    // The desktop opener waits for the system launcher to accept or reject the request.
    tauri::async_runtime::spawn_blocking(move || {
        dispatch(&href, |url| app.opener().open_url(url, None::<&str>))
    })
    .await
    .map_err(|_| OpenError::HandlerUnavailable)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_web_and_mail_links_to_the_system_once() {
        for href in [
            "https://example.test/a@b?next=%2Fmail%3Fx%3Dy#fragment",
            "http://[::1]:8300/a?q=@someone",
            "mailto:reader@example.test?subject=Hello%20Bear",
            "mailto:?subject=Hello",
            "mailto:reader+dev@example.test?%62ody=one%0d%0atwo&subject=note%2B1",
            "https://example.test/a%5Cb?encoded=%0D%0A#same",
        ] {
            let mut count = 0;
            let result = dispatch(href, |url| {
                count += 1;
                assert_eq!(url, href);
                Ok::<(), ()>(())
            });
            assert_eq!(result, Ok(()));
            assert_eq!(count, 1);
        }
    }

    #[test]
    fn rejects_unsupported_or_ambiguous_addresses_before_dispatch() {
        for href in [
            "",
            "/team/channels/town-square",
            "//example.test/path",
            "file:///example",
            "javascript:void(0)",
            "tel:+1234",
            "https:example.test",
            "https:/example.test",
            "https:////example.test",
            "https://",
            "http://?example.test",
            "https://@example.test",
            "https://u@example.test/a",
            "https://u:p@example.test#a",
            "https://example.test\\@another.test",
            "https://example.test/\nrest",
            " mailto:me@example.test",
            "mailto://example.test/u",
            "mailto:/recipient",
            "mailto:reader%0A@example.test",
            "mailto:reader@example.test?body=one%0atwo",
            "mailto:reader@example.test?body=one%0dtwo",
            "mailto:reader@example.test?bo%0ady=x",
            "mailto:reader@example.test?body=one%00two",
            "mailto:reader@example.test?body=one%0D%0Atwo&cc=team%0Aelse",
            "mailto:reader@example.test?subject=one%0D%0Atwo",
            "mailto:me@example.test?subject=a%0Db",
        ] {
            let result = dispatch(href, |_| -> Result<(), ()> {
                panic!("invalid URL reached handler")
            });
            assert_eq!(result, Err(OpenError::InvalidUrl));
        }
    }

    #[test]
    fn declines_without_forwarding_the_native_error_or_address() {
        let result = dispatch("https://example.test/", |_| Err("sensitive diagnostic"));
        assert_eq!(
            serde_json::to_value(result.unwrap_err()).unwrap(),
            "handler_unavailable"
        );
    }

    #[cfg(desktop)]
    #[test]
    fn only_the_local_main_webview_can_request_external_handoff() {
        use crate::ipc_test::{LOCAL, invoke, sibling};
        use serde_json::json;
        use tauri::{
            WebviewWindowBuilder, test::mock_builder, utils::config::AppDirectoriesOverride,
        };
        let dir = tempfile::tempdir().unwrap();
        let mut context = crate::context();
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(dir.path().into()));
        let app = crate::build(mock_builder(), context).unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let main = window.as_ref();
        // Invalid input never opens a real application, including if an ACL regresses.
        let args = json!({"href":"/local"});
        assert_eq!(
            invoke(main, "open_external_post_link", LOCAL, args.clone()).unwrap_err(),
            "invalid_url"
        );
        for (view, origin) in [
            (&sibling(main), LOCAL),
            (main, "https://remote.example.test"),
        ] {
            let error = invoke(view, "open_external_post_link", origin, args.clone()).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"));
        }
        let error = invoke(
            main,
            "plugin:opener|open_url",
            LOCAL,
            json!({"url": "invalid:"}),
        )
        .unwrap_err();
        assert!(error.as_str().unwrap().contains("not allowed"));
    }
}
