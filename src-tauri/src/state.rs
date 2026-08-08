use std::sync::Arc;

use pgl_core::{Client, ConnectionTarget, SessionKey, SessionManager};

use crate::error::{AppError, AppResult};
use crate::storage::models::SavedConnection;
use crate::storage::Storage;

/// How long to wait for the TCP connect and the PostgreSQL handshake. This is
/// deliberately independent of the query timeout: a server that is unreachable
/// should be reported quickly even when long queries are allowed.
const CONNECT_TIMEOUT_SECONDS: u64 = 15;

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
        target.connect_timeout_seconds = Some(CONNECT_TIMEOUT_SECONDS);
        // `query_timeout_seconds` is how long a *statement* may run, so it maps
        // onto `statement_timeout`, not onto the handshake timeout. A
        // per-connection value still wins over the global setting.
        if target.statement_timeout_ms.is_none() {
            let from_settings = if settings.statement_timeout_ms > 0 {
                Some(settings.statement_timeout_ms)
            } else if settings.query_timeout_seconds > 0 {
                Some(settings.query_timeout_seconds as u64 * 1000)
            } else {
                None
            };
            target.statement_timeout_ms = from_settings;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::AppSettings;

    fn state() -> AppState {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "wishpostgres-state-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        AppState::new(Storage::new(&directory))
    }

    fn connection() -> SavedConnection {
        SavedConnection {
            id: "c1".into(),
            name: "Local".into(),
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
            created_at: String::new(),
            last_used_at: None,
            has_password: false,
        }
    }

    #[test]
    fn a_target_always_gets_a_connect_timeout() {
        let state = state();
        let target = state.target_for(&connection(), None).unwrap();
        assert_eq!(
            target.connect_timeout_seconds,
            Some(CONNECT_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn the_connect_timeout_is_independent_of_the_query_timeout() {
        // An hour-long query allowance must not mean an hour to notice an
        // unreachable host.
        let state = state();
        let settings = AppSettings {
            query_timeout_seconds: 3600,
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let target = state.target_for(&connection(), None).unwrap();
        assert_eq!(target.connect_timeout_seconds, Some(15));
    }

    #[test]
    fn the_query_timeout_becomes_the_statement_timeout() {
        let state = state();
        let settings = AppSettings {
            query_timeout_seconds: 30,
            statement_timeout_ms: 0,
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let target = state.target_for(&connection(), None).unwrap();
        assert_eq!(target.statement_timeout_ms, Some(30_000));
    }

    #[test]
    fn an_explicit_statement_timeout_wins_over_the_query_timeout() {
        let state = state();
        let settings = AppSettings {
            query_timeout_seconds: 60,
            statement_timeout_ms: 5_000,
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let target = state.target_for(&connection(), None).unwrap();
        assert_eq!(target.statement_timeout_ms, Some(5_000));
    }

    #[test]
    fn a_per_connection_timeout_wins_over_both_settings() {
        let state = state();
        let settings = AppSettings {
            statement_timeout_ms: 5_000,
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let mut saved = connection();
        saved.statement_timeout_ms = Some(1_234);
        let target = state.target_for(&saved, None).unwrap();
        assert_eq!(target.statement_timeout_ms, Some(1_234));
    }

    #[test]
    fn both_timeouts_off_means_no_statement_timeout() {
        let state = state();
        let settings = AppSettings {
            query_timeout_seconds: 0,
            statement_timeout_ms: 0,
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        assert!(state
            .target_for(&connection(), None)
            .unwrap()
            .statement_timeout_ms
            .is_none());
    }

    #[test]
    fn the_default_schema_leads_the_search_path() {
        let state = state();
        let settings = AppSettings {
            default_schema: "app".into(),
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let target = state.target_for(&connection(), None).unwrap();
        assert_eq!(target.search_path.as_deref(), Some("app,public"));
    }

    #[test]
    fn a_default_schema_of_public_needs_no_search_path() {
        let state = state();
        assert!(state
            .target_for(&connection(), None)
            .unwrap()
            .search_path
            .is_none());
    }

    #[test]
    fn a_blank_default_schema_needs_no_search_path() {
        let state = state();
        let settings = AppSettings {
            default_schema: "   ".into(),
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();
        assert!(state
            .target_for(&connection(), None)
            .unwrap()
            .search_path
            .is_none());
    }

    #[test]
    fn a_per_connection_search_path_wins() {
        let state = state();
        let settings = AppSettings {
            default_schema: "app".into(),
            ..AppSettings::default()
        };
        state.storage.save_settings(&settings).unwrap();

        let mut saved = connection();
        saved.search_path = Some("tenant, public".into());
        let target = state.target_for(&saved, None).unwrap();
        assert_eq!(target.search_path.as_deref(), Some("tenant, public"));
    }

    #[test]
    fn a_target_can_open_a_different_database() {
        let state = state();
        let target = state.target_for(&connection(), Some("shop")).unwrap();
        assert_eq!(target.database, "shop");
    }

    #[test]
    fn asking_for_a_deleted_connection_says_so() {
        let state = state();
        let error = state.saved_connection("ghost").unwrap_err();
        assert_eq!(error.report().kind, "notFound");
    }

    #[test]
    fn a_saved_connection_is_found_by_id() {
        let state = state();
        state.storage.upsert_connection(connection()).unwrap();
        assert_eq!(state.saved_connection("c1").unwrap().name, "Local");
    }

    #[test]
    fn timestamps_are_rfc_3339() {
        let stamp = now();
        assert!(chrono::DateTime::parse_from_rfc3339(&stamp).is_ok());
    }

    #[test]
    fn generated_ids_are_unique_uuids() {
        let first = new_id();
        let second = new_id();
        assert_ne!(first, second);
        assert!(uuid::Uuid::parse_str(&first).is_ok());
    }
}
