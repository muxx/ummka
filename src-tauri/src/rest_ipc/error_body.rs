use crate::sessions::SessionToken;
use reqwest::{Response, StatusCode};
use serde::Serialize;
use serde_json::Value;

const MAX_ERROR_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
struct PublicError<'a> {
    status_code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<&'a str>,
}

fn project(status: StatusCode, document: &[u8], token: &SessionToken) -> Vec<u8> {
    let parsed = serde_json::from_slice::<Value>(document).ok();
    let field = |key: &str| {
        parsed
            .as_ref()?
            .get(key)?
            .as_str()
            .filter(|s| !token.appears_in(s.as_bytes()))
    };
    let public = PublicError {
        status_code: status.as_u16(),
        id: field("id"),
        message: field("message"),
        request_id: field("request_id"),
    };
    serde_json::to_vec(&public).expect("public strings and HTTP status serialize as JSON")
}

pub(super) async fn read(response: &mut Response, token: &SessionToken) -> Vec<u8> {
    let status = response.status();
    let mut document = Vec::new();
    if response
        .content_length()
        .is_none_or(|len| len <= MAX_ERROR_BYTES as u64)
    {
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if chunk.len() <= MAX_ERROR_BYTES - document.len() => {
                    document.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                // An incomplete or oversized document cannot supply public fields.
                Ok(Some(_)) | Err(_) => return project(status, &[], token),
            }
        }
    }
    project(status, &document, token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn token() -> SessionToken {
        SessionToken::new("example-session-ABC123").unwrap()
    }

    #[test]
    fn projects_only_public_fields_and_scrubs_decoded_strings() {
        let document = br#"{"status_code":200,"id":"public.refused","message":"example\u002dsession-ABC123","request_id":"public-id","detailed_error":"internal information","other":{"text":"example-session-ABC123"}}"#;
        let bytes = project(StatusCode::FORBIDDEN, document, &token());
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
            let bytes = project(StatusCode::BAD_GATEWAY, body, &token());
            assert_eq!(
                serde_json::from_slice::<Value>(&bytes).unwrap(),
                json!({"status_code":502})
            );
        }
        let body = br#"{"id":[1],"message":"Please try later","request_id":false}"#;
        let bytes = project(StatusCode::TOO_MANY_REQUESTS, body, &token());
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
            let bytes = read(&mut response, &token()).await;
            let expected = if keep {
                json!({"status_code":401,"id":"refused"})
            } else {
                json!({"status_code":401})
            };
            assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), expected);
        }
    }
}
