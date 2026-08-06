use pgl_core::models::QueryResult;
use pgl_core::query;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::{new_id, now, AppState};
use crate::storage::models::HistoryEntry;

#[tauri::command]
pub async fn run_sql(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    sql: String,
) -> AppResult<Vec<QueryResult>> {
    if sql.trim().is_empty() {
        return Err(AppError::invalid("there is nothing to run"));
    }

    let connection = state.saved_connection(&connection_id)?;
    let settings = state.storage.settings()?;
    let client = state.client(&connection_id, &database).await?;

    let outcome = query::execute_script(&client, &sql).await;

    let mut entry = HistoryEntry {
        id: new_id(),
        sql: sql.trim().to_string(),
        connection_id: connection_id.clone(),
        connection_name: connection.name.clone(),
        database: database.clone(),
        executed_at: now(),
        duration_ms: 0,
        row_count: None,
        affected_rows: None,
        success: false,
        error_message: None,
    };

    match outcome {
        Ok(results) => {
            entry.success = true;
            entry.duration_ms = results.iter().map(|result| result.duration_ms).sum();
            entry.row_count = results.iter().map(|result| result.row_count as u64).max();
            entry.affected_rows = results
                .iter()
                .filter_map(|result| result.affected_rows)
                .reduce(|total, value| total + value);

            state
                .storage
                .add_history(entry, settings.max_history_entries as usize)?;
            Ok(results)
        }
        Err(error) => {
            let failure = AppError::from(error);
            entry.error_message = Some(failure.report().message.clone());
            state
                .storage
                .add_history(entry, settings.max_history_entries as usize)?;
            Err(failure)
        }
    }
}

#[tauri::command]
pub async fn explain_sql(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    sql: String,
    analyze: bool,
) -> AppResult<String> {
    let statements = query::split_statements(&sql);
    let statement = statements
        .first()
        .ok_or_else(|| AppError::invalid("there is nothing to explain"))?;

    let mut client = state.client(&connection_id, &database).await?;

    let result = if analyze {
        // EXPLAIN ANALYZE really executes the statement, so an `ANALYZE` of a
        // DELETE would delete rows. Run it inside a transaction that is always
        // rolled back: the plan and the real timings survive, the writes do not.
        let transaction = client
            .transaction()
            .await
            .map_err(pgl_core::CoreError::from)?;
        let plan = query::explain(
            &transaction,
            statement,
            "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ",
        )
        .await;
        transaction
            .rollback()
            .await
            .map_err(pgl_core::CoreError::from)?;
        plan?
    } else {
        query::explain(&client, statement, "EXPLAIN (VERBOSE, FORMAT TEXT) ").await?
    };

    Ok(result)
}
