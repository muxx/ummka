use super::*;
use jni::{
    EnvUnowned,
    errors::ThrowRuntimeExAndDefault,
    jni_mangle,
    objects::{JObject, JString},
};

pub(super) type Locator = String;
pub(super) async fn source(uri: Locator) -> Result<Arc<SelectedDocument>, DocumentUnavailable> {
    SelectedDocument::from_picker_uri(uri).await
}

pub(super) fn returned_documents(uris: &str) -> Result<Vec<PickedDocument>, PresentationError> {
    let uris: Vec<String> =
        serde_json::from_str(uris).map_err(|_| PresentationError::Unavailable)?;
    Ok(uris.into_iter().map(PickedDocument).collect())
}
pub(super) fn show<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    mode: SelectionMode,
) -> Result<(), PresentationError> {
    window
        .with_webview(move |view| {
            view.jni_handle().exec(move |env, activity, _| {
                if ACTIVE.waiting() != Some(id) {
                    return;
                }
                if activity.is_null() {
                    ACTIVE.deliver(id, Err(PresentationError::Cancelled));
                    return;
                }
                let mut start = || {
                    let request = env.new_string(id.to_string())?;
                    env.call_method(
                        activity,
                        "presentDocumentPicker",
                        "(Ljava/lang/String;Z)V",
                        &[(&request).into(), (mode == SelectionMode::Multiple).into()],
                    )
                    .map(|_| ())
                };
                if start().is_err() {
                    let _ = env.exception_clear();
                    ACTIVE.deliver(id, Err(PresentationError::Unavailable));
                }
            })
        })
        .map_err(|_| PresentationError::Unavailable)
}
pub(super) fn dismiss<R: Runtime>(app: &AppHandle<R>, id: Uuid) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |view| {
            view.jni_handle().exec(move |env, activity, _| {
                if activity.is_null() {
                    return;
                }
                let mut finish = || {
                    let request = env.new_string(id.to_string())?;
                    env.call_method(
                        activity,
                        "dismissDocumentPicker",
                        "(Ljava/lang/String;)V",
                        &[(&request).into()],
                    )
                    .map(|_| ())
                };
                if finish().is_err() {
                    let _ = env.exception_clear();
                }
            })
        });
    }
}

#[jni_mangle("io.github.muxx.ummka.dev.DocumentPicker")]
pub fn native_waiting<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    request: JString<'local>,
) -> bool {
    env.with_env(|env| {
        let id = Uuid::try_parse(&request.try_to_string(env)?).ok();
        Ok::<_, jni::errors::Error>(id.is_some_and(|id| ACTIVE.waiting() == Some(id)))
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}

#[jni_mangle("io.github.muxx.ummka.dev.DocumentPicker")]
pub fn native_result<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    request: JString<'local>,
    code: i32,
    uris: JString<'local>,
) {
    env.with_env(|env| {
        if let Ok(id) = Uuid::try_parse(&request.try_to_string(env)?)
            && ACTIVE.waiting() == Some(id)
        {
            let result = match code {
                0 => uris
                    .try_to_string(env)
                    .map_err(|_| PresentationError::Unavailable)
                    .and_then(|json| returned_documents(&json)),
                1 => Err(PresentationError::Cancelled),
                2 => Err(PresentationError::Busy),
                _ => Err(PresentationError::Unavailable),
            };
            ACTIVE.deliver(id, result);
        }
        Ok::<_, jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}
