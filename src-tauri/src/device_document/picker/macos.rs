use super::*;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel, NSWindow};
use objc2_foundation::{MainThreadMarker, NSURL};
use std::cell::RefCell;

pub(super) type Locator = Retained<NSURL>;
pub(super) async fn source(url: Locator) -> Result<Arc<SelectedDocument>, DocumentUnavailable> {
    SelectedDocument::from_panel_url(url).await
}
thread_local! {
    static DISPLAYED: RefCell<Option<(Uuid,Retained<NSOpenPanel>)>> = const { RefCell::new(None) };
}
pub(super) fn show<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    mode: SelectionMode,
) -> Result<(), PresentationError> {
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            if ACTIVE.waiting() != Some(id) {
                return;
            }
            let start = || {
                let marker = MainThreadMarker::new().ok_or(PresentationError::Unavailable)?;
                let raw = owner
                    .ns_window()
                    .map_err(|_| PresentationError::Unavailable)?;
                // The Tauri window owns this NSWindow for the duration of this main-thread call.
                let native = unsafe { Retained::retain(raw.cast::<NSWindow>()) }
                    .ok_or(PresentationError::Unavailable)?;
                if DISPLAYED.with_borrow(Option::is_some) || native.attachedSheet().is_some() {
                    return Err(PresentationError::Busy);
                }
                let panel = NSOpenPanel::openPanel(marker);
                panel.setCanChooseDirectories(false);
                panel.setCanChooseFiles(true);
                panel.setAllowsMultipleSelection(mode == SelectionMode::Multiple);
                DISPLAYED.with_borrow_mut(|slot| *slot = Some((id, panel.clone())));
                let completion = RcBlock::new(move |response| {
                    let previous =
                        DISPLAYED.with_borrow_mut(|slot| slot.take_if(|(active, _)| *active == id));
                    if let Some((_, panel)) = previous {
                        let result = if response == NSModalResponseOK {
                            Ok(panel
                                .URLs()
                                .to_vec()
                                .into_iter()
                                .map(PickedDocument)
                                .collect())
                        } else if response == NSModalResponseCancel {
                            Err(PresentationError::Cancelled)
                        } else {
                            Err(PresentationError::Unavailable)
                        };
                        panel.orderOut(None);
                        ACTIVE.deliver(id, result);
                    }
                });
                panel.beginSheetModalForWindow_completionHandler(&native, &completion);
                Ok(())
            };
            if let Err(error) = start() {
                ACTIVE.deliver(id, Err(error));
            }
        })
        .map_err(|_| PresentationError::Unavailable)
}
pub(super) fn dismiss<R: Runtime>(app: &AppHandle<R>, id: Uuid) {
    let _ = app.run_on_main_thread(move || {
        let panel = DISPLAYED.with_borrow(|slot| {
            slot.as_ref()
                .filter(|(active, _)| *active == id)
                .map(|(_, p)| p.clone())
        });
        if let Some(panel) = panel {
            // AppKit dispatches the sheet's completion on dismissal; no other panel is closed.
            unsafe { panel.cancel(None) };
        }
    });
}

#[cfg(feature = "webview-check")]
pub(super) async fn sheet_matches<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: Option<SelectionMode>,
) -> Result<bool, &'static str> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let result = owner
                .ns_window()
                .map_err(|_| "native window")
                .and_then(|raw| {
                    // This check reads only the test window and the sheet created for it.
                    let window = unsafe { &*raw.cast::<NSWindow>() };
                    DISPLAYED.with_borrow(|slot| match (window.attachedSheet(), slot) {
                        (None, None) => Ok(mode.is_none()),
                        (None, Some(_)) => Ok(false),
                        (Some(_), None) if mode.is_none() => Ok(false),
                        (Some(sheet), Some((_, panel)))
                            if Retained::as_ptr(&sheet)
                                == Retained::as_ptr(panel).cast::<NSWindow>()
                                && panel.canChooseFiles()
                                && !panel.canChooseDirectories() =>
                        {
                            match mode {
                                None => Ok(false),
                                Some(expected)
                                    if panel.allowsMultipleSelection()
                                        == (expected == SelectionMode::Multiple) =>
                                {
                                    Ok(true)
                                }
                                Some(_) => Err("wrong selection mode"),
                            }
                        }
                        _ => Err("unexpected attached sheet"),
                    })
                });
            let _ = tx.send(result);
        })
        .map_err(|_| "main thread")?;
    rx.await.map_err(|_| "window destroyed")?
}
