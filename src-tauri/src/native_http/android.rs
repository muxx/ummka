use super::TransportError;
use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JObject, JValue};
use jni::{EnvUnowned, JavaVM, jni_mangle, jni_sig, jni_str};
use std::sync::OnceLock;

pub(super) static ALLOW_APP_CLEARTEXT: OnceLock<bool> = OnceLock::new();

#[jni_mangle("io.github.muxx.ummka.dev.UmmkaApplication")]
pub fn initialize_http<'local>(
    mut env: EnvUnowned<'local>,
    app: JObject<'local>,
    allow_cleartext: bool,
) {
    env.with_env(|env| {
        rustls_platform_verifier::android::init_with_env(env, app)?;
        ALLOW_APP_CLEARTEXT.get_or_init(|| allow_cleartext);
        Ok::<(), jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}

pub(super) fn check_cleartext(host: &str) -> Result<(), TransportError> {
    // The verifier's Android config allows certain CA revocation endpoints.
    // Those exceptions do not authorize plaintext REST in a release build.
    if ALLOW_APP_CLEARTEXT.get() != Some(&true) {
        return Err(TransportError::CleartextDenied);
    }
    let permitted = JavaVM::singleton()
        .and_then(|vm| {
            vm.attach_current_thread(|env| {
                let policy = env
                    .call_static_method(
                        jni_str!("android/security/NetworkSecurityPolicy"),
                        jni_str!("getInstance"),
                        jni_sig!(() -> android.security.NetworkSecurityPolicy),
                        &[],
                    )?
                    .l()?;
                let host = env.new_string(host)?;
                env.call_method(
                    &policy,
                    jni_str!("isCleartextTrafficPermitted"),
                    jni_sig!((JString) -> jboolean),
                    &[JValue::Object(host.as_ref())],
                )?
                .z()
            })
        })
        .map_err(|_| TransportError::Network)?;
    if permitted {
        Ok(())
    } else {
        Err(TransportError::CleartextDenied)
    }
}
