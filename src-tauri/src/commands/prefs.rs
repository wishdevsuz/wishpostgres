use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::{new_id, now, AppState};
use crate::storage::models::{AppSettings, HistoryEntry, SavedQuery, Workspace};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.storage.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> AppResult<AppSettings> {
    if settings.rows_per_page == 0 || settings.rows_per_page > 10_000 {
        return Err(AppError::invalid(
            "rows per page must be between 1 and 10000",
        ));
    }
    state.storage.save_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.storage.reset_settings()
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> AppResult<Workspace> {
    state.storage.workspace()
}

#[tauri::command]
pub fn save_workspace(state: State<'_, AppState>, workspace: Workspace) -> AppResult<()> {
    state.storage.save_workspace(&workspace)
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> AppResult<Vec<HistoryEntry>> {
    state.storage.history()
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> AppResult<()> {
    state.storage.clear_history()
}

#[tauri::command]
pub fn list_saved_queries(state: State<'_, AppState>) -> AppResult<Vec<SavedQuery>> {
    state.storage.saved_queries()
}

#[tauri::command]
pub fn save_query(state: State<'_, AppState>, query: SavedQuery) -> AppResult<SavedQuery> {
    if query.name.trim().is_empty() {
        return Err(AppError::invalid("give the query a name"));
    }

    let mut query = query;
    if query.id.is_empty() {
        query.id = new_id();
        query.created_at = now();
    }
    query.updated_at = now();
    state.storage.upsert_query(query)
}

#[tauri::command]
pub fn delete_saved_query(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.storage.delete_query(&id)
}
