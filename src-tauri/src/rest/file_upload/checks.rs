use super::*;
use crate::native_http::NativeHttp;
use crate::sessions::fixture::{TestVault, using};
use reqwest::Method;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex, repeat};

type Check<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const USER: &str = "Abc01234567890123456789012";

fn upload<R>(reader: R, name: &str, length: Option<u64>) -> UploadFile<'_, R> {
    UploadFile {
        channel_id: "cccccccccccccccccccccccccc",
        name,
        reader,
        length,
        max_size: 4 * 1024 * 1024,
        mime_type: None,
        purpose: UploadPurpose::Post,
    }
}
fn progress() -> watch::Sender<UploadProgress> {
    watch::channel(UploadProgress::Reading(0)).0
}

async fn gate(client: &NativeHttp, root: &str, step: &str) -> Check {
    let request = Request::new(
        Method::GET,
        format!("{root}/file-upload-check/{step}").parse()?,
    );
    assert_eq!(client.send(request).await?.text().await?, "OK");
    Ok(())
}
#[cfg(any(target_os = "macos", target_os = "android"))]
async fn transfer_selection(owner: &RestConnection, cancel: &CancellationToken) -> Check {
    use crate::device_document::SelectedDocument;
    #[cfg(target_os = "macos")]
    let directory = tempfile::tempdir()?;
    #[cfg(target_os = "macos")]
    let selected = {
        let path = directory.path().join("облако.bin");
        std::fs::write(&path, b"hello")?;
        let url = objc2_foundation::NSURL::from_file_path(path).unwrap();
        SelectedDocument::from_panel_url(url).await?
    };
    #[cfg(target_os = "android")]
    let selected = SelectedDocument::from_picker_uri(
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/range".into(),
    )
    .await?;
    let reader = selected.open().await?;
    let length = reader.length;
    let info = selected.info();
    let mut file = upload(reader, &info.name, length);
    file.mime_type = info.mime_type.as_deref();
    let saved = owner.upload_file(file, cancel, progress()).await?;
    assert_eq!((saved.name.as_str(), saved.size), ("облако.bin", 5));
    Ok(())
}

pub(crate) async fn wire(client: &NativeHttp, root: &str) -> Check {
    let base = format!("{root}/Uploads%20Site//A%2FB");
    let accounts = using(Arc::new(TestVault::default()));
    accounts
        .activate(&base, USER, "upload-fixture-session")
        .await?;
    let public = RestConnection::with_client(&base, || Ok(client.clone()))?;
    let cancel = CancellationToken::new();
    assert_eq!(
        public
            .upload_file(
                upload(&b"abc"[..], "anon.txt", Some(3)),
                &cancel,
                progress()
            )
            .await,
        Err(FileUploadError::Transport(
            TransportError::SessionUnavailable
        ))
    );
    let owner = public.for_account(&accounts, USER).await?;
    let n = 2 * 1024 * 1024 + 17;
    let v = upload(repeat(0xa5).take(n), "план лето.bin", Some(n));
    let (tx, rx) = watch::channel(UploadProgress::Reading(0));
    let accepted = owner.upload_file(v, &cancel, tx).await?;
    assert_eq!(accepted.size, n);
    assert_eq!(*rx.borrow(), UploadProgress::Processing(n));

    #[cfg(any(target_os = "macos", target_os = "android"))]
    transfer_selection(&owner, &cancel).await?;

    for (name, length, expected) in [
        ("../device/file", Some(3), FileUploadError::InvalidFile),
        (
            "empty.txt",
            Some(0),
            FileUploadError::Source(SourceError::Empty),
        ),
        (
            "big.bin",
            Some(5 * 1024 * 1024),
            FileUploadError::Source(SourceError::TooLarge),
        ),
    ] {
        assert_eq!(
            owner
                .upload_file(upload(&b"abc"[..], name, length), &cancel, progress())
                .await,
            Err(expected)
        );
    }

    let mut oversized = upload(&b"x"[..], "oversized.bin", Some(u64::MAX));
    oversized.max_size = u64::MAX;
    assert_eq!(
        owner.upload_file(oversized, &cancel, progress()).await,
        Err(FileUploadError::Source(SourceError::TooLarge))
    );

    let (mut writer, reader) = duplex(8192);
    let (tx, rx) = watch::channel(UploadProgress::Reading(0));
    let stop = CancellationToken::new();
    let pending = owner.upload_file(upload(reader, "source.bin", None), &stop, tx);
    let other = async {
        writer.write_all(&vec![0x7e; 128 * 1024]).await?;
        gate(client, root, "reading").await?;
        assert!(matches!(*rx.borrow(),UploadProgress::Reading(bytes) if bytes > 0));
        let mut file = upload("✓".as_bytes(), "закладка.txt", None);
        file.purpose = UploadPurpose::Bookmark;
        file.mime_type = Some("text/plain");
        let saved = owner.upload_file(file, &cancel, progress()).await?;
        assert_eq!((saved.name.as_str(), saved.size), ("обработано.txt", 5));
        stop.cancel();
        assert!(writer.write_all(&vec![0x7e; 64 * 1024]).await.is_err());
        gate(client, root, "interrupted").await?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
    };
    let (interrupted, res) = tokio::join!(pending, other);
    assert_eq!(
        interrupted,
        Err(FileUploadError::Transport(
            TransportError::OperationInterrupted
        ))
    );
    res?;

    for (name, expected) in [
        ("wrong.txt", FileUploadError::InvalidReceipt),
        (
            "redirect.txt",
            FileUploadError::Transport(TransportError::Redirect),
        ),
    ] {
        assert_eq!(
            owner
                .upload_file(upload(&b"abc"[..], name, Some(3)), &cancel, progress())
                .await,
            Err(expected)
        );
    }
    let (tx, rx) = watch::channel(UploadProgress::Reading(0));
    let pending = owner.upload_file(upload(&b"abc"[..], "processing.txt", Some(3)), &cancel, tx);
    let retire = async {
        gate(client, root, "processing").await?;
        assert_eq!(*rx.borrow(), UploadProgress::Processing(3));
        accounts.forget(&base, USER).await?;
        gate(client, root, "retired").await?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
    };
    let (interrupted, res) = tokio::join!(pending, retire);
    assert!(matches!(
        interrupted,
        Err(FileUploadError::Transport(
            TransportError::SessionUnavailable | TransportError::OperationInterrupted
        ))
    ));
    res?;
    Ok(())
}
