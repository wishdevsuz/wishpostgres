//! Builders shared by the unit tests.
//!
//! The catalog types carry a dozen fields each and almost every test cares
//! about two of them, so they are constructed here with sensible defaults and
//! adjusted through the `with_*` methods.

use crate::models::*;

/// A column with everything switched off, ready to be adjusted.
pub fn column(name: &str, data_type: &str) -> ColumnMeta {
    ColumnMeta {
        name: name.to_string(),
        data_type: data_type.to_string(),
        type_category: TypeCategory::from_pg(data_type, false, data_type.ends_with("[]")),
        nullable: true,
        default: None,
        is_primary_key: false,
        is_unique: false,
        is_identity: false,
        is_generated: false,
        comment: None,
        ordinal: 1,
        enum_values: Vec::new(),
        max_length: None,
    }
}

pub trait ColumnExt {
    fn primary(self) -> Self;
    fn unique(self) -> Self;
    fn not_null(self) -> Self;
    fn generated(self) -> Self;
    fn identity(self) -> Self;
    fn with_default(self, expression: &str) -> Self;
    fn with_enum(self, values: &[&str]) -> Self;
    fn with_max_length(self, length: i32) -> Self;
}

impl ColumnExt for ColumnMeta {
    fn primary(mut self) -> Self {
        self.is_primary_key = true;
        self.nullable = false;
        self
    }

    fn unique(mut self) -> Self {
        self.is_unique = true;
        self
    }

    fn not_null(mut self) -> Self {
        self.nullable = false;
        self
    }

    fn generated(mut self) -> Self {
        self.is_generated = true;
        self
    }

    fn identity(mut self) -> Self {
        self.is_identity = true;
        self
    }

    fn with_default(mut self, expression: &str) -> Self {
        self.default = Some(expression.to_string());
        self
    }

    fn with_enum(mut self, values: &[&str]) -> Self {
        self.enum_values = values.iter().map(|value| value.to_string()).collect();
        self.type_category = TypeCategory::Enum;
        self
    }

    fn with_max_length(mut self, length: i32) -> Self {
        self.max_length = Some(length);
        self
    }
}

/// A browse request for `public.t` with no filters, sort or search.
pub fn browse_request() -> BrowseRequest {
    BrowseRequest {
        schema: "public".into(),
        table: "t".into(),
        limit: 100,
        offset: 0,
        sort: Vec::new(),
        filters: Vec::new(),
        search: None,
        exact_count: false,
    }
}

pub fn filter(column: &str, operator: FilterOperator, value: Option<&str>) -> FilterSpec {
    FilterSpec {
        column: column.to_string(),
        operator,
        value: value.map(|text| text.to_string()),
    }
}

pub fn primary_key(columns: &[&str]) -> RowIdentity {
    RowIdentity {
        kind: IdentityKind::PrimaryKey,
        columns: columns.iter().map(|name| name.to_string()).collect(),
    }
}

pub fn ctid_identity() -> RowIdentity {
    RowIdentity {
        kind: IdentityKind::Ctid,
        columns: vec!["ctid".into()],
    }
}

pub fn field(column: &str, value: Option<&str>) -> FieldValue {
    FieldValue {
        column: column.to_string(),
        value: value.map(|text| text.to_string()),
        use_default: false,
    }
}

/// Write `contents` into a uniquely named file under the temp directory and
/// return its path. The file is left behind for the test to read; the whole
/// directory is disposable.
pub fn temp_file(name: &str, contents: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("wishpostgres-test-{unique}-{name}"));
    std::fs::write(&path, contents).expect("the temp file should be writable");
    path.display().to_string()
}

/// A path in the temp directory that nothing has written to yet.
pub fn temp_path(name: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir()
        .join(format!("wishpostgres-out-{unique}-{name}"))
        .display()
        .to_string()
}
