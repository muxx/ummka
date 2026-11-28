//! The OS chooser returns one native reference per selected item. A caller may inspect the
//! items independently, even when a provider cannot describe one of the documents.
use super::{DocumentUnavailable, SelectedDocument};
pub use crate::system_presentation::PresentationError;
use crate::system_presentation::Presentations;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[cfg(target_os = "macos")]
#[path = "picker/macos.rs"]
mod platform;
#[cfg(target_os = "android")]
#[path = "picker/android.rs"]
mod platform;

#[cfg(all(target_os = "android", feature = "webview-check"))]
pub(crate) mod android_check;

#[cfg(all(target_os = "macos", feature = "webview-check"))]
pub(crate) mod mac_check;

#[cfg(feature = "webview-check")]
pub(crate) mod bridge_check;
#[cfg(feature = "webview-check")]
mod selection_check;

pub struct PickedDocument(platform::Locator);
impl PickedDocument {
    pub async fn into_source(self) -> Result<Arc<SelectedDocument>, DocumentUnavailable> {
        platform::source(self.0).await
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum SelectionMode {
    One,
    Multiple,
}
impl SelectionMode {
    fn validate<T>(self, items: Vec<T>) -> Result<Vec<T>, PresentationError> {
        if items.is_empty() || (self == Self::One && items.len() != 1) {
            Err(PresentationError::Unavailable)
        } else {
            Ok(items)
        }
    }
}

static ACTIVE: Presentations<Vec<PickedDocument>> = Presentations::new();

struct Request<R: Runtime> {
    app: AppHandle<R>,
    id: Uuid,
}
impl<R: Runtime> Drop for Request<R> {
    fn drop(&mut self) {
        if ACTIVE.release(self.id) {
            platform::dismiss(&self.app, self.id);
        }
    }
}
pub(crate) fn owner_closed<R: Runtime>(app: &AppHandle<R>) {
    if let Some(id) = ACTIVE.waiting()
        && ACTIVE.deliver(id, Err(PresentationError::Cancelled))
    {
        platform::dismiss(app, id);
    }
}

pub async fn pick<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: SelectionMode,
    owner: &CancellationToken,
) -> Result<Vec<PickedDocument>, PresentationError> {
    pick_with(window, mode, owner, platform::show).await
}

pub(crate) async fn pick_for_draft_files<R: Runtime>(
    window: &WebviewWindow<R>,
    owner: &CancellationToken,
) -> Result<Vec<PickedDocument>, PresentationError> {
    #[cfg(feature = "webview-check")]
    let show = bridge_check::show;
    #[cfg(not(feature = "webview-check"))]
    let show = platform::show;
    pick_with(window, SelectionMode::Multiple, owner, show).await
}

async fn pick_with<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: SelectionMode,
    owner: &CancellationToken,
    show: impl FnOnce(&WebviewWindow<R>, Uuid, SelectionMode) -> Result<(), PresentationError>,
) -> Result<Vec<PickedDocument>, PresentationError> {
    if window.label() != "main" {
        return Err(PresentationError::Unavailable);
    }
    if owner.is_cancelled() {
        return Err(PresentationError::Cancelled);
    }
    let (id, result) = ACTIVE.reserve()?;
    let _request = Request {
        app: window.app_handle().clone(),
        id,
    };
    show(window, id, mode)?;
    tokio::select! {
        biased;
        _ = owner.cancelled() => Err(PresentationError::Cancelled),
        items = result => mode.validate(items.map_err(|_| PresentationError::Unavailable)??),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_single_choice_results_must_match_the_request() {
        assert_eq!(
            SelectionMode::One.validate(Vec::<u8>::new()),
            Err(PresentationError::Unavailable)
        );
        assert_eq!(
            SelectionMode::One.validate(vec![1, 2]),
            Err(PresentationError::Unavailable)
        );
        assert_eq!(SelectionMode::One.validate(vec![7]), Ok(vec![7]));
        assert_eq!(
            SelectionMode::Multiple.validate(vec![3, 1, 2]),
            Ok(vec![3, 1, 2])
        );
    }
}
