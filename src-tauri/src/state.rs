use std::sync::Arc;

use pgl_core::{Client, ConnectionTarget, SessionKey, SessionManager};

use crate::error::{AppError, AppResult};
use crate::storage::models::SavedConnection;
use crate::storage::Storage;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
    pub storage: Storage,
}

impl AppState {
    pub fn new(storage: Storage) -> Self {
        Self {
            sessions: SessionManager::new(),
            storage,
        }
    }

    /// Check out a pooled client for one connection and database.
    pub async fn client(&self, connection_id: &str, database: &str) -> AppResult<Client> {
        let key = SessionKey::new(connection_id, database);
        Ok(self.sessions.client(&key).await?)
    }

    pub fn saved_connection(&self, connection_id: &str) -> AppResult<SavedConnection> {
        self.storage
            .connection(connection_id)?
            .ok_or_else(|| AppError::not_found("that connection has been deleted"))
    }

    /// Build a connection target with the stored password and the timeouts the
    /// current settings ask for.
    pub fn target_for(
        &self,
        connection: &SavedConnection,
        database: Option<&str>,
    ) -> AppResult<ConnectionTarget> {
        let password = self.storage.secrets.get(&connection.id)?;
        let settings = self.storage.settings()?;

        let mut target = connection.to_target(password, database);
        target.connect_timeout_seconds = Some(settings.query_timeout_seconds.max(5) as u64);
        if target.statement_timeout_ms.is_none() && settings.statement_timeout_ms > 0 {
            target.statement_timeout_ms = Some(settings.statement_timeout_ms);
        }
        if target.search_path.is_none() {
            let schema = settings.default_schema.trim();
            if !schema.is_empty() && schema != "public" {
                target.search_path = Some(format!("{schema},public"));
            }
        }
        Ok(target)
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
