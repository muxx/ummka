use super::*;
use objc2_foundation::NSURL;
use std::{fs, sync::Arc};
use tokio::io::AsyncReadExt;

#[tokio::test]
async fn selected_file_reopens_from_zero_and_rejects_a_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("план лето.txt");
    fs::write(&path, b"contents").unwrap();
    let url = NSURL::from_file_path(&path).unwrap();
    let source = SelectedDocument::from_panel_url(url).await.unwrap();
    assert_eq!(source.info().name, "план лето.txt");
    assert_eq!(source.info().size, Some(8));
    let mut first = source.open().await.unwrap();
    assert_eq!(first.read_u8().await.unwrap(), b'c');
    let mut second = source.open().await.unwrap();
    let mut all = vec![];
    second.read_to_end(&mut all).await.unwrap();
    assert_eq!(all, b"contents");
    fs::rename(&path, dir.path().join("previous.txt")).unwrap();
    assert!(source.open().await.is_err());
    fs::write(&path, b"unwanted").unwrap();
    assert!(source.open().await.is_err());
    drop(source);
    let mut rest = vec![];
    first.read_to_end(&mut rest).await.unwrap();
    assert_eq!(rest, b"ontents");
}

#[tokio::test]
async fn file_length_change_directory_and_remote_url_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let url = NSURL::from_directory_path(dir.path()).unwrap();
    assert!(SelectedDocument::from_panel_url(url).await.is_err());
    let url = NSURL::URLWithString(&objc2_foundation::NSString::from_str(
        "https://example.test/file",
    ))
    .unwrap();
    assert!(SelectedDocument::from_panel_url(url).await.is_err());
    let path = dir.path().join("report.txt");
    fs::write(&path, []).unwrap();
    let source: Arc<_> = SelectedDocument::from_panel_url(NSURL::from_file_path(&path).unwrap())
        .await
        .unwrap();
    assert_eq!(source.info().size, Some(0));
    fs::write(&path, b"now populated").unwrap();
    assert!(source.open().await.is_err());
}
