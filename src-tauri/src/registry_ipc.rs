use crate::registry::{InstallationRegistry, InstallationSelection, RegistryError};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "installations.sqlite";

fn data_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, RegistryError> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| RegistryError::Storage)
}

async fn with_registry<R, T>(
    app: AppHandle<R>,
    operation: impl FnOnce(&InstallationRegistry) -> Result<T, RegistryError> + Send + 'static,
) -> Result<T, RegistryError>
where
    R: Runtime,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let dir = data_directory(&app)?;
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
    Ok(read_installation_selection(app).await?.installations)
}

#[tauri::command]
pub(crate) async fn read_installation_selection<R: Runtime>(
    app: AppHandle<R>,
) -> Result<InstallationSelection, RegistryError> {
    tauri::async_runtime::spawn_blocking(move || {
        InstallationRegistry::read_selection(&data_directory(&app)?.join(FILE_NAME))
    })
    .await
    .map_err(|_| RegistryError::Storage)?
}

#[tauri::command]
pub(crate) async fn connect_installation<R: Runtime>(
    app: AppHandle<R>,
    server_url: String,
) -> Result<(), RegistryError> {
    with_registry(app, move |registry| registry.connect(&server_url)).await
}

#[tauri::command]
pub(crate) async fn select_installation<R: Runtime>(
    app: AppHandle<R>,
    server_url: String,
) -> Result<(), RegistryError> {
    with_registry(app, move |registry| registry.select(&server_url)).await
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
