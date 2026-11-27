//! Exercises the real DocumentsUI on the isolated test package, with input from the emulator driver.
use super::*;
use jni::{EnvUnowned, jni_mangle, objects::JObject};
use std::time::Duration;
use tokio::sync::Notify;

static START: Notify = Notify::const_new();
static CANCEL: Notify = Notify::const_new();
static REOPEN: Notify = Notify::const_new();
#[jni_mangle("io.github.muxx.ummka.dev.DocumentPickerSignal")]
pub fn signal(_: EnvUnowned<'_>, _: JObject<'_>, command: i32) {
    match command {
        0 => START.notify_one(),
        1 => CANCEL.notify_one(),
        2 => REOPEN.notify_one(),
        _ => (),
    }
}

async fn verify_private_provider() -> Result<(), &'static str> {
    let uris = serde_json::json!([
        "content://io.github.muxx.ummka.dev.httpcheck.fileprovider/my_cache_images/picker-private-canary.txt",
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/range",
        "content://0%40io.github.muxx.ummka.dev.httpcheck%2Efileprovider/my_cache_images/picker-private-canary.txt",
    ]);
    let items = platform::returned_documents(&uris.to_string()).map_err(|_| "mixed result")?;
    let [plain, neighbor, qualified] = items.try_into().map_err(|_| "mixed result count")?;
    if plain.into_source().await.is_ok() || qualified.into_source().await.is_ok() {
        return Err("private provider accepted");
    }
    let neighbor = neighbor
        .into_source()
        .await
        .map_err(|_| "mixed result neighbor")?;
    if neighbor.info().size != Some(5) {
        return Err("mixed result neighbor metadata");
    }
    Ok(())
}

pub(crate) async fn run<R: Runtime>(window: &WebviewWindow<R>) {
    let check = async {
        START.notified().await;
        verify_private_provider().await?;
        let owner = CancellationToken::new();
        super::selection_check::verify(window, &owner).await?;
        println!("UMMKA_PICKER_STAGE owner");
        let child = owner.child_token();
        let pending = pick(window, SelectionMode::One, &child);
        let stop = async {
            CANCEL.notified().await;
            if !matches!(
                pick(window, SelectionMode::One, &owner).await,
                Err(PresentationError::Busy)
            ) {
                return Err("second chooser");
            }
            child.cancel();
            Ok(())
        };
        let (result, stopped) = tokio::join!(pending, stop);
        stopped?;
        if !matches!(result, Err(PresentationError::Cancelled)) {
            return Err("owner cancellation");
        }
        println!("UMMKA_PICKER_STAGE waiting-to-reopen");
        REOPEN.notified().await;
        println!("UMMKA_PICKER_STAGE reopened");
        if !matches!(
            pick(window, SelectionMode::One, &owner).await,
            Err(PresentationError::Cancelled)
        ) {
            return Err("reopen after owner cancellation");
        }
        Ok(())
    };
    match tokio::time::timeout(Duration::from_secs(150), check).await {
        Ok(Ok(())) => println!("UMMKA_PICKER_STAGE checked"),
        Ok(Err(stage)) => println!("UMMKA_PICKER_STAGE failed {stage}"),
        Err(_) => println!("UMMKA_PICKER_STAGE failed timeout"),
    }
}
