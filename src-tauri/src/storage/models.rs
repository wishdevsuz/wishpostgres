use serde::{Deserialize, Serialize};

use super::secrets::SecretBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub verify_certificate: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub search_path: Option<String>,
    #[serde(default)]
    pub statement_timeout_ms: Option<u64>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
    /// Never persisted; set only when the caller needs to know whether a
    /// password is on file.
    #[serde(default, skip_deserializing)]
    pub has_password: bool,
}

impl SavedConnection {
    pub fn to_target(
        &self,
        password: Option<String>,
        database: Option<&str>,
    ) -> pgl_core::ConnectionTarget {
        pgl_core::ConnectionTarget {
            id: self.id.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            password,
            database: database.unwrap_or(&self.database).to_string(),
            ssl: self.ssl,
            verify_certificate: self.verify_certificate,
            connect_timeout_seconds: None,
            statement_timeout_ms: self.statement_timeout_ms,
            search_path: self.search_path.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub auto_reconnect: bool,
    pub query_timeout_seconds: u32,
    pub rows_per_page: u32,
    pub animations: bool,
    pub confirm_before_delete: bool,
    pub open_last_connection: bool,
    pub default_schema: String,
    pub statement_timeout_ms: u64,
    pub check_updates: bool,
    pub max_history_entries: u32,
    #[serde(default)]
    pub binary_directory: Option<String>,
    #[serde(default)]
    pub font_size: u8,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            query_timeout_seconds: 60,
            rows_per_page: 100,
            animations: true,
            confirm_before_delete: true,
            open_last_connection: true,
            default_schema: "public".to_string(),
            statement_timeout_ms: 0,
            check_updates: true,
            max_history_entries: 1000,
            binary_directory: None,
            font_size: 13,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    #[serde(default)]
    pub last_connection_id: Option<String>,
    #[serde(default)]
    pub last_database: Option<String>,
    #[serde(default)]
    pub last_schema: Option<String>,
    #[serde(default)]
    pub sql_tabs: Vec<SqlTab>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub favorite_tables: Vec<FavoriteTable>,
    #[serde(default)]
    pub sidebar_width: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlTab {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTable {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub sql: String,
    pub connection_id: String,
    pub connection_name: String,
    pub database: String,
    pub executed_at: String,
    pub duration_ms: u64,
    #[serde(default)]
    pub row_count: Option<u64>,
    #[serde(default)]
    pub affected_rows: Option<u64>,
    pub success: bool,
    #[serde(default)]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub config_directory: String,
    pub secret_backend: SecretBackend,
    pub pg_dump_version: Option<String>,
    pub psql_version: Option<String>,
}
