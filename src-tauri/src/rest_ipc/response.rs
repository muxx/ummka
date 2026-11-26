use crate::app_error;
use crate::rest::TransportError;
use crate::sessions::{AccountSession, SessionToken, is_credential_header};
use reqwest::{Response, StatusCode};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResponseHead {
    status: u16,
    headers: Vec<(String, String)>,
    pub(super) has_body: bool,
}

pub(super) enum ResponseBody {
    Wire(Response),
    AccountError(Response, Arc<AccountSession>),
    End,
}

pub(super) fn split(
    response: Response,
    auth: Option<(&Arc<AccountSession>, &SessionToken)>,
) -> (ResponseHead, ResponseBody) {
    let status = response.status();
    let account_error = auth.is_some() && (status.is_client_error() || status.is_server_error());
    let mut headers = Vec::new();
    for (name, value) in response.headers() {
        let name = name.as_str();
        if is_credential_header(name)
            || auth.is_some_and(|(_, token)| token.appears_in(value.as_bytes()))
        {
            continue;
        }
        let retention_marker = app_error::retention_marker(status, name, value.as_bytes());
        if account_error
            && !retention_marker
            && !matches!(
                name,
                "www-authenticate"
                    | "retry-after"
                    | "x-request-id"
                    | "x-ratelimit-limit"
                    | "x-ratelimit-remaining"
                    | "x-ratelimit-reset"
            )
        {
            continue;
        }
        headers.push((
            name.to_owned(),
            value.as_bytes().iter().copied().map(char::from).collect(),
        ));
    }
    let body = match auth {
        Some((account, _)) if account_error => {
            headers.push(("content-type".into(), "application/json".into()));
            ResponseBody::AccountError(response, account.clone())
        }
        _ => ResponseBody::Wire(response),
    };
    let head = ResponseHead {
        status: status.as_u16(),
        headers,
        has_body: !matches!(
            status,
            StatusCode::NO_CONTENT | StatusCode::RESET_CONTENT | StatusCode::NOT_MODIFIED
        ),
    };
    (head, body)
}

impl ResponseBody {
    pub(super) async fn next(&mut self) -> Result<Vec<u8>, TransportError> {
        match self {
            Self::Wire(response) => loop {
                match response
                    .chunk()
                    .await
                    .map_err(|_| TransportError::Network)?
                {
                    Some(bytes) if bytes.is_empty() => continue,
                    Some(bytes) => return Ok(bytes.to_vec()),
                    None => return Ok(Vec::new()),
                }
            },
            Self::AccountError(response, account) => {
                let public = account
                    .dispatch(|token| async move {
                        Ok(app_error::read(response, |b| token.appears_in(b)).await)
                    })
                    .await?;
                *self = Self::End;
                Ok(serde_json::to_vec(&public)
                    .expect("public strings and HTTP status serialize as JSON"))
            }
            Self::End => Ok(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forwards_only_the_exact_retention_marker_on_a_signed_forbidden_response() {
        let sessions = crate::sessions::AccountSessions::default();
        let base = "https://chat.example.test";
        let user = "u".repeat(26);
        sessions
            .activate(base, &user, "synthetic-account")
            .await
            .unwrap();
        let account = sessions.restore(base, &user).await.unwrap();
        let token = SessionToken::new("synthetic-account").unwrap();
        for name in [
            "first-inaccessible-post-time",
            "first-inaccessible-file-time",
        ] {
            for (status, value, visible) in [
                (403, "1", true),
                (401, "1", false),
                (403, "0", false),
                (403, "synthetic-account", false),
            ] {
                let response = tauri::http::Response::builder()
                    .status(status)
                    .header(name, value)
                    .body(Vec::<u8>::new())
                    .unwrap();
                let (head, _) = split(Response::from(response), Some((&account, &token)));
                let marker = head.headers.iter().find(|(key, _)| key == name);
                assert_eq!(
                    marker.map(|(_, value)| value.as_str()),
                    visible.then_some("1")
                );
            }
        }
    }

    #[test]
    fn ipc_response_hides_all_values_of_session_headers() {
        let mut response = tauri::http::Response::builder()
            .status(401)
            .header("X-Request-Id", "request-1")
            .header("WWW-Authenticate", "Bearer");
        for name in [
            "Cookie",
            "Cookie2",
            "SeT-CoOkIe",
            "Set-Cookie2",
            "ToKeN",
            "Authorization",
            "Proxy-Authorization",
            "X-Cloud-Token",
            "X-RemoteCluster-Token",
        ] {
            response = response
                .header(name, "private-one")
                .header(name, "private-two");
        }
        let response = Response::from(response.body(Vec::<u8>::new()).unwrap());
        let head = serde_json::to_value(split(response, None).0).unwrap();
        let headers = head["headers"].as_array().unwrap();
        assert_eq!(headers.len(), 2);
        assert!(headers.contains(&serde_json::json!(["x-request-id", "request-1"])));
        assert!(headers.contains(&serde_json::json!(["www-authenticate", "Bearer"])));
        assert_eq!(head["status"], 401);
        assert_eq!(head["hasBody"], true);
    }
}
