use crate::credentials::CredentialError;
use jni::errors::{Result as JniResult, ThrowRuntimeExAndDefault};
use jni::objects::{JByteArray, JObject, JString, JValue};
use jni::refs::Global;
use jni::{Env, EnvUnowned, JavaVM, jni_mangle, jni_sig, jni_str};
use std::sync::OnceLock;

static VAULT: OnceLock<Global<JObject<'static>>> = OnceLock::new();

#[jni_mangle("io.github.muxx.ummka.dev.UmmkaApplication")]
pub fn initialize_session_vault<'local>(
    mut env: EnvUnowned<'local>,
    _: JObject<'local>,
    vault: JObject<'local>,
) {
    env.with_env(|env| {
        let vault = env.new_global_ref(vault)?;
        VAULT.get_or_init(|| vault);
        Ok::<(), jni::errors::Error>(())
    })
    .resolve::<ThrowRuntimeExAndDefault>();
}

fn with_vault<T>(
    call: impl FnOnce(&mut Env, &JObject) -> JniResult<T>,
) -> Result<T, CredentialError> {
    let vault = VAULT.get().ok_or(CredentialError::StorageUnavailable)?;
    // attach_current_thread catches Java exceptions. Only the fixed store error leaves this boundary.
    JavaVM::singleton()
        .and_then(|vm| vm.attach_current_thread(|env| call(env, vault.as_obj())))
        .map_err(|_| CredentialError::StorageUnavailable)
}

pub(super) fn database_path() -> Result<String, CredentialError> {
    with_vault(|env, vault| {
        let value = env
            .call_method(
                vault,
                jni_str!("databasePath"),
                jni_sig!(() -> JString),
                &[],
            )?
            .l()?;
        JString::cast_local(env, value)?.try_to_string(env)
    })
}

pub(super) fn seal(aad: &[u8], token: &[u8], may_create: bool) -> Result<Vec<u8>, CredentialError> {
    with_vault(|env, vault| {
        let aad = env.byte_array_from_slice(aad)?;
        let token = env.byte_array_from_slice(token)?;
        let value = env
            .call_method(
                vault,
                jni_str!("seal"),
                jni_sig!(([byte], [byte], boolean) -> [byte]),
                &[
                    JValue::Object(aad.as_ref()),
                    JValue::Object(token.as_ref()),
                    JValue::Bool(may_create),
                ],
            )?
            .l()?;
        let bytes = JByteArray::cast_local(env, value)?;
        env.convert_byte_array(bytes)
    })
}

pub(super) fn open(aad: &[u8], sealed: &[u8]) -> Result<Option<Vec<u8>>, CredentialError> {
    with_vault(|env, vault| {
        let aad = env.byte_array_from_slice(aad)?;
        let sealed = env.byte_array_from_slice(sealed)?;
        let value = env
            .call_method(
                vault,
                jni_str!("open"),
                jni_sig!(([byte], [byte]) -> [byte]),
                &[
                    JValue::Object(aad.as_ref()),
                    JValue::Object(sealed.as_ref()),
                ],
            )?
            .l()?;
        if value.is_null() {
            return Ok(None);
        }
        let bytes = JByteArray::cast_local(env, value)?;
        env.convert_byte_array(bytes).map(Some)
    })
}
