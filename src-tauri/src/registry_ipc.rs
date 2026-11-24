use crate::registry::{InstallationRegistry, RegistryError};
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "installations.sqlite";

async fn with_registry<R, T>(
    app: AppHandle<R>,
    operation: impl FnOnce(&InstallationRegistry) -> Result<T, RegistryError> + Send + 'static,
) -> Result<T, RegistryError>
where
    R: Runtime,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|_| RegistryError::Storage)?;
        std::fs::create_dir_all(&dir).map_err(|_| RegistryError::Storage)?;
        let registry = InstallationRegistry::open(&dir.join(FILE_NAME))?;
        operation(&registry)
    })
    .await
    .map_err(|_| RegistryError::Storage)?
}

#[tauri::command]
pub(crate) async fn list_installations<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<String>, RegistryError> {
    with_registry(app, InstallationRegistry::list).await
}

#[tauri::command]
pub(crate) async fn remember_installation<R: Runtime>(
    app: AppHandle<R>,
    server_url: String,
) -> Result<(), RegistryError> {
    with_registry(app, move |registry| registry.remember(&server_url)).await
}

#[tauri::command]
pub(crate) async fn forget_installation<R: Runtime>(
    app: AppHandle<R>,
    server_url: String,
) -> Result<(), RegistryError> {
    with_registry(app, move |registry| registry.forget(&server_url)).await
}

#[cfg(all(test, desktop))]
mod tests;
