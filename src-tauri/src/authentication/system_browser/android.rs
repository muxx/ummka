use super::{PRESENTATION, PresentationError};
use crate::authentication::browser::CALLBACK;
use jni::{
    EnvUnowned,
    errors::ThrowRuntimeExAndDefault,
    jni_mangle,
    objects::{JObject, JString},
};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use uuid::Uuid;

pub(super) async fn open<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    url: reqwest::Url,
) -> Result<(), PresentationError> {
    window
        .with_webview(move |view| {
            view.jni_handle().exec(move |env, activity, _| {
                if PRESENTATION.waiting() != Some(id) {
                    return;
                }
                let mut call = || {
                    let request = env.new_string(id.to_string())?;
                    let address = env.new_string(url.as_str())?;
                    let scheme = env.new_string(
                        CALLBACK
                            .split_once(':')
                            .expect("fixed absolute callback URL")
                            .0,
                    )?;
                    env.call_method(
                        activity,
                        "presentBrowserSignIn",
                        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                        &[(&request).into(), (&address).into(), (&scheme).into()],
                    )
                    .map(|_| ())
                };
                if call().is_err() {
                    let _ = env.exception_clear();
                    PRESENTATION.deliver(id, Err(PresentationError::Unavailable));
                }
            })
        })
        .map_err(|_| PresentationError::Unavailable)
}

pub(super) fn dismiss<R: Runtime>(app: &AppHandle<R>, id: Uuid) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |view| {
            view.jni_handle().exec(move |env, activity, _| {
                let mut call = || {
                    let request = env.new_string(id.to_string())?;
                    env.call_method(
                        activity,
                        "dismissBrowserSignIn",
                        "(Ljava/lang/String;)V",
                        &[(&request).into()],
                    )
                    .map(|_| ())
                };
                if call().is_err() {
                    let _ = env.exception_clear();
                }
            })
        });
    }
}

#[jni_mangle("io.github.muxx.ummka.dev.BrowserSignInActivity")]
pub fn native_is_waiting<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    request: JString<'local>,
) -> bool {
    env.with_env(|env| {
        let id = Uuid::try_parse(&request.try_to_string(env)?).ok();
        Ok::<_, jni::errors::Error>(id.is_some() && PRESENTATION.waiting() == id)
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}

#[jni_mangle("io.github.muxx.ummka.dev.BrowserSignInActivity")]
pub fn native_browser_result<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    request: JString<'local>,
    code: i32,
    url: JString<'local>,
) {
    env.with_env(|env| {
        if let Ok(id) = Uuid::try_parse(&request.try_to_string(env)?)
            && PRESENTATION.waiting() == Some(id)
        {
            let result = match code {
                0 if !url.is_null() => url
                    .try_to_string(env)
                    .map_err(|_| PresentationError::Unavailable),
                1 => Err(PresentationError::Cancelled),
                2 => Err(PresentationError::Unsupported),
                _ => Err(PresentationError::Unavailable),
            };
            PRESENTATION.deliver(id, result);
        }
        Ok::<_, jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}
