use pgl_core::{ServerInfo, SessionManager};
use serde::Deserialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::{now, AppState};
use crate::storage::models::{SavedConnection, StorageInfo};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDraft {
    #[serde(flatten)]
    pub connection: SavedConnection,
    /// Only present when the user typed a new password.
    #[serde(default)]
    pub password: Option<String>,
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> AppResult<Vec<SavedConnection>> {
    state.storage.connections()
}

#[tauri::command]
pub fn save_connection(
    state: State<'_, AppState>,
    draft: ConnectionDraft,
) -> AppResult<SavedConnection> {
    let mut connection = draft.connection;
    if connection.name.trim().is_empty() {
        return Err(AppError::invalid("give the connection a name"));
    }
    if connection.created_at.is_empty() {
        connection.created_at = now();
    }

    if let Some(password) = draft.password {
        if password.is_empty() {
            state.storage.secrets.remove(&connection.id)?;
        } else {
            state.storage.secrets.set(&connection.id, &password)?;
        }
    }

    let mut saved = state.storage.upsert_connection(connection)?;
    saved.has_password = state
        .storage
        .secrets
        .get(&saved.id)
        .ok()
        .flatten()
        .is_some();
    Ok(saved)
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.disconnect(&id).await;
    state.storage.delete_connection(&id)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    draft: ConnectionDraft,
) -> AppResult<ServerInfo> {
    let stored = state.storage.secrets.get(&draft.connection.id).ok().flatten();
    let password = draft.password.filter(|value| !value.is_empty()).or(stored);
    let target = draft.connection.to_target(password, None);
    Ok(SessionManager::probe(&target).await?)
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    id: String,
    database: Option<String>,
) -> AppResult<ServerInfo> {
    let connection = state.saved_connection(&id)?;
    let target = state.target_for(&connection, database.as_deref())?;
    let database = target.database.clone();

    state.sessions.register(target).await;
    let client = match state.client(&id, &database).await {
        Ok(client) => client,
        Err(error) => {
            state.sessions.disconnect(&id).await;
            return Err(error);
        }
    };

    let info = pgl_core::pool::server_info(&client).await?;
    state.storage.touch_connection(&id, now())?;
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_all(state: State<'_, AppState>) -> AppResult<()> {
    state.sessions.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn connected_ids(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let connections = state.storage.connections()?;
    let mut open = Vec::new();
    for connection in connections {
        if state.sessions.is_connected(&connection.id).await {
            open.push(connection.id);
        }
    }
    Ok(open)
}

#[tauri::command]
pub async fn storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    let settings = state.storage.settings()?;
    let directory = settings.binary_directory.clone();

    Ok(StorageInfo {
        config_directory: state.storage.directory().display().to_string(),
        secret_backend: state.storage.secrets.backend(),
        pg_dump_version: pgl_core::backup::tool_version(directory.as_deref(), "pg_dump").await,
        psql_version: pgl_core::backup::tool_version(directory.as_deref(), "psql").await,
    })
}
