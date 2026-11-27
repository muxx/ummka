use super::super::{DocumentInfo, DocumentUnavailable};
use jni::{
    Env, EnvUnowned, JavaVM,
    errors::{Result as JniResult, ThrowRuntimeExAndDefault},
    jni_mangle, jni_sig, jni_str,
    objects::{JObject, JString, JValue},
    refs::Global,
};
use std::{
    fs::File,
    io,
    os::fd::BorrowedFd,
    sync::{Arc, OnceLock},
};

type Object = Global<JObject<'static>>;
static RESOLVER: OnceLock<Object> = OnceLock::new();

#[jni_mangle("io.github.muxx.ummka.dev.UmmkaApplication")]
pub fn initialize_document_resolver<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    resolver: JObject<'local>,
) {
    env.with_env(|env| {
        let resolver = env.new_global_ref(resolver)?;
        RESOLVER.get_or_init(|| resolver);
        Ok::<_, jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}
fn jvm<T>(f: impl FnOnce(&mut Env) -> JniResult<T>) -> Result<T, DocumentUnavailable> {
    JavaVM::singleton()
        .and_then(|vm| vm.attach_current_thread(f))
        .map_err(|_| DocumentUnavailable)
}

struct NativeRequest(Object);
struct Pending(Option<Arc<NativeRequest>>);
impl Drop for Pending {
    fn drop(&mut self) {
        if let Some(request) = self.0.take() {
            // Android cancellation may itself call into the provider. Keep it off the UI thread.
            tauri::async_runtime::spawn_blocking(move || {
                let _ = jvm(|env| {
                    env.call_method(
                        request.0.as_obj(),
                        jni_str!("cancel"),
                        jni_sig!(() -> void),
                        &[],
                    )
                    .map(|_| ())
                });
            });
        }
    }
}

fn make_request(uri: &str) -> Result<Arc<NativeRequest>, DocumentUnavailable> {
    let resolver = RESOLVER.get().ok_or(DocumentUnavailable)?;
    let object = jvm(|env| {
        let raw = env.new_string(uri)?;
        let result = env
            .call_method(
                resolver,
                jni_str!("request"),
                jni_sig!((JString) -> io.github.muxx.ummka.dev.DocumentRequest),
                &[JValue::Object(raw.as_ref())],
            )?
            .l()?;
        env.new_global_ref(result)
    })?;
    Ok(Arc::new(NativeRequest(object)))
}

async fn request<T: Send + 'static>(
    uri: &str,
    work: impl FnOnce(Arc<NativeRequest>) -> Result<T, DocumentUnavailable> + Send + 'static,
) -> Result<T, DocumentUnavailable> {
    let request = make_request(uri)?;
    let mut pending = Pending(Some(request.clone()));
    let result = tokio::task::spawn_blocking(move || work(request))
        .await
        .map_err(|_| DocumentUnavailable)?;
    pending.0.take();
    result
}

pub(super) async fn describe(uri: &str) -> Result<DocumentInfo, DocumentUnavailable> {
    request(uri, |call| {
        let json = jvm(|env| {
            let text = env
                .call_method(
                    call.0.as_obj(),
                    jni_str!("describe"),
                    jni_sig!(() -> JString),
                    &[],
                )?
                .l()?;
            JString::cast_local(env, text)?.try_to_string(env)
        })?;
        serde_json::from_str(&json).map_err(|_| DocumentUnavailable)
    })
    .await
}

pub(super) struct Asset(Object);
impl Drop for Asset {
    fn drop(&mut self) {
        let _ = jvm(|env| {
            env.call_method(&self.0, jni_str!("close"), jni_sig!(() -> void), &[])
                .map(|_| ())
        });
    }
}
impl Asset {
    pub(super) fn check(&self) -> io::Result<()> {
        jvm(|env| {
            let pfd = env
                .call_method(
                    &self.0,
                    jni_str!("getParcelFileDescriptor"),
                    jni_sig!(() -> android.os.ParcelFileDescriptor),
                    &[],
                )?
                .l()?;
            env.call_method(pfd, jni_str!("checkError"), jni_sig!(() -> void), &[])
                .map(|_| ())
        })
        .map_err(io::Error::other)
    }
}
pub(super) async fn open(
    uri: &str,
) -> Result<(File, u64, Option<u64>, Asset), DocumentUnavailable> {
    request(uri, |call| {
        let asset = Asset(jvm(|env| {
            let asset = env
                .call_method(
                    call.0.as_obj(),
                    jni_str!("open"),
                    jni_sig!(() -> android.content.res.AssetFileDescriptor),
                    &[],
                )?
                .l()?;
            env.new_global_ref(asset)
        })?);
        let (raw, offset, length) = jvm(|env| {
            let pfd = env
                .call_method(
                    &asset.0,
                    jni_str!("getParcelFileDescriptor"),
                    jni_sig!(() -> android.os.ParcelFileDescriptor),
                    &[],
                )?
                .l()?;
            let fd = env
                .call_method(pfd, jni_str!("getFd"), jni_sig!(() -> int), &[])?
                .i()?;
            let offset = env
                .call_method(
                    &asset.0,
                    jni_str!("getStartOffset"),
                    jni_sig!(() -> long),
                    &[],
                )?
                .j()?;
            let length = env
                .call_method(
                    &asset.0,
                    jni_str!("getDeclaredLength"),
                    jni_sig!(() -> long),
                    &[],
                )?
                .j()?;
            Ok((fd, offset, length))
        })?;
        if raw < 0 || offset < 0 || length < -1 {
            return Err(DocumentUnavailable);
        }
        // The global AssetFileDescriptor remains open across this duplication and all reads.
        let fd = unsafe { BorrowedFd::borrow_raw(raw) }
            .try_clone_to_owned()
            .map_err(|_| DocumentUnavailable)?;
        Ok((
            File::from(fd),
            offset as u64,
            u64::try_from(length).ok(),
            asset,
        ))
    })
    .await
}
