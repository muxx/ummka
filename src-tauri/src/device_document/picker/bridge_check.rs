use super::*;
use std::sync::Mutex;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Choice {
    Pair,
    Retry,
    Denied,
    HeldUpload,
    Cancel,
    HeldPicker,
}

static NEXT: Mutex<Option<Choice>> = Mutex::new(None);

#[tauri::command]
pub(crate) fn prepare_draft_picker_fixture(choice: Choice) -> Result<(), PresentationError> {
    let mut next = NEXT.lock().unwrap();
    if next.is_some() {
        return Err(PresentationError::Busy);
    }
    *next = Some(choice);
    Ok(())
}

pub(super) fn show<R: Runtime>(
    _: &WebviewWindow<R>,
    id: Uuid,
    _: SelectionMode,
) -> Result<(), PresentationError> {
    let choice = NEXT
        .lock()
        .unwrap()
        .take()
        .ok_or(PresentationError::Unavailable)?;
    let files: &[&str] = match choice {
        Choice::Pair => &["bridge-slow", "bridge-fast"],
        Choice::Retry => &["bridge-retry"],
        Choice::Denied => &["bridge-denied"],
        Choice::HeldUpload => &["bridge-hold"],
        Choice::Cancel => {
            ACTIVE.deliver(id, Err(PresentationError::Cancelled));
            return Ok(());
        }
        Choice::HeldPicker => return Ok(()),
    };
    let selected = files.iter().map(|name| document(name)).collect();
    ACTIVE.deliver(id, selected);
    Ok(())
}

#[cfg(target_os = "macos")]
fn document(name: &str) -> Result<PickedDocument, PresentationError> {
    use objc2_foundation::NSURL;
    use std::path::PathBuf;

    let certificate = PathBuf::from(
        std::env::var_os("UMMKA_HTTP_TEST_CA").ok_or(PresentationError::Unavailable)?,
    );
    let path = certificate
        .parent()
        .ok_or(PresentationError::Unavailable)?
        .join(format!("{name}.txt"));
    std::fs::write(&path, name).map_err(|_| PresentationError::Unavailable)?;
    let url = NSURL::from_file_path(&path).ok_or(PresentationError::Unavailable)?;
    Ok(PickedDocument(url))
}

#[cfg(target_os = "android")]
fn document(name: &str) -> Result<PickedDocument, PresentationError> {
    Ok(PickedDocument(format!(
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/draft-{name}"
    )))
}
