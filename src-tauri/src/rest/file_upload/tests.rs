use super::*;
use serde_json::json;
use std::{
    io::Cursor,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::ReadBuf;

struct Broken;
impl AsyncRead for Broken {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        _: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Poll::Ready(Err(io::ErrorKind::PermissionDenied.into()))
    }
}

#[tokio::test]
async fn source_length_limit_and_device_errors_survive_body_streaming() {
    for (data, len, limit, expected) in [
        (&b""[..], None, 9, SourceError::Empty),
        (&b"abc"[..], None, 2, SourceError::TooLarge),
        (&b"abc"[..], Some(2), 9, SourceError::LengthChanged),
        (&b"abc"[..], Some(4), 9, SourceError::LengthChanged),
    ] {
        let (tx, progress) = watch::channel(UploadProgress::Reading(0));
        let (body, answer) =
            stream_file(Cursor::new(data), len, limit, CancellationToken::new(), tx);
        let response = Response::from(tauri::http::Response::new(body));
        assert!(response.bytes().await.is_err());
        assert_eq!(answer.await.unwrap(), Err(expected));
        assert!(!matches!(*progress.borrow(), UploadProgress::Processing(_)));
    }
    let (tx, _) = watch::channel(UploadProgress::Reading(0));
    let (body, answer) = stream_file(Broken, None, 9, CancellationToken::new(), tx);
    assert!(
        Response::from(tauri::http::Response::new(body))
            .bytes()
            .await
            .is_err()
    );
    assert_eq!(answer.await.unwrap(), Err(SourceError::Unreadable));
}

#[test]
fn receipt_belongs_to_one_attempt_channel_and_unattached_owner() {
    let token = SessionToken::new("fixture-secret").unwrap();
    let id = "f".repeat(26);
    let file =
        json!({"id":id, "channel_id":"room", "user_id":"user","size":1985,"name":"план.pdf"});
    let parse = |wire: &Value| {
        parse_receipt(
            &serde_json::to_vec(wire).unwrap(),
            &token,
            "attempt",
            "room",
            "user",
        )
    };
    let valid = json!({"client_ids":["attempt"], "file_infos":[file]});
    let accepted = parse(&valid).unwrap();
    assert_eq!(
        (accepted.id, accepted.size, accepted.name),
        (id, 1985, "план.pdf".into())
    );
    for (field, bad) in [
        ("id", json!("short")),
        ("size", json!(-1)),
        ("size", json!("2")),
        ("post_id", json!("attached")),
        ("name", json!("fixture-secret.pdf")),
        ("name", json!("../dir/file")),
        ("user_id", json!("bookmark")),
        ("channel_id", json!("elsewhere")),
    ] {
        let mut wrong = valid.clone();
        wrong["file_infos"][0][field] = bad;
        assert!(parse(&wrong).is_none(), "{field}");
    }
    for bad in [
        json!({"client_ids":["other"],"file_infos":[file]}),
        json!({"client_ids":["attempt","attempt"],"file_infos":[file]}),
        json!({"client_ids":["attempt"],"file_infos":[file,file]}),
        json!({"client_ids":["attempt"],"file_infos":[]}),
        json!([["attempt"], [file]]),
    ] {
        assert!(parse(&bad).is_none());
    }
}

#[tokio::test]
async fn no_early_or_oversized_receipt_and_only_public_server_errors() {
    let token = SessionToken::new("fixture-secret").unwrap();
    for (status, completed, raw, expected) in [
        (201, false, b"{}".to_vec(), FileUploadError::InvalidReceipt),
        (
            201,
            true,
            vec![b' '; 1024 * 1024 + 1],
            FileUploadError::InvalidReceipt,
        ),
        (200, true, vec![], FileUploadError::UnexpectedStatus(200)),
    ] {
        let r = tauri::http::Response::builder()
            .status(status)
            .body(raw)
            .unwrap();
        assert_eq!(
            read_receipt(r.into(), &token, "attempt", "room", "user", completed).await,
            Err(expected)
        );
    }
    let r = tauri::http::Response::builder()
        .status(413)
        .body(
            br#"{"id":"too.large","message":"fixture-secret","detailed_error":"internal"}"#
                .as_slice(),
        )
        .unwrap();
    let Err(FileUploadError::Server(err)) =
        read_receipt(r.into(), &token, "x", "room", "u", false).await
    else {
        panic!("expected public error")
    };
    assert_eq!(err.status_code, 413);
    assert_eq!(err.id.as_deref(), Some("too.large"));
    assert_eq!(err.message, None);
}
