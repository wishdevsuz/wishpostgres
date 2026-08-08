use pgl_core::ddl::{AddColumnRequest, AlterColumnRequest};
use pgl_core::models::*;
use pgl_core::{data, ddl};
use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn browse_table(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: BrowseRequest,
) -> AppResult<BrowseResult> {
    let client = state.client(&connection_id, &database).await?;
    Ok(data::browse(&client, &request).await?)
}

#[tauri::command]
pub async fn update_cell(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    change: RowChange,
) -> AppResult<u64> {
    let client = state.client(&connection_id, &database).await?;
    Ok(data::update_cell(&client, &change).await?)
}

#[tauri::command]
pub async fn insert_row(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: InsertRequest,
) -> AppResult<u64> {
    let client = state.client(&connection_id, &database).await?;
    Ok(data::insert_row(&client, &request).await?)
}

#[tauri::command]
pub async fn delete_rows(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: DeleteRequest,
) -> AppResult<u64> {
    let client = state.client(&connection_id, &database).await?;
    Ok(data::delete_rows(&client, &request).await?)
}

#[tauri::command]
pub async fn add_column(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: AddColumnRequest,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::add_column(&client, &request).await?)
}

#[tauri::command]
pub async fn alter_column(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    request: AlterColumnRequest,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::alter_column(&client, &request).await?)
}

#[tauri::command]
pub async fn rename_relation(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    new_name: String,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::rename_relation(&client, &schema, &table, &new_name).await?)
}

#[tauri::command]
pub async fn truncate_table(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::truncate_table(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn set_extension(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    name: String,
    action: String,
) -> AppResult<String> {
    let action: ddl::ExtensionAction = action.parse()?;
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::set_extension(&client, &name, action).await?)
}

#[tauri::command]
pub async fn drop_relation(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
    cascade: bool,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(ddl::drop_relation(&client, &schema, &table, cascade).await?)
}
