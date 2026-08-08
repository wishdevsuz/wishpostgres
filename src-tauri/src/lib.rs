mod commands;
mod error;
mod state;
mod storage;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

use state::AppState;
use storage::Storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The window draws its own title bar, so the decoration state
                // is a property of the app, not of the last session. Restoring
                // it would put the system title bar back above ours for anyone
                // upgrading from a build that still had one.
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            std::fs::create_dir_all(&directory)?;
            app.manage(AppState::new(Storage::new(&directory)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::disconnect_all,
            commands::connection::connected_ids,
            commands::connection::storage_info,
            commands::catalog::list_databases,
            commands::catalog::list_schemas,
            commands::catalog::list_relations,
            commands::catalog::list_functions,
            commands::catalog::list_extensions,
            commands::catalog::table_columns,
            commands::catalog::table_indexes,
            commands::catalog::table_constraints,
            commands::catalog::table_statistics,
            commands::catalog::table_definition,
            commands::catalog::global_search,
            commands::data::browse_table,
            commands::data::update_cell,
            commands::data::insert_row,
            commands::data::delete_rows,
            commands::data::add_column,
            commands::data::alter_column,
            commands::data::rename_relation,
            commands::data::truncate_table,
            commands::data::drop_relation,
            commands::data::set_extension,
            commands::query::run_sql,
            commands::query::explain_sql,
            commands::transfer::export_rows,
            commands::transfer::preview_import,
            commands::transfer::import_rows,
            commands::transfer::backup_database,
            commands::transfer::restore_database,
            commands::prefs::get_settings,
            commands::prefs::save_settings,
            commands::prefs::reset_settings,
            commands::prefs::get_workspace,
            commands::prefs::save_workspace,
            commands::prefs::get_history,
            commands::prefs::clear_history,
            commands::prefs::list_saved_queries,
            commands::prefs::save_query,
            commands::prefs::delete_saved_query,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start WishPostgres");
}
