pub mod models;
pub mod secrets;

use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};

use crate::error::AppResult;
use models::*;
use secrets::SecretStore;

/// A JSON document on disk, cached in memory and written atomically.
struct JsonFile<T> {
    path: PathBuf,
    cache: Mutex<Option<T>>,
    /// Held across the whole read-modify-write of [`JsonFile::update`]. Tauri
    /// runs commands concurrently, so without it two updates that overlap would
    /// both read the old document and the second write would drop the first.
    exclusive: Mutex<()>,
}

impl<T> JsonFile<T>
where
    T: Serialize + DeserializeOwned + Default + Clone,
{
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            cache: Mutex::new(None),
            exclusive: Mutex::new(()),
        }
    }

    fn read(&self) -> AppResult<T> {
        if let Some(value) = self.cache.lock().clone() {
            return Ok(value);
        }
        let value = match std::fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => T::default(),
            Err(error) => return Err(error.into()),
        };
        *self.cache.lock() = Some(value.clone());
        Ok(value)
    }

    fn write(&self, value: &T) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("tmp");
        std::fs::write(&temporary, serde_json::to_string_pretty(value)?)?;
        std::fs::rename(&temporary, &self.path)?;
        *self.cache.lock() = Some(value.clone());
        Ok(())
    }

    fn update<R>(&self, mutate: impl FnOnce(&mut T) -> AppResult<R>) -> AppResult<R> {
        let _guard = self.exclusive.lock();
        let mut value = self.read()?;
        let result = mutate(&mut value)?;
        self.write(&value)?;
        Ok(result)
    }
}

pub struct Storage {
    directory: PathBuf,
    connections: JsonFile<Vec<SavedConnection>>,
    settings: JsonFile<AppSettings>,
    workspace: JsonFile<Workspace>,
    history: JsonFile<Vec<HistoryEntry>>,
    queries: JsonFile<Vec<SavedQuery>>,
    pub secrets: SecretStore,
}

impl Storage {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.to_path_buf(),
            connections: JsonFile::new(directory.join("connections.json")),
            settings: JsonFile::new(directory.join("settings.json")),
            workspace: JsonFile::new(directory.join("workspace.json")),
            history: JsonFile::new(directory.join("history.json")),
            queries: JsonFile::new(directory.join("saved-queries.json")),
            secrets: SecretStore::new(directory),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn connections(&self) -> AppResult<Vec<SavedConnection>> {
        let mut list = self.connections.read()?;
        for connection in &mut list {
            connection.has_password = self.secrets.get(&connection.id).ok().flatten().is_some();
        }
        Ok(list)
    }

    pub fn connection(&self, id: &str) -> AppResult<Option<SavedConnection>> {
        Ok(self
            .connections
            .read()?
            .into_iter()
            .find(|connection| connection.id == id))
    }

    pub fn upsert_connection(&self, connection: SavedConnection) -> AppResult<SavedConnection> {
        self.connections.update(|list| {
            match list
                .iter_mut()
                .find(|existing| existing.id == connection.id)
            {
                Some(existing) => {
                    let created_at = existing.created_at.clone();
                    *existing = SavedConnection {
                        created_at,
                        ..connection.clone()
                    };
                    Ok(existing.clone())
                }
                None => {
                    list.push(connection.clone());
                    Ok(connection.clone())
                }
            }
        })
    }

    pub fn delete_connection(&self, id: &str) -> AppResult<()> {
        self.connections.update(|list| {
            let _: () = list.retain(|connection| connection.id != id);
            Ok(())
        })?;
        self.secrets.remove(id)?;
        self.workspace.update(|workspace| {
            if workspace.last_connection_id.as_deref() == Some(id) {
                workspace.last_connection_id = None;
                workspace.last_database = None;
            }
            workspace
                .favorite_tables
                .retain(|favorite| favorite.connection_id != id);
            Ok(())
        })
    }

    pub fn touch_connection(&self, id: &str, timestamp: String) -> AppResult<()> {
        self.connections.update(|list| {
            if let Some(connection) = list.iter_mut().find(|connection| connection.id == id) {
                connection.last_used_at = Some(timestamp);
            }
            Ok(())
        })
    }

    pub fn settings(&self) -> AppResult<AppSettings> {
        self.settings.read()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> AppResult<()> {
        self.settings.write(settings)
    }

    pub fn reset_settings(&self) -> AppResult<AppSettings> {
        let defaults = AppSettings::default();
        self.settings.write(&defaults)?;
        Ok(defaults)
    }

    pub fn workspace(&self) -> AppResult<Workspace> {
        self.workspace.read()
    }

    pub fn save_workspace(&self, workspace: &Workspace) -> AppResult<()> {
        self.workspace.write(workspace)
    }

    pub fn history(&self) -> AppResult<Vec<HistoryEntry>> {
        self.history.read()
    }

    pub fn add_history(&self, entry: HistoryEntry, limit: usize) -> AppResult<()> {
        self.history.update(|list| {
            list.insert(0, entry);
            list.truncate(limit.max(1));
            Ok(())
        })
    }

    pub fn clear_history(&self) -> AppResult<()> {
        self.history.write(&Vec::new())
    }

    pub fn saved_queries(&self) -> AppResult<Vec<SavedQuery>> {
        self.queries.read()
    }

    pub fn upsert_query(&self, query: SavedQuery) -> AppResult<SavedQuery> {
        self.queries.update(
            |list| match list.iter_mut().find(|existing| existing.id == query.id) {
                Some(existing) => {
                    *existing = SavedQuery {
                        created_at: existing.created_at.clone(),
                        ..query.clone()
                    };
                    Ok(existing.clone())
                }
                None => {
                    list.push(query.clone());
                    Ok(query.clone())
                }
            },
        )
    }

    pub fn delete_query(&self, id: &str) -> AppResult<()> {
        self.queries.update(|list| {
            let _: () = list.retain(|query| query.id != id);
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A storage rooted at a directory nothing else touches.
    fn storage() -> (Storage, PathBuf) {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "wishpostgres-storage-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        (Storage::new(&directory), directory)
    }

    fn connection(id: &str, name: &str) -> SavedConnection {
        SavedConnection {
            id: id.into(),
            name: name.into(),
            host: "localhost".into(),
            port: 5432,
            username: "postgres".into(),
            database: "postgres".into(),
            ssl: false,
            verify_certificate: false,
            favorite: false,
            color: None,
            search_path: None,
            statement_timeout_ms: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            last_used_at: None,
            has_password: false,
        }
    }

    fn history_entry(id: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            sql: "SELECT 1".into(),
            connection_id: "c1".into(),
            connection_name: "Local".into(),
            database: "postgres".into(),
            executed_at: "2026-01-01T00:00:00Z".into(),
            duration_ms: 1,
            row_count: Some(1),
            affected_rows: None,
            success: true,
            error_message: None,
        }
    }

    fn saved_query(id: &str, name: &str) -> SavedQuery {
        SavedQuery {
            id: id.into(),
            name: name.into(),
            sql: "SELECT 1".into(),
            description: None,
            favorite: false,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    // ------------------------------------------------------------- documents

    #[test]
    fn a_fresh_directory_reads_back_defaults() {
        let (storage, _) = storage();
        assert!(storage.connections().unwrap().is_empty());
        assert!(storage.history().unwrap().is_empty());
        assert!(storage.saved_queries().unwrap().is_empty());
        assert_eq!(storage.settings().unwrap().rows_per_page, 100);
        assert!(storage.workspace().unwrap().last_connection_id.is_none());
    }

    #[test]
    fn a_corrupt_document_falls_back_to_defaults_rather_than_failing() {
        let (_storage, directory) = storage();
        std::fs::write(directory.join("settings.json"), "{ not json").unwrap();
        // A fresh Storage is needed because the first one has no cache yet.
        let reopened = Storage::new(&directory);
        assert_eq!(reopened.settings().unwrap().default_schema, "public");
    }

    #[test]
    fn writes_are_visible_after_reopening() {
        let (storage, directory) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();

        let reopened = Storage::new(&directory);
        assert_eq!(reopened.connections().unwrap().len(), 1);
    }

    #[test]
    fn a_write_leaves_no_temporary_file_behind() {
        let (storage, directory) = storage();
        storage.save_settings(&AppSettings::default()).unwrap();
        assert!(!directory.join("settings.tmp").exists());
        assert!(directory.join("settings.json").exists());
    }

    #[test]
    fn the_directory_is_reported() {
        let (storage, directory) = storage();
        assert_eq!(storage.directory(), directory.as_path());
    }

    // ----------------------------------------------------------- connections

    #[test]
    fn a_connection_can_be_saved_and_found() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();
        assert_eq!(storage.connection("c1").unwrap().unwrap().name, "Local");
        assert!(storage.connection("nope").unwrap().is_none());
    }

    #[test]
    fn saving_the_same_id_updates_rather_than_duplicates() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();
        storage
            .upsert_connection(connection("c1", "Renamed"))
            .unwrap();
        let list = storage.connections().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Renamed");
    }

    #[test]
    fn an_update_keeps_the_original_creation_time() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();

        let mut edited = connection("c1", "Local");
        edited.created_at = "2030-01-01T00:00:00Z".into();
        let saved = storage.upsert_connection(edited).unwrap();
        assert_eq!(saved.created_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn several_connections_keep_their_order() {
        let (storage, _) = storage();
        for id in ["a", "b", "c"] {
            storage.upsert_connection(connection(id, id)).unwrap();
        }
        let ids: Vec<String> = storage
            .connections()
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn deleting_a_connection_removes_it() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();
        storage.delete_connection("c1").unwrap();
        assert!(storage.connections().unwrap().is_empty());
    }

    #[test]
    fn deleting_an_unknown_connection_is_harmless() {
        let (storage, _) = storage();
        assert!(storage.delete_connection("ghost").is_ok());
    }

    #[test]
    fn deleting_a_connection_clears_it_from_the_workspace() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();
        storage
            .save_workspace(&Workspace {
                last_connection_id: Some("c1".into()),
                last_database: Some("shop".into()),
                favorite_tables: vec![FavoriteTable {
                    connection_id: "c1".into(),
                    database: "shop".into(),
                    schema: "public".into(),
                    table: "orders".into(),
                }],
                ..Workspace::default()
            })
            .unwrap();

        storage.delete_connection("c1").unwrap();

        let workspace = storage.workspace().unwrap();
        assert!(workspace.last_connection_id.is_none());
        assert!(workspace.last_database.is_none());
        assert!(workspace.favorite_tables.is_empty());
    }

    #[test]
    fn deleting_a_connection_leaves_another_connections_favourites_alone() {
        let (storage, _) = storage();
        storage
            .save_workspace(&Workspace {
                favorite_tables: vec![
                    FavoriteTable {
                        connection_id: "c1".into(),
                        database: "d".into(),
                        schema: "public".into(),
                        table: "a".into(),
                    },
                    FavoriteTable {
                        connection_id: "c2".into(),
                        database: "d".into(),
                        schema: "public".into(),
                        table: "b".into(),
                    },
                ],
                ..Workspace::default()
            })
            .unwrap();

        storage.delete_connection("c1").unwrap();
        let remaining = storage.workspace().unwrap().favorite_tables;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].connection_id, "c2");
    }

    #[test]
    fn touching_a_connection_records_when_it_was_used() {
        let (storage, _) = storage();
        storage
            .upsert_connection(connection("c1", "Local"))
            .unwrap();
        storage
            .touch_connection("c1", "2026-08-09T10:00:00Z".into())
            .unwrap();
        assert_eq!(
            storage.connection("c1").unwrap().unwrap().last_used_at,
            Some("2026-08-09T10:00:00Z".to_string())
        );
    }

    #[test]
    fn touching_an_unknown_connection_is_harmless() {
        let (storage, _) = storage();
        assert!(storage.touch_connection("ghost", "now".into()).is_ok());
    }

    // -------------------------------------------------------------- settings

    #[test]
    fn settings_survive_a_write_and_a_reset() {
        let (storage, _) = storage();
        let settings = AppSettings {
            rows_per_page: 250,
            default_schema: "app".into(),
            ..AppSettings::default()
        };
        storage.save_settings(&settings).unwrap();
        assert_eq!(storage.settings().unwrap().rows_per_page, 250);

        let defaults = storage.reset_settings().unwrap();
        assert_eq!(defaults.rows_per_page, 100);
        assert_eq!(storage.settings().unwrap().default_schema, "public");
    }

    #[test]
    fn the_settings_defaults_are_the_documented_ones() {
        let defaults = AppSettings::default();
        assert!(defaults.auto_reconnect);
        assert!(defaults.animations);
        assert!(defaults.confirm_before_delete);
        assert!(defaults.open_last_connection);
        assert!(defaults.check_updates);
        assert_eq!(defaults.query_timeout_seconds, 60);
        assert_eq!(defaults.statement_timeout_ms, 0);
        assert_eq!(defaults.max_history_entries, 1000);
        assert_eq!(defaults.font_size, 13);
        assert!(defaults.binary_directory.is_none());
    }

    #[test]
    fn settings_written_before_a_new_field_existed_still_load() {
        let (storage, directory) = storage();
        std::fs::write(
            directory.join("settings.json"),
            r#"{"autoReconnect":true,"queryTimeoutSeconds":30,"rowsPerPage":50,
                "animations":false,"confirmBeforeDelete":true,"openLastConnection":true,
                "defaultSchema":"app","statementTimeoutMs":0,"checkUpdates":true,
                "maxHistoryEntries":10}"#,
        )
        .unwrap();
        let reopened = Storage::new(&directory);
        let settings = reopened.settings().unwrap();
        assert_eq!(settings.rows_per_page, 50);
        // The fields added later fall back rather than discarding the file.
        assert_eq!(settings.font_size, 0);
        assert!(settings.binary_directory.is_none());
        let _ = storage;
    }

    // ------------------------------------------------------------- workspace

    #[test]
    fn a_workspace_round_trips() {
        let (storage, _) = storage();
        storage
            .save_workspace(&Workspace {
                last_connection_id: Some("c1".into()),
                last_schema: Some("app".into()),
                sidebar_width: Some(300.0),
                sql_tabs: vec![SqlTab {
                    id: "t1".into(),
                    name: "Query 1".into(),
                    sql: "SELECT 1".into(),
                    connection_id: None,
                    database: None,
                }],
                ..Workspace::default()
            })
            .unwrap();

        let workspace = storage.workspace().unwrap();
        assert_eq!(workspace.last_connection_id.as_deref(), Some("c1"));
        assert_eq!(workspace.sidebar_width, Some(300.0));
        assert_eq!(workspace.sql_tabs.len(), 1);
        assert_eq!(workspace.sql_tabs[0].sql, "SELECT 1");
    }

    // --------------------------------------------------------------- history

    #[test]
    fn history_is_newest_first() {
        let (storage, _) = storage();
        storage.add_history(history_entry("a"), 100).unwrap();
        storage.add_history(history_entry("b"), 100).unwrap();
        let ids: Vec<String> = storage
            .history()
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, vec!["b", "a"]);
    }

    #[test]
    fn history_is_trimmed_to_the_limit() {
        let (storage, _) = storage();
        for index in 0..10 {
            storage
                .add_history(history_entry(&index.to_string()), 3)
                .unwrap();
        }
        let history = storage.history().unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].id, "9");
    }

    #[test]
    fn a_limit_of_zero_still_keeps_the_last_statement() {
        let (storage, _) = storage();
        storage.add_history(history_entry("a"), 0).unwrap();
        assert_eq!(storage.history().unwrap().len(), 1);
    }

    #[test]
    fn clearing_history_empties_it() {
        let (storage, _) = storage();
        storage.add_history(history_entry("a"), 100).unwrap();
        storage.clear_history().unwrap();
        assert!(storage.history().unwrap().is_empty());
    }

    // --------------------------------------------------------- saved queries

    #[test]
    fn a_saved_query_can_be_stored_updated_and_deleted() {
        let (storage, _) = storage();
        storage.upsert_query(saved_query("q1", "First")).unwrap();
        assert_eq!(storage.saved_queries().unwrap().len(), 1);

        let mut edited = saved_query("q1", "Renamed");
        edited.created_at = "2030-01-01T00:00:00Z".into();
        let saved = storage.upsert_query(edited).unwrap();
        assert_eq!(saved.name, "Renamed");
        // The creation time belongs to the original.
        assert_eq!(saved.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(storage.saved_queries().unwrap().len(), 1);

        storage.delete_query("q1").unwrap();
        assert!(storage.saved_queries().unwrap().is_empty());
    }

    #[test]
    fn deleting_an_unknown_query_is_harmless() {
        let (storage, _) = storage();
        assert!(storage.delete_query("ghost").is_ok());
    }

    // ------------------------------------------------------------ concurrency

    #[test]
    fn concurrent_writes_do_not_lose_one_another() {
        let (storage, _) = storage();
        let storage = std::sync::Arc::new(storage);

        let handles: Vec<_> = (0..8)
            .map(|index| {
                let storage = storage.clone();
                std::thread::spawn(move || {
                    storage
                        .upsert_connection(connection(
                            &format!("c{index}"),
                            &format!("Connection {index}"),
                        ))
                        .unwrap();
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(storage.connections().unwrap().len(), 8);
    }

    #[test]
    fn concurrent_history_writes_all_land() {
        let (storage, _) = storage();
        let storage = std::sync::Arc::new(storage);

        let handles: Vec<_> = (0..8)
            .map(|index| {
                let storage = storage.clone();
                std::thread::spawn(move || {
                    storage
                        .add_history(history_entry(&index.to_string()), 100)
                        .unwrap();
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(storage.history().unwrap().len(), 8);
    }

    // -------------------------------------------------------- to_target

    #[test]
    fn a_connection_becomes_a_target() {
        let mut saved = connection("c1", "Local");
        saved.ssl = true;
        saved.verify_certificate = true;
        saved.search_path = Some("app, public".into());
        saved.statement_timeout_ms = Some(5_000);

        let target = saved.to_target(Some("secret".into()), None);
        assert_eq!(target.id, "c1");
        assert_eq!(target.host, "localhost");
        assert_eq!(target.port, 5432);
        assert_eq!(target.database, "postgres");
        assert_eq!(target.password.as_deref(), Some("secret"));
        assert!(target.ssl);
        assert!(target.verify_certificate);
        assert_eq!(target.search_path.as_deref(), Some("app, public"));
        assert_eq!(target.statement_timeout_ms, Some(5_000));
        // The connect timeout is applied by the app layer, not the record.
        assert!(target.connect_timeout_seconds.is_none());
    }

    #[test]
    fn a_target_can_override_the_database() {
        let saved = connection("c1", "Local");
        assert_eq!(saved.to_target(None, Some("shop")).database, "shop");
    }

    #[test]
    fn a_target_without_a_password_carries_none() {
        assert!(connection("c1", "Local")
            .to_target(None, None)
            .password
            .is_none());
    }
}
