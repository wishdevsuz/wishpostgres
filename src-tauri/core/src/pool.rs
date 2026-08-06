use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use deadpool_postgres::{Client, Manager, ManagerConfig, Pool, RecyclingMethod};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio_postgres::{Config, NoTls};

use crate::error::{CoreError, CoreResult};
use crate::models::ServerInfo;
use crate::tls;

/// Everything needed to reach one PostgreSQL server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTarget {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub verify_certificate: bool,
    #[serde(default)]
    pub connect_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub statement_timeout_ms: Option<u64>,
    #[serde(default)]
    pub search_path: Option<String>,
}

impl ConnectionTarget {
    fn build_config(&self) -> CoreResult<Config> {
        if self.host.trim().is_empty() {
            return Err(CoreError::Invalid("a host is required".into()));
        }
        if self.username.trim().is_empty() {
            return Err(CoreError::Invalid("a username is required".into()));
        }

        let mut config = Config::new();
        config
            .host(&self.host)
            .port(self.port)
            .user(&self.username)
            .dbname(&self.database)
            .application_name("WishPostgres")
            .connect_timeout(Duration::from_secs(
                self.connect_timeout_seconds.unwrap_or(15),
            ));

        if let Some(password) = &self.password {
            config.password(password);
        }

        let mut options = Vec::new();
        if let Some(timeout) = self.statement_timeout_ms {
            options.push(format!("-c statement_timeout={timeout}"));
        }
        if let Some(path) = &self.search_path {
            // libpq splits `options` on unescaped whitespace, so the value must
            // not contain any: `a, b` would arrive as two separate options.
            let cleaned: String = path
                .split(',')
                .map(|part| {
                    part.chars()
                        .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '$'))
                        .collect::<String>()
                })
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(",");
            if !cleaned.is_empty() {
                options.push(format!("-c search_path={cleaned}"));
            }
        }
        if !options.is_empty() {
            config.options(options.join(" "));
        }

        Ok(config)
    }

    fn with_database(&self, database: &str) -> Self {
        Self {
            database: database.to_string(),
            ..self.clone()
        }
    }
}

/// Identifies one pooled connection: a saved connection plus a database.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionKey {
    pub connection_id: String,
    pub database: String,
}

impl SessionKey {
    pub fn new(connection_id: impl Into<String>, database: impl Into<String>) -> Self {
        Self {
            connection_id: connection_id.into(),
            database: database.into(),
        }
    }
}

#[derive(Clone)]
struct Session {
    pool: Pool,
}

/// Owns one pool per (connection, database) pair.
///
/// Pools are created on demand and torn down when a connection is closed, so an
/// idle app holds no server resources beyond what the user is actually viewing.
#[derive(Default)]
pub struct SessionManager {
    sessions: RwLock<HashMap<SessionKey, Session>>,
    targets: RwLock<HashMap<String, ConnectionTarget>>,
}

impl SessionManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Register a connection so later calls only need its id and a database.
    pub async fn register(&self, target: ConnectionTarget) {
        self.targets.write().await.insert(target.id.clone(), target);
    }

    pub async fn target(&self, connection_id: &str) -> CoreResult<ConnectionTarget> {
        self.targets
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| {
                CoreError::Invalid(
                    "that connection is not open — connect to it before running this action".into(),
                )
            })
    }

    /// Close every pool belonging to a connection.
    pub async fn disconnect(&self, connection_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.retain(|key, session| {
            if key.connection_id == connection_id {
                session.pool.close();
                false
            } else {
                true
            }
        });
        self.targets.write().await.remove(connection_id);
    }

    pub async fn disconnect_all(&self) {
        let mut sessions = self.sessions.write().await;
        for session in sessions.values() {
            session.pool.close();
        }
        sessions.clear();
        self.targets.write().await.clear();
    }

    pub async fn is_connected(&self, connection_id: &str) -> bool {
        self.targets.read().await.contains_key(connection_id)
    }

    pub async fn open_databases(&self, connection_id: &str) -> Vec<String> {
        self.sessions
            .read()
            .await
            .keys()
            .filter(|key| key.connection_id == connection_id)
            .map(|key| key.database.clone())
            .collect()
    }

    /// Check out a client, creating the pool the first time it is needed.
    pub async fn client(&self, key: &SessionKey) -> CoreResult<Client> {
        if let Some(session) = self.sessions.read().await.get(key) {
            return Ok(session.pool.get().await?);
        }

        let target = self
            .target(&key.connection_id)
            .await?
            .with_database(&key.database);
        let pool = build_pool(&target)?;
        // Fail fast here so a bad database name surfaces as a connection error
        // rather than on the first query.
        let client = pool.get().await?;

        self.sessions
            .write()
            .await
            .entry(key.clone())
            .or_insert(Session { pool });

        Ok(client)
    }

    /// Open a throwaway connection, used by Test Connection and by the initial
    /// handshake before a connection is registered.
    pub async fn probe(target: &ConnectionTarget) -> CoreResult<ServerInfo> {
        let pool = build_pool(target)?;
        let client = pool.get().await?;
        let info = server_info(&client).await?;
        pool.close();
        Ok(info)
    }
}

fn build_pool(target: &ConnectionTarget) -> CoreResult<Pool> {
    let config = target.build_config()?;
    let manager_config = ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    };

    let manager = if target.ssl {
        let connector = tls::make_connector(target.verify_certificate)?;
        Manager::from_config(config, connector, manager_config)
    } else {
        Manager::from_config(config, NoTls, manager_config)
    };

    Pool::builder(manager)
        .max_size(4)
        .create_timeout(Some(Duration::from_secs(
            target.connect_timeout_seconds.unwrap_or(15) + 5,
        )))
        .runtime(deadpool_postgres::Runtime::Tokio1)
        .build()
        .map_err(|error| CoreError::Pool(error.to_string()))
}

pub async fn server_info(client: &Client) -> CoreResult<ServerInfo> {
    let row = client
        .query_one(
            "SELECT version(),
                    current_setting('server_version_num')::int,
                    current_user,
                    current_database(),
                    COALESCE((SELECT usesuper FROM pg_user WHERE usename = current_user), false)",
            &[],
        )
        .await?;

    Ok(ServerInfo {
        version: row.get(0),
        version_number: row.get(1),
        current_user: row.get(2),
        current_database: row.get(3),
        is_superuser: row.get(4),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(search_path: Option<&str>) -> ConnectionTarget {
        ConnectionTarget {
            id: "id".into(),
            host: "localhost".into(),
            port: 5432,
            username: "user".into(),
            password: None,
            database: "db".into(),
            ssl: false,
            verify_certificate: false,
            connect_timeout_seconds: None,
            statement_timeout_ms: None,
            search_path: search_path.map(str::to_string),
        }
    }

    #[test]
    fn search_path_never_contains_whitespace() {
        // libpq splits `options` on whitespace, so `app, public` must not
        // survive as two tokens.
        let config = target(Some("app, public")).build_config().unwrap();
        assert_eq!(config.get_options(), Some("-c search_path=app,public"));
    }

    #[test]
    fn search_path_rejects_injection_characters() {
        let config = target(Some("app'; DROP TABLE t; --"))
            .build_config()
            .unwrap();
        assert_eq!(config.get_options(), Some("-c search_path=appDROPTABLEt"));
    }

    #[test]
    fn empty_search_path_sets_no_options() {
        let config = target(Some("  ,  ")).build_config().unwrap();
        assert_eq!(config.get_options(), None);
    }

    #[test]
    fn requires_host_and_user() {
        let mut broken = target(None);
        broken.host = String::new();
        assert!(broken.build_config().is_err());
    }
}
