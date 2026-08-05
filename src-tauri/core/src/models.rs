use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ident::SortDirection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub type_category: TypeCategory,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_identity: bool,
    pub is_generated: bool,
    pub comment: Option<String>,
    pub ordinal: i32,
    pub enum_values: Vec<String>,
    pub max_length: Option<i32>,
}

/// Coarse grouping used by the UI to pick an input control and an alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TypeCategory {
    Number,
    Text,
    Boolean,
    Date,
    Time,
    Timestamp,
    Json,
    Uuid,
    Enum,
    Array,
    Binary,
    Network,
    Geometric,
    Interval,
    Other,
}

impl TypeCategory {
    pub fn from_pg(type_name: &str, is_enum: bool, is_array: bool) -> Self {
        if is_enum {
            return TypeCategory::Enum;
        }
        if is_array {
            return TypeCategory::Array;
        }
        match type_name {
            "smallint" | "integer" | "bigint" | "real" | "double precision" | "numeric"
            | "smallserial" | "serial" | "bigserial" | "money" | "int2" | "int4" | "int8"
            | "float4" | "float8" | "decimal" | "oid" => TypeCategory::Number,
            "boolean" | "bool" => TypeCategory::Boolean,
            "date" => TypeCategory::Date,
            "time" | "time without time zone" | "time with time zone" | "timetz" => {
                TypeCategory::Time
            }
            "timestamp"
            | "timestamp without time zone"
            | "timestamp with time zone"
            | "timestamptz" => TypeCategory::Timestamp,
            "json" | "jsonb" => TypeCategory::Json,
            "uuid" => TypeCategory::Uuid,
            "bytea" => TypeCategory::Binary,
            "inet" | "cidr" | "macaddr" | "macaddr8" => TypeCategory::Network,
            "point" | "line" | "lseg" | "box" | "path" | "polygon" | "circle" => {
                TypeCategory::Geometric
            }
            "interval" => TypeCategory::Interval,
            "text" | "character varying" | "character" | "varchar" | "char" | "name" | "citext"
            | "xml" => TypeCategory::Text,
            _ => TypeCategory::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub data_type: String,
    pub type_category: TypeCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Value>>,
    pub row_count: usize,
    pub affected_rows: Option<u64>,
    pub duration_ms: u64,
    pub command: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
    pub total_rows: Option<i64>,
    pub is_estimate: bool,
    pub duration_ms: u64,
    /// Row identity used for updates and deletes: the primary key columns, or
    /// `ctid` when the relation has no primary key.
    pub identity: RowIdentity,
    pub identity_values: Vec<Vec<Value>>,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowIdentity {
    pub kind: IdentityKind,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityKind {
    PrimaryKey,
    Unique,
    Ctid,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseRequest {
    pub schema: String,
    pub table: String,
    pub limit: i64,
    pub offset: i64,
    #[serde(default)]
    pub sort: Vec<SortSpec>,
    #[serde(default)]
    pub filters: Vec<FilterSpec>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub exact_count: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSpec {
    pub column: String,
    pub operator: FilterOperator,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    GreaterThan,
    GreaterOrEqual,
    LessThan,
    LessOrEqual,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    pub fn needs_value(self) -> bool {
        !matches!(self, FilterOperator::IsNull | FilterOperator::IsNotNull)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub owner: String,
    pub encoding: String,
    pub size: Option<i64>,
    pub is_template: bool,
    pub can_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub owner: String,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationInfo {
    pub schema: String,
    pub name: String,
    pub kind: RelationKind,
    pub owner: String,
    pub size: Option<i64>,
    pub estimated_rows: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelationKind {
    Table,
    View,
    MaterializedView,
    ForeignTable,
    PartitionedTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfo {
    pub schema: String,
    pub name: String,
    pub arguments: String,
    pub returns: String,
    pub language: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub name: String,
    pub schema: Option<String>,
    pub installed_version: Option<String>,
    pub default_version: Option<String>,
    pub comment: Option<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub definition: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub is_valid: bool,
    pub size: Option<i64>,
    pub scans: Option<i64>,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInfo {
    pub name: String,
    pub kind: String,
    pub definition: String,
    pub is_deferrable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStatistics {
    pub live_rows: Option<i64>,
    pub dead_rows: Option<i64>,
    pub total_size: Option<i64>,
    pub table_size: Option<i64>,
    pub index_size: Option<i64>,
    pub toast_size: Option<i64>,
    pub sequential_scans: Option<i64>,
    pub index_scans: Option<i64>,
    pub inserts: Option<i64>,
    pub updates: Option<i64>,
    pub deletes: Option<i64>,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub last_analyze: Option<String>,
    pub last_autoanalyze: Option<String>,
    pub column_stats: Vec<ColumnStatistic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnStatistic {
    pub column: String,
    pub null_fraction: Option<f32>,
    pub distinct_values: Option<f32>,
    pub average_width: Option<i32>,
    pub most_common: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: String,
    pub schema: String,
    pub name: String,
    pub detail: Option<String>,
    pub parent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub version_number: i32,
    pub current_user: String,
    pub current_database: String,
    pub is_superuser: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowChange {
    pub schema: String,
    pub table: String,
    pub identity: RowIdentity,
    pub identity_values: Vec<Value>,
    pub column: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertRequest {
    pub schema: String,
    pub table: String,
    pub values: Vec<FieldValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValue {
    pub column: String,
    /// `None` means SQL NULL; use `use_default` to omit the column entirely.
    pub value: Option<String>,
    #[serde(default)]
    pub use_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    pub schema: String,
    pub table: String,
    pub identity: RowIdentity,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Json,
    Xlsx,
    SqlInsert,
    SqlCopy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub path: String,
    pub format: ExportFormat,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub table_name: Option<String>,
    #[serde(default = "default_true")]
    pub include_header: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub total_rows: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub path: String,
    pub schema: String,
    pub table: String,
    /// Source column name keyed by destination column name.
    pub mapping: Vec<ColumnMapping>,
    #[serde(default = "default_true")]
    pub has_header: bool,
    #[serde(default)]
    pub delimiter: Option<String>,
    #[serde(default)]
    pub truncate_first: bool,
    #[serde(default = "default_true")]
    pub stop_on_error: bool,
    #[serde(default)]
    pub null_literal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub inserted: u64,
    pub failed: u64,
    pub errors: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub token: String,
    pub stage: String,
    pub percent: Option<f32>,
    pub message: String,
    pub done: bool,
}
