//! Run with real documents returned by the system chooser in the native test fixture.
use super::*;
use tokio::io::AsyncReadExt;

pub(super) async fn verify<R: Runtime>(
    window: &WebviewWindow<R>,
    owner: &CancellationToken,
) -> Result<(), &'static str> {
    for (stage, mode, expected) in [
        ("one", SelectionMode::One, &["ummka-first.txt"][..]),
        (
            "many",
            SelectionMode::Multiple,
            &["ummka-first.txt", "ummka-second.txt"][..],
        ),
    ] {
        println!("UMMKA_PICKER_STAGE {stage}");
        let items = pick(window, mode, owner).await.map_err(|_| stage)?;
        let mut names = Vec::new();
        for item in items {
            let source = item.into_source().await.map_err(|_| "document metadata")?;
            let name = &source.info().name;
            if !expected.contains(&name.as_str()) {
                return Err("unexpected document name");
            }
            let mut content = String::new();
            // Read after dismissal: the file grant must outlive the chooser.
            source
                .open()
                .await
                .map_err(|_| "document access")?
                .read_to_string(&mut content)
                .await
                .map_err(|_| "document bytes")?;
            if content != *name {
                return Err("document contents");
            }
            names.push(name.clone());
        }
        names.sort();
        if names != expected {
            return Err("selected documents");
        }
    }
    println!("UMMKA_PICKER_STAGE back");
    if !matches!(
        pick(window, SelectionMode::One, owner).await,
        Err(PresentationError::Cancelled)
    ) {
        return Err("system back");
    }
    Ok(())
}
