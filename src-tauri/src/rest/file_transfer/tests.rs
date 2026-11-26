use super::*;
use std::{
    pin::Pin,
    task::{Context, Poll},
};

struct RejectDestination {
    at_flush: bool,
}

impl AsyncWrite for RejectDestination {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Poll::Ready(if self.at_flush {
            Ok(data.len())
        } else {
            Err(io::ErrorKind::BrokenPipe.into())
        })
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        assert!(self.at_flush, "flushed after failed write");
        Poll::Ready(Err(io::ErrorKind::StorageFull.into()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        panic!("the owner retains the flushed destination")
    }
}

#[tokio::test]
async fn write_and_flush_errors_return_no_destination() {
    let token = SessionToken::new("file-fixture").unwrap();
    for (at_flush, expected) in [
        (false, io::ErrorKind::BrokenPipe),
        (true, io::ErrorKind::StorageFull),
    ] {
        let response = tauri::http::Response::builder()
            .status(200)
            .body(b"bytes".as_slice())
            .unwrap();
        let result = write_response(
            Response::from(response),
            &token,
            RejectDestination { at_flush },
        )
        .await;
        assert!(
            matches!(result, Err(FileTransferError::Destination(error)) if error.kind() == expected)
        );
    }
}

#[tokio::test]
async fn using_only_the_exact_file_retention_marker_and_public_error_fields() {
    let token = SessionToken::new("file-fixture").unwrap();
    for (status, name, value, limited) in [
        (403, "first-inaccessible-file-time", "1", true),
        (403, "first-inaccessible-file-time", "0", false),
        (403, "first-inaccessible-post-time", "1", false),
        (503, "first-inaccessible-file-time", "1", false),
    ] {
        let response = tauri::http::Response::builder()
            .status(status)
            .header(name, value)
            .body(
                br#"{"id":"file.denied","message":"file-fixture","detailed_error":"private"}"#
                    .as_slice(),
            )
            .unwrap();
        let Err(FileTransferError::Server {
            error,
            history_limited,
        }) = write_response(Response::from(response), &token, Vec::new()).await
        else {
            panic!("expected a projected public HTTP error");
        };
        assert_eq!(history_limited, limited);
        assert_eq!(error.status_code, status);
        assert_eq!(error.id.as_deref(), Some("file.denied"));
        assert_eq!(error.message, None);
    }
}
