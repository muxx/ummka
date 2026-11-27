//! Runs only in the disposable WKWebView fixture.
use super::*;
use std::time::Duration;

pub(crate) fn run<R: Runtime>(window: WebviewWindow<R>, manual: bool) {
    tauri::async_runtime::spawn(async move {
        let check = async {
            let owner = CancellationToken::new();
            if manual {
                super::selection_check::verify(&window, &owner).await?;
            }
            for mode in [SelectionMode::One, SelectionMode::Multiple] {
                let lifetime = owner.child_token();
                let picker = pick(&window, mode, &lifetime);
                let inspect = async {
                    wait_for_sheet(&window, Some(mode)).await?;
                    if !matches!(
                        pick(&window, SelectionMode::One, &owner).await,
                        Err(PresentationError::Busy)
                    ) {
                        return Err("duplicate sheet");
                    }
                    match mode {
                        SelectionMode::One => {
                            let id = ACTIVE.waiting().ok_or("missing active sheet")?;
                            platform::dismiss(window.app_handle(), id);
                        }
                        SelectionMode::Multiple => lifetime.cancel(),
                    }
                    Ok(())
                };
                tokio::try_join!(expect_cancel(picker), inspect)?;
                wait_for_sheet(&window, None).await?;
            }
            let picker = pick(&window, SelectionMode::One, &owner);
            let close = async {
                wait_for_sheet(&window, Some(SelectionMode::One)).await?;
                window.destroy().map_err(|_| "destroy owner")
            };
            tokio::try_join!(expect_cancel(picker), close).map(|_| ())
        };
        let result = tokio::time::timeout(Duration::from_secs(90), check).await;
        let success = matches!(result, Ok(Ok(())));
        if success {
            println!("UMMKA_PICKER_STAGE checked");
        } else {
            eprintln!("Document picker check failed: {result:?}");
        }
        window.app_handle().exit(i32::from(!success));
    });
}

async fn expect_cancel(
    picker: impl Future<Output = Result<Vec<PickedDocument>, PresentationError>>,
) -> Result<(), &'static str> {
    if matches!(picker.await, Err(PresentationError::Cancelled)) {
        Ok(())
    } else {
        Err("picker did not return cancellation")
    }
}

async fn wait_for_sheet<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: Option<SelectionMode>,
) -> Result<(), &'static str> {
    loop {
        if platform::sheet_matches(window, mode).await? {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
