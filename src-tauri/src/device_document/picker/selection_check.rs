//! Run with real documents returned by the system chooser in the native test fixture.
use super::*;
use crate::{draft_files, rest_ipc::close_rest_connection};
use tokio::io::AsyncReadExt;

pub(super) async fn verify<R: Runtime>(
    window: &WebviewWindow<R>,
    owner: &CancellationToken,
) -> Result<(), &'static str> {
    let view = window.as_ref();
    let connection = draft_files::fixture_connection(view).await?;
    let workspace = draft_files::open(view, connection).map_err(|_| "draft workspace")?;
    let draft =
        draft_files::DraftAddress::new("c".repeat(26), None).map_err(|_| "draft address")?;
    let size_limit = 1024;
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
        let results = draft_files::add(
            view,
            connection,
            workspace,
            &draft,
            size_limit,
            items.into_iter().map(PickedDocument::into_source),
        )
        .await
        .map_err(|_| "publish draft files")?;
        let visible = draft_files::list(view, connection, workspace, &draft)
            .map_err(|_| "list draft files")?;
        let mut names = Vec::new();
        for (index, result) in results.into_iter().enumerate() {
            let draft_files::AddResult::Added(file) = result else {
                return Err("document metadata");
            };
            if visible.get(index) != Some(&file) {
                return Err("draft file order");
            }
            let name = &file.document.name;
            if !expected.contains(&name.as_str()) {
                return Err("unexpected document name");
            }
            let mut content = String::new();
            // Read after dismissal: the file grant must outlive the chooser.
            draft_files::source(view, connection, workspace, &draft, file.id)
                .map_err(|_| "draft document source")?
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
            draft_files::remove(view, connection, workspace, &draft, file.id)
                .map_err(|_| "remove draft file")?;
            if draft_files::source(view, connection, workspace, &draft, file.id).is_ok() {
                return Err("removed draft file source survived");
            }
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
    #[cfg(target_os = "android")]
    verify_unknown_size(view, connection, workspace, &draft).await?;
    draft_files::close(view, connection, workspace).map_err(|_| "close draft workspace")?;
    close_rest_connection(view.clone(), connection).map_err(|_| "close draft connection")?;
    Ok(())
}

#[cfg(target_os = "android")]
async fn verify_unknown_size<R: Runtime>(
    view: &tauri::Webview<R>,
    connection: tauri::ResourceId,
    workspace: tauri::ResourceId,
    draft: &draft_files::DraftAddress,
) -> Result<(), &'static str> {
    let document = SelectedDocument::from_picker_uri(
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/stream".to_owned(),
    );
    let added = draft_files::add(view, connection, workspace, draft, 2, [document])
        .await
        .map_err(|_| "publish unknown-size draft file")?;
    let [draft_files::AddResult::Added(file)] = added.as_slice() else {
        return Err("unknown size rejected");
    };
    if file.document.size.is_some() {
        return Err("unknown size replaced");
    }
    let mut data = String::new();
    draft_files::source(view, connection, workspace, draft, file.id)
        .map_err(|_| "unknown-size draft file source")?
        .open()
        .await
        .map_err(|_| "unknown-size document access")?
        .read_to_string(&mut data)
        .await
        .map_err(|_| "unknown-size document contents")?;
    if data != "cloud" {
        return Err("unknown-size document bytes");
    }
    Ok(())
}
