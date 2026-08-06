use pgl_core::backup::{BackupRequest, RestoreRequest, TransferOutcome};
use pgl_core::models::{
    ExportRequest, ImportOutcome, ImportPreview, ImportRequest, TransferProgress,
};
use pgl_core::{backup, export, import};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const PROGRESS_EVENT: &str = "transfer://progress";

#[tauri::command]
pub async fn export_rows(request: ExportRequest) -> AppResult<u64> {
    let rows = tauri::async_runtime::spawn_blocking(move || export::write(&request))
        .await
        .map_err(|error| AppError::invalid(error.to_string()))??;
    Ok(rows)
}

#[tauri::command]
pub async fn preview_import(
    path: String,
    has_header: bool,
    delimiter: Option<String>,
) -> AppResult<ImportPreview> {
    let preview = tauri::async_runtime::spawn_blocking(move || {
        import::preview(&path, has_header, delimiter.as_deref())
    })
    .await
    .map_err(|error| AppError::invalid(error.to_string()))??;
    Ok(preview)
}

#[tauri::command]
pub async fn import_rows(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: ImportRequest,
) -> AppResult<ImportOutcome> {
    let client = state.client(&connection_id, &database).await?;
    Ok(import::run(&client, &request).await?)
}

#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    request: BackupRequest,
    token: String,
) -> AppResult<TransferOutcome> {
    let connection = state.saved_connection(&connection_id)?;
    let mut target = state.target_for(&connection, Some(&request.database))?;
    target.database = request.database.clone();

    let total_tables = count_tables(&state, &connection_id, &request).await;
    let mut request = request;
    if request.binary_directory.is_none() {
        request.binary_directory = state.storage.settings()?.binary_directory;
    }

    let outcome = backup::dump(&target, &request, total_tables, &token, move |progress| {
        emit(&app, progress);
    })
    .await?;

    Ok(outcome)
}

#[tauri::command]
pub async fn restore_database(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    request: RestoreRequest,
    token: String,
) -> AppResult<TransferOutcome> {
    let connection = state.saved_connection(&connection_id)?;
    let mut target = state.target_for(&connection, Some(&request.database))?;
    target.database = request.database.clone();

    let mut request = request;
    if request.binary_directory.is_none() {
        request.binary_directory = state.storage.settings()?.binary_directory;
    }

    let outcome = backup::restore(&target, &request, &token, move |progress| {
        emit(&app, progress);
    })
    .await?;

    Ok(outcome)
}

fn emit(app: &AppHandle, progress: TransferProgress) {
    if let Err(error) = app.emit(PROGRESS_EVENT, progress) {
        eprintln!("failed to emit transfer progress: {error}");
    }
}

/// Ask the server how many tables the dump will touch so the progress bar can
/// show a real percentage rather than an indeterminate spinner.
async fn count_tables(
    state: &State<'_, AppState>,
    connection_id: &str,
    request: &BackupRequest,
) -> Option<u64> {
    if request.schema_only {
        return None;
    }
    let client = state.client(connection_id, &request.database).await.ok()?;
    let row = client
        .query_one(
            "SELECT count(*) FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND ($1::text[] = '{}' OR n.nspname = ANY($1))",
            &[&request.schemas],
        )
        .await
        .ok()?;
    let count: i64 = row.get(0);
    u64::try_from(count).ok()
}
