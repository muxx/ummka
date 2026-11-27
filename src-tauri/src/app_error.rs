use reqwest::{Response, StatusCode};
use serde::Serialize;
use serde_json::Value;

const MAX_ERROR_BYTES: usize = 64 * 1024;

pub(crate) fn retention_marker(status: StatusCode, name: &str, value: &[u8]) -> bool {
    status == StatusCode::FORBIDDEN
        && matches!(
            name,
            "first-inaccessible-post-time" | "first-inaccessible-file-time"
        )
        && value == b"1"
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PublicError {
    pub status_code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

fn project(status: StatusCode, document: &[u8], sensitive: impl Fn(&[u8]) -> bool) -> PublicError {
    let parsed = serde_json::from_slice::<Value>(document).ok();
    let field = |key: &str| {
        parsed
            .as_ref()?
            .get(key)?
            .as_str()
            .filter(|s| !sensitive(s.as_bytes()))
            .map(str::to_owned)
    };
    PublicError {
        status_code: status.as_u16(),
        id: field("id"),
        message: field("message"),
        request_id: field("request_id"),
    }
}

pub(crate) async fn read(
    response: &mut Response,
    sensitive: impl Fn(&[u8]) -> bool,
) -> PublicError {
    let status = response.status();
    let document = crate::native_http::limited_body(response, MAX_ERROR_BYTES).await;
    project(status, document.as_deref().unwrap_or_default(), sensitive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::SessionToken;
    use serde_json::json;

    fn token() -> SessionToken {
        SessionToken::new("example-session-ABC123").unwrap()
    }

    #[test]
    fn projects_only_public_fields_and_scrubs_decoded_strings() {
        let document = br#"{"status_code":200,"id":"public.refused","message":"example\u002dsession-ABC123","request_id":"public-id","detailed_error":"internal information","other":{"text":"example-session-ABC123"}}"#;
        let bytes = serde_json::to_vec(&project(StatusCode::FORBIDDEN, document, |b| {
            token().appears_in(b)
        }))
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"status_code":403,"id":"public.refused","request_id":"public-id"})
        );
        assert!(!token().appears_in(&bytes));
        for body in [
            b"".as_slice(),
            b"[]",
            b"null",
            b"<html>proxy error</html>",
            b"{",
        ] {
            let bytes = serde_json::to_vec(&project(StatusCode::BAD_GATEWAY, body, |b| {
                token().appears_in(b)
            }))
            .unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&bytes).unwrap(),
                json!({"status_code":502})
            );
        }
        let body = br#"{"id":[1],"message":"Please try later","request_id":false}"#;
        let bytes = serde_json::to_vec(&project(StatusCode::TOO_MANY_REQUESTS, body, |b| {
            token().appears_in(b)
        }))
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"status_code":429,"message":"Please try later"})
        );
    }

    #[tokio::test]
    async fn honors_the_byte_limit_even_for_valid_json() {
        for (length, keep) in [(MAX_ERROR_BYTES, true), (MAX_ERROR_BYTES + 1, false)] {
            let mut body = br#"{"id":"refused"}"#.to_vec();
            body.resize(length, b' ');
            let mut response = Response::from(
                tauri::http::Response::builder()
                    .status(401)
                    .body(body)
                    .unwrap(),
            );
            let bytes =
                serde_json::to_vec(&read(&mut response, |b| token().appears_in(b)).await).unwrap();
            let expected = if keep {
                json!({"status_code":401,"id":"refused"})
            } else {
                json!({"status_code":401})
            };
            assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), expected);
        }
    }
}
