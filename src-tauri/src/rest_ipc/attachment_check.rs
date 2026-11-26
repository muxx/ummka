use super::exchange::Session;
use crate::native_http::NativeHttp;
use crate::rest::file_transfer::{FileRepresentation::*, FileTransferError};
use crate::rest::{RestConnection, TransportError};
use crate::sessions::{
    AccountSessions,
    fixture::{TestVault, using},
};
use reqwest::{Method, Request};
use sha2::{Digest, Sha256};
use std::{
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tauri::Resource;
use tokio::io::{AsyncReadExt, AsyncWrite, duplex};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

type CheckResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const USER: &str = "Abc01234567890123456789012";

#[derive(Default)]
struct DigestWriter {
    hash: Sha256,
    writes: usize,
    flushed: bool,
    hold_flush: Option<oneshot::Sender<()>>,
    waiting: bool,
}

impl AsyncWrite for DigestWriter {
    fn poll_write(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.hash.update(bytes);
        self.writes += 1;
        Poll::Ready(Ok(bytes.len()))
    }
    fn poll_flush(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Some(signal) = self.hold_flush.take() {
            self.waiting = true;
            signal.send(()).unwrap();
        }
        if self.waiting {
            return Poll::Pending;
        }
        self.flushed = true;
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.poll_flush(cx)
    }
}

async fn checkpoint(client: &NativeHttp, base: &str, name: &str) -> CheckResult {
    let response = client
        .send(Request::new(
            Method::GET,
            format!("{base}/file-transfer-check/{name}").parse()?,
        ))
        .await?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await?, "OK");
    Ok(())
}

async fn signed(
    client: &NativeHttp,
    sessions: &AccountSessions,
    base: &str,
) -> CheckResult<Arc<Session>> {
    let connection = RestConnection::with_client(base, || Ok(client.clone()))?
        .for_account(sessions, USER)
        .await?;
    Ok(Arc::new(Session::new(connection)))
}

pub(crate) async fn wire(client: &NativeHttp, base: &str) -> CheckResult {
    let accounts = using(Arc::new(TestVault::default()));
    let address = format!("{base}/Files%20Site//A%2FB");
    let peer_address = format!("{base}/Peer%20Site//A%2FB");
    accounts
        .activate(&address, USER, "file-fixture-Files")
        .await?;
    accounts
        .activate(&peer_address, USER, "file-fixture-Peer")
        .await?;
    let peer = signed(client, &accounts, &peer_address).await?;
    let owner = signed(client, &accounts, &address).await?;
    let cancel = CancellationToken::new();
    let id = |letter: &str| letter.repeat(26);
    let anonymous = RestConnection::with_client(&address, || Ok(client.clone()))?;
    assert!(matches!(
        anonymous
            .write_attachment(&id("a"), Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::Transport(
            TransportError::SessionUnavailable
        ))
    ));
    assert!(matches!(
        owner
            .http
            .write_attachment("short", Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::Transport(
            TransportError::OperationDenied
        ))
    ));
    let (writer, size) = owner
        .http
        .write_attachment(&id("a"), Original, DigestWriter::default(), &cancel)
        .await?;
    assert!(writer.flushed && writer.writes > 1);
    assert_eq!(size, 2_097_169);
    assert_eq!(
        writer.hash.finalize().as_slice(),
        &[
            0xb0, 0x57, 0xf2, 0x6f, 0xaa, 0x65, 0x2e, 0x99, 0x16, 0xaa, 0x08, 0xee, 0xd7, 0xe5,
            0x09, 0x06, 0x15, 0x1f, 0x83, 0xde, 0x0e, 0x87, 0x81, 0x73, 0xe9, 0xd0, 0x6e, 0x35,
            0x9c, 0x0d, 0xd7, 0x5e
        ]
    );
    for (file, kind, expected) in [
        ("a", Thumbnail, &[255, 0, 2][..]),
        ("a", Preview, &[0, 1][..]),
        ("b", Original, &[][..]),
        ("c", Original, b"ab".as_slice()),
    ] {
        let (bytes, size) = owner
            .http
            .write_attachment(&id(file), kind, Vec::new(), &cancel)
            .await?;
        assert_eq!(bytes, expected);
        assert_eq!(size, expected.len() as u64);
    }
    assert!(matches!(
        owner
            .http
            .write_attachment(&id("d"), Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::UnexpectedStatus(206))
    ));
    let Err(FileTransferError::Server {
        error,
        history_limited: true,
    }) = owner
        .http
        .write_attachment(&id("e"), Original, Vec::new(), &cancel)
        .await
    else {
        panic!("expected a public retention error")
    };
    assert_eq!(error.status_code, 403);
    assert_eq!(error.id.as_deref(), Some("fixture.retention"));
    assert_eq!(error.message, None);
    assert_eq!(error.request_id.as_deref(), Some("file-403"));
    assert!(matches!(
        owner
            .http
            .write_attachment(&id("g"), Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::Transport(TransportError::Network))
    ));

    let opening = cancel.child_token();
    let held = id("h");
    let (result, observed) = tokio::join!(
        owner
            .http
            .write_attachment(&held, Original, Vec::new(), &opening),
        async {
            checkpoint(client, base, "headers").await?;
            opening.cancel();
            CheckResult::Ok(())
        }
    );
    observed?;
    assert!(matches!(
        result,
        Err(FileTransferError::Transport(
            TransportError::OperationInterrupted
        ))
    ));

    // The transfer is blocked in write_all even after one byte is drained.
    let (sink, mut reader) = duplex(1);
    let held = id("w");
    let (result, first) = tokio::join!(
        owner.http.write_attachment(&held, Original, sink, &cancel),
        async {
            let first = reader.read_u8().await?;
            owner.clone().close();
            io::Result::Ok(first)
        }
    );
    assert_eq!(first?, b'p');
    assert!(matches!(
        result,
        Err(FileTransferError::Transport(
            TransportError::OperationInterrupted
        ))
    ));
    let mut suffix = Vec::new();
    reader.read_to_end(&mut suffix).await?;
    assert!(suffix.len() <= 1);
    assert!(matches!(
        owner
            .http
            .write_attachment(&id("a"), Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::Transport(
            TransportError::OperationInterrupted
        ))
    ));
    let owner = signed(client, &accounts, &address).await?;

    let (flushing, blocked) = oneshot::channel();
    let writer = DigestWriter {
        hold_flush: Some(flushing),
        ..Default::default()
    };
    let flushing = cancel.child_token();
    let empty = id("b");
    let (result, ()) = tokio::join!(
        owner
            .http
            .write_attachment(&empty, Original, writer, &flushing),
        async {
            blocked.await.unwrap();
            flushing.cancel();
        }
    );
    assert!(matches!(
        result,
        Err(FileTransferError::Transport(
            TransportError::OperationInterrupted
        ))
    ));

    let (sink, mut reader) = duplex(16);
    let held = id("r");
    let (result, retired) = tokio::join!(
        owner.http.write_attachment(&held, Original, sink, &cancel),
        async {
            let mut prefix = [0u8; 7];
            reader.read_exact(&mut prefix).await?;
            assert_eq!(&prefix, b"partial");
            accounts.forget(&address, USER).await?;
            CheckResult::Ok(())
        }
    );
    retired?;
    assert!(matches!(
        result,
        Err(FileTransferError::Transport(
            TransportError::SessionUnavailable
        ))
    ));
    assert_eq!(reader.read(&mut [0u8; 1]).await?, 0);
    checkpoint(client, base, "closed").await?;
    assert!(matches!(
        owner
            .http
            .write_attachment(&empty, Original, Vec::new(), &cancel)
            .await,
        Err(FileTransferError::Transport(
            TransportError::SessionUnavailable
        ))
    ));
    assert_eq!(
        peer.http
            .write_attachment(&id("a"), Preview, Vec::new(), &cancel)
            .await?,
        (vec![0, 1], 2)
    );
    accounts
        .activate(&address, USER, "file-fixture-Files")
        .await?;
    let restored = signed(client, &accounts, &address).await?;
    assert_eq!(
        restored
            .http
            .write_attachment(&empty, Original, Vec::new(), &cancel)
            .await?,
        (vec![], 0)
    );
    Ok(())
}
