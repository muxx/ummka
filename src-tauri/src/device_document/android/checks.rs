use super::*;
use std::time::Duration;

async fn select(name: &str) -> Result<Arc<SelectedDocument>, DocumentUnavailable> {
    SelectedDocument::from_picker_uri(format!(
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/{name}"
    ))
    .await
}
async fn state(key: &str, expected: u64) {
    tokio::time::timeout(Duration::from_secs(6), async {
        loop {
            if select(key).await.unwrap().info().size == Some(expected) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(12)).await;
        }
    })
    .await
    .expect("document provider did not reach expected state");
}
pub(crate) async fn verify() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    assert!(
        SelectedDocument::from_picker_uri("file:///outside".to_owned())
            .await
            .is_err()
    );
    for (name, bytes, size) in [
        ("range", b"hello".as_slice(), Some(5)),
        ("stream", b"cloud".as_slice(), None),
        ("whole", b"PRIVATEhelloTRAILER".as_slice(), None),
    ] {
        let file = select(name).await?;
        assert_eq!(file.info().name, "облако.bin");
        assert_eq!(
            file.info().mime_type.as_deref(),
            Some("application/octet-stream")
        );
        assert_eq!(file.info().size, size);
        for _ in 0..2 {
            let mut reader = file.open().await?;
            assert_eq!(reader.length, size);
            let mut data = Vec::new();
            reader.read_to_end(&mut data).await?;
            assert_eq!(bytes, data);
        }
    }
    for key in ["failure", "short"] {
        assert!(
            select(key)
                .await?
                .open()
                .await?
                .read_to_end(&mut vec![])
                .await
                .is_err(),
            "{key}"
        );
    }
    assert!(select("absent").await?.open().await.is_err());
    let mut reader = select("paused").await?.open().await?;
    assert!(futures_util::poll!(Box::pin(reader.read_u8())).is_pending());
    drop(reader);
    state("pipe-closed", 1).await;
    let waiting = select("await-open").await?;
    let pending = tokio::spawn(async move { waiting.open().await });
    state("open-state", 1).await;
    pending.abort();
    assert!(pending.await.is_err());
    state("open-state", 2).await;
    Ok(())
}
