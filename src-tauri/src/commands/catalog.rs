use pgl_core::introspect;
use pgl_core::models::*;
use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> AppResult<Vec<DatabaseInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::databases(&client).await?)
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> AppResult<Vec<SchemaInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::schemas(&client).await?)
}

#[tauri::command]
pub async fn list_relations(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    kinds: Vec<RelationKind>,
) -> AppResult<Vec<RelationInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::relations(&client, &schema, &kinds).await?)
}

#[tauri::command]
pub async fn list_functions(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
) -> AppResult<Vec<FunctionInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::functions(&client, &schema).await?)
}

#[tauri::command]
pub async fn list_extensions(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> AppResult<Vec<ExtensionInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::extensions(&client).await?)
}

#[tauri::command]
pub async fn table_columns(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<Vec<ColumnMeta>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::columns(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn table_indexes(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<Vec<IndexInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::indexes(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn table_constraints(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<Vec<ConstraintInfo>> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::constraints(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn table_statistics(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<TableStatistics> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::statistics(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn table_definition(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> AppResult<String> {
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::definition(&client, &schema, &table).await?)
}

#[tauri::command]
pub async fn global_search(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    term: String,
) -> AppResult<Vec<SearchHit>> {
    if term.trim().is_empty() {
        return Ok(Vec::new());
    }
    let client = state.client(&connection_id, &database).await?;
    Ok(introspect::search(&client, term.trim(), 100).await?)
}
