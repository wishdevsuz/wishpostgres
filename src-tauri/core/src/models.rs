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

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------ TypeCategory

    #[test]
    fn every_numeric_type_is_a_number() {
        for name in [
            "smallint",
            "integer",
            "bigint",
            "real",
            "double precision",
            "numeric",
            "smallserial",
            "serial",
            "bigserial",
            "money",
            "int2",
            "int4",
            "int8",
            "float4",
            "float8",
            "decimal",
            "oid",
        ] {
            assert_eq!(
                TypeCategory::from_pg(name, false, false),
                TypeCategory::Number,
                "{name} should be a number"
            );
        }
    }

    #[test]
    fn every_textual_type_is_text() {
        for name in [
            "text",
            "character varying",
            "character",
            "varchar",
            "char",
            "name",
            "citext",
            "xml",
        ] {
            assert_eq!(
                TypeCategory::from_pg(name, false, false),
                TypeCategory::Text
            );
        }
    }

    #[test]
    fn dates_times_and_timestamps_are_kept_apart() {
        assert_eq!(
            TypeCategory::from_pg("date", false, false),
            TypeCategory::Date
        );
        assert_eq!(
            TypeCategory::from_pg("time", false, false),
            TypeCategory::Time
        );
        assert_eq!(
            TypeCategory::from_pg("time with time zone", false, false),
            TypeCategory::Time
        );
        assert_eq!(
            TypeCategory::from_pg("timestamp with time zone", false, false),
            TypeCategory::Timestamp
        );
        assert_eq!(
            TypeCategory::from_pg("timestamptz", false, false),
            TypeCategory::Timestamp
        );
        assert_eq!(
            TypeCategory::from_pg("interval", false, false),
            TypeCategory::Interval
        );
    }

    #[test]
    fn the_remaining_categories_map() {
        assert_eq!(
            TypeCategory::from_pg("boolean", false, false),
            TypeCategory::Boolean
        );
        assert_eq!(
            TypeCategory::from_pg("jsonb", false, false),
            TypeCategory::Json
        );
        assert_eq!(
            TypeCategory::from_pg("uuid", false, false),
            TypeCategory::Uuid
        );
        assert_eq!(
            TypeCategory::from_pg("bytea", false, false),
            TypeCategory::Binary
        );
        assert_eq!(
            TypeCategory::from_pg("inet", false, false),
            TypeCategory::Network
        );
        assert_eq!(
            TypeCategory::from_pg("macaddr8", false, false),
            TypeCategory::Network
        );
        assert_eq!(
            TypeCategory::from_pg("polygon", false, false),
            TypeCategory::Geometric
        );
    }

    #[test]
    fn an_unknown_type_falls_back_to_other() {
        assert_eq!(
            TypeCategory::from_pg("tsvector", false, false),
            TypeCategory::Other
        );
        assert_eq!(TypeCategory::from_pg("", false, false), TypeCategory::Other);
    }

    #[test]
    fn enum_and_array_flags_win_over_the_name() {
        // The grid needs a picker for an enum and a text box for an array,
        // whatever the underlying base type happens to be called.
        assert_eq!(
            TypeCategory::from_pg("integer", true, false),
            TypeCategory::Enum
        );
        assert_eq!(
            TypeCategory::from_pg("integer", false, true),
            TypeCategory::Array
        );
        assert_eq!(
            TypeCategory::from_pg("integer", true, true),
            TypeCategory::Enum
        );
    }

    // ------------------------------------------------------ FilterOperator

    #[test]
    fn only_the_null_checks_go_without_a_value() {
        assert!(!FilterOperator::IsNull.needs_value());
        assert!(!FilterOperator::IsNotNull.needs_value());

        for operator in [
            FilterOperator::Equals,
            FilterOperator::NotEquals,
            FilterOperator::GreaterThan,
            FilterOperator::GreaterOrEqual,
            FilterOperator::LessThan,
            FilterOperator::LessOrEqual,
            FilterOperator::Contains,
            FilterOperator::NotContains,
            FilterOperator::StartsWith,
            FilterOperator::EndsWith,
        ] {
            assert!(operator.needs_value(), "{operator:?} should need a value");
        }
    }

    // --------------------------------------------------------- serde shapes

    #[test]
    fn enums_travel_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&TypeCategory::Timestamp).unwrap(),
            "\"timestamp\""
        );
        assert_eq!(
            serde_json::to_string(&FilterOperator::NotContains).unwrap(),
            "\"notContains\""
        );
        assert_eq!(
            serde_json::to_string(&IdentityKind::PrimaryKey).unwrap(),
            "\"primaryKey\""
        );
        assert_eq!(
            serde_json::to_string(&RelationKind::MaterializedView).unwrap(),
            "\"materializedView\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::SqlInsert).unwrap(),
            "\"sqlInsert\""
        );
    }

    #[test]
    fn a_browse_request_parses_from_the_frontend_shape() {
        let request: BrowseRequest = serde_json::from_str(
            r#"{"schema":"public","table":"t","limit":50,"offset":100,
                "sort":[{"column":"id","direction":"desc"}],
                "filters":[{"column":"id","operator":"greaterThan","value":"3"}],
                "search":null,"exactCount":true}"#,
        )
        .unwrap();
        assert_eq!(request.limit, 50);
        assert_eq!(request.offset, 100);
        assert!(request.exact_count);
        assert_eq!(request.filters[0].operator, FilterOperator::GreaterThan);
    }

    #[test]
    fn an_export_request_defaults_to_including_the_header() {
        let request: ExportRequest = serde_json::from_str(
            r#"{"path":"/tmp/x.csv","format":"csv","columns":["a"],"rows":[]}"#,
        )
        .unwrap();
        assert!(request.include_header);
        assert!(request.table_name.is_none());
    }

    #[test]
    fn an_import_request_defaults_are_the_safe_ones() {
        let request: ImportRequest = serde_json::from_str(
            r#"{"path":"/tmp/x.csv","schema":"public","table":"t","mapping":[]}"#,
        )
        .unwrap();
        assert!(request.has_header);
        assert!(request.stop_on_error);
        assert!(!request.truncate_first);
        assert!(request.delimiter.is_none());
        assert!(request.null_literal.is_none());
    }

    #[test]
    fn a_column_meta_round_trips_in_camel_case() {
        let column = ColumnMeta {
            name: "created_at".into(),
            data_type: "timestamptz".into(),
            type_category: TypeCategory::Timestamp,
            nullable: false,
            default: Some("now()".into()),
            is_primary_key: false,
            is_unique: false,
            is_identity: false,
            is_generated: false,
            comment: None,
            ordinal: 3,
            enum_values: Vec::new(),
            max_length: None,
        };
        let json = serde_json::to_string(&column).unwrap();
        assert!(json.contains("\"isPrimaryKey\""));
        assert!(json.contains("\"typeCategory\":\"timestamp\""));
        let back: ColumnMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "created_at");
        assert_eq!(back.ordinal, 3);
    }

    #[test]
    fn a_row_change_parses_with_a_null_value() {
        let change: RowChange = serde_json::from_str(
            r#"{"schema":"public","table":"t",
                "identity":{"kind":"primaryKey","columns":["id"]},
                "identityValues":[1],"column":"note","value":null}"#,
        )
        .unwrap();
        assert!(change.value.is_none());
        assert_eq!(change.identity.kind, IdentityKind::PrimaryKey);
    }

    #[test]
    fn transfer_progress_allows_an_unknown_percentage() {
        let progress: TransferProgress = serde_json::from_str(
            r#"{"token":"t","stage":"dump","percent":null,"message":"…","done":false}"#,
        )
        .unwrap();
        assert!(progress.percent.is_none());
        assert!(!progress.done);
    }
}
