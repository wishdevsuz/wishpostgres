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
}

impl<T> JsonFile<T>
where
    T: Serialize + DeserializeOwned + Default + Clone,
{
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            cache: Mutex::new(None),
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
            connection.has_password = self
                .secrets
                .get(&connection.id)
                .ok()
                .flatten()
                .is_some();
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
            match list.iter_mut().find(|existing| existing.id == connection.id) {
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
        self.connections
            .update(|list| Ok(list.retain(|connection| connection.id != id)))?;
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
        self.queries.update(|list| {
            match list.iter_mut().find(|existing| existing.id == query.id) {
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
            }
        })
    }

    pub fn delete_query(&self, id: &str) -> AppResult<()> {
        self.queries
            .update(|list| Ok(list.retain(|query| query.id != id)))
    }
}
