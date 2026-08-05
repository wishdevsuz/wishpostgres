use serde::{Deserialize, Serialize};

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    Postgres(#[from] tokio_postgres::Error),

    #[error("connection pool error: {0}")]
    Pool(String),

    #[error("{0}")]
    Tls(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Csv(#[from] csv::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Spreadsheet(String),

    #[error("{0}")]
    Invalid(String),

    #[error("the operation was cancelled")]
    Cancelled,
}

impl From<deadpool_postgres::PoolError> for CoreError {
    fn from(value: deadpool_postgres::PoolError) -> Self {
        match value {
            deadpool_postgres::PoolError::Backend(err) => CoreError::Postgres(err),
            other => CoreError::Pool(other.to_string()),
        }
    }
}

impl From<deadpool_postgres::CreatePoolError> for CoreError {
    fn from(value: deadpool_postgres::CreatePoolError) -> Self {
        CoreError::Pool(value.to_string())
    }
}

impl From<calamine::Error> for CoreError {
    fn from(value: calamine::Error) -> Self {
        CoreError::Spreadsheet(value.to_string())
    }
}

impl From<calamine::XlsxError> for CoreError {
    fn from(value: calamine::XlsxError) -> Self {
        CoreError::Spreadsheet(value.to_string())
    }
}

impl From<rust_xlsxwriter::XlsxError> for CoreError {
    fn from(value: rust_xlsxwriter::XlsxError) -> Self {
        CoreError::Spreadsheet(value.to_string())
    }
}

/// A structured, user-facing description of a failure.
///
/// Everything the error dialog renders (message, SQLSTATE, likely cause and a
/// concrete suggested fix) is produced here so the UI stays presentational.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
    pub message: String,
    pub kind: String,
    pub sqlstate: Option<String>,
    pub detail: Option<String>,
    pub hint: Option<String>,
    pub position: Option<u32>,
    pub reason: Option<String>,
    pub suggestion: Option<String>,
}

impl ErrorReport {
    pub fn simple(kind: &str, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: kind.to_string(),
            sqlstate: None,
            detail: None,
            hint: None,
            position: None,
            reason: None,
            suggestion: None,
        }
    }
}

impl From<CoreError> for ErrorReport {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Postgres(err) => report_from_postgres(err),
            CoreError::Pool(message) => ErrorReport {
                reason: Some("The connection pool could not hand out a session.".into()),
                suggestion: Some(
                    "Verify the server is reachable and that the connection limit has not been \
                     exhausted, then reconnect."
                        .into(),
                ),
                ..ErrorReport::simple("pool", message)
            },
            CoreError::Tls(message) => ErrorReport {
                reason: Some("The TLS handshake with the server failed.".into()),
                suggestion: Some(
                    "Enable \"Trust self-signed certificates\" in the connection settings, or turn \
                     SSL off if the server does not support it."
                        .into(),
                ),
                ..ErrorReport::simple("tls", message)
            },
            CoreError::Io(err) => ErrorReport {
                reason: Some("A file or process operation failed.".into()),
                suggestion: Some("Check that the path exists and that you have permission to use it.".into()),
                ..ErrorReport::simple("io", err.to_string())
            },
            CoreError::Csv(err) => ErrorReport {
                reason: Some("The CSV file could not be parsed.".into()),
                suggestion: Some("Confirm the delimiter and that every row has the same number of fields.".into()),
                ..ErrorReport::simple("csv", err.to_string())
            },
            CoreError::Json(err) => ErrorReport {
                reason: Some("The JSON payload is not valid.".into()),
                suggestion: Some("The file must contain an array of objects with matching keys.".into()),
                ..ErrorReport::simple("json", err.to_string())
            },
            CoreError::Spreadsheet(message) => ErrorReport {
                reason: Some("The spreadsheet could not be read or written.".into()),
                suggestion: Some("Only .xlsx workbooks are supported. Re-save the file and try again.".into()),
                ..ErrorReport::simple("spreadsheet", message)
            },
            CoreError::Invalid(message) => ErrorReport {
                reason: Some("The request was rejected before it reached the server.".into()),
                suggestion: Some("Correct the highlighted input and try again.".into()),
                ..ErrorReport::simple("invalid", message)
            },
            CoreError::Cancelled => ErrorReport {
                reason: Some("The operation was cancelled before it finished.".into()),
                ..ErrorReport::simple("cancelled", "Cancelled")
            },
        }
    }
}

fn report_from_postgres(error: tokio_postgres::Error) -> ErrorReport {
    let fallback = error.to_string();
    let Some(db) = error.as_db_error() else {
        let (reason, suggestion) = connection_advice(&fallback);
        return ErrorReport {
            reason: Some(reason),
            suggestion: Some(suggestion),
            ..ErrorReport::simple("connection", fallback)
        };
    };

    let sqlstate = db.code().code().to_string();
    let (reason, suggestion) = sqlstate_advice(&sqlstate, db.message());

    ErrorReport {
        message: db.message().to_string(),
        kind: "postgres".to_string(),
        sqlstate: Some(sqlstate),
        detail: db.detail().map(str::to_string),
        hint: db.hint().map(str::to_string),
        position: match db.position() {
            Some(tokio_postgres::error::ErrorPosition::Original(p)) => Some(*p),
            Some(tokio_postgres::error::ErrorPosition::Internal { position, .. }) => Some(*position),
            None => None,
        },
        reason: Some(reason),
        suggestion: Some(suggestion),
    }
}

fn connection_advice(message: &str) -> (String, String) {
    let lower = message.to_lowercase();
    if lower.contains("connection refused") {
        return (
            "Nothing is listening on that host and port.".into(),
            "Start the PostgreSQL service (`sudo systemctl start postgresql`) or correct the host \
             and port."
                .into(),
        );
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return (
            "The server did not answer within the timeout.".into(),
            "Check firewall rules and that the host is reachable, or raise the query timeout in \
             Settings."
                .into(),
        );
    }
    if lower.contains("name or service not known") || lower.contains("failed to lookup") {
        return (
            "The hostname could not be resolved.".into(),
            "Verify the spelling of the host, or use an IP address such as 127.0.0.1.".into(),
        );
    }
    if lower.contains("password") || lower.contains("authentication") {
        return (
            "The server rejected the supplied credentials.".into(),
            "Re-enter the password, and confirm the user exists and is allowed in pg_hba.conf.".into(),
        );
    }
    (
        "The connection to PostgreSQL could not be established.".into(),
        "Confirm the host, port, user and password, then use Test Connection.".into(),
    )
}

fn sqlstate_advice(sqlstate: &str, message: &str) -> (String, String) {
    match sqlstate {
        "28P01" => (
            "Password authentication failed for that role.".into(),
            "Re-enter the password in the connection settings.".into(),
        ),
        "28000" => (
            "The role is not permitted to connect this way.".into(),
            "Add a matching entry to pg_hba.conf and reload the server configuration.".into(),
        ),
        "3D000" => (
            "The requested database does not exist on this server.".into(),
            "Pick an existing database from the sidebar, or create it first.".into(),
        ),
        "42P01" => (
            "The table or view referenced in the statement does not exist.".into(),
            "Check the spelling and make sure the schema is on the search path.".into(),
        ),
        "42703" => (
            "A column in the statement does not exist.".into(),
            "Open the Structure tab to confirm the column names.".into(),
        ),
        "42601" => (
            "PostgreSQL could not parse the statement.".into(),
            "Look at the highlighted position in the editor for the syntax error.".into(),
        ),
        "42501" => (
            "The current role lacks privileges for this object.".into(),
            "Grant the required privilege, or connect as an owner or superuser.".into(),
        ),
        "23505" => (
            "A unique constraint rejected the row.".into(),
            "Change the duplicated value, or update the existing row instead of inserting.".into(),
        ),
        "23503" => (
            "A foreign key constraint rejected the change.".into(),
            "Insert the referenced parent row first, or remove the dependent rows.".into(),
        ),
        "23502" => (
            "A NOT NULL column was left empty.".into(),
            "Provide a value, or give the column a default in the Structure tab.".into(),
        ),
        "23514" => (
            "A CHECK constraint rejected the value.".into(),
            "Review the constraint in the Constraints tab and supply a value that satisfies it.".into(),
        ),
        "22P02" => (
            "A value could not be cast to the column's type.".into(),
            "Correct the value's format, for example an integer column cannot hold text.".into(),
        ),
        "22001" => (
            "A value is longer than the column allows.".into(),
            "Shorten the value or widen the column with ALTER TABLE.".into(),
        ),
        "40001" => (
            "The transaction hit a serialization conflict.".into(),
            "Simply run the statement again; this class of error is safe to retry.".into(),
        ),
        "40P01" => (
            "Two sessions deadlocked and this one was chosen as the victim.".into(),
            "Retry the statement, and touch tables in a consistent order to avoid the cycle.".into(),
        ),
        "53300" => (
            "The server has reached max_connections.".into(),
            "Close unused sessions, or raise max_connections on the server.".into(),
        ),
        "57014" => (
            "The statement ran past the configured timeout and was cancelled.".into(),
            "Increase the query timeout in Settings, or narrow the query with a WHERE clause.".into(),
        ),
        "55P03" | "55006" => (
            "The object is locked by another session.".into(),
            "Wait for the other transaction to finish, or inspect pg_stat_activity.".into(),
        ),
        "42P07" => (
            "An object with that name already exists.".into(),
            "Choose a different name, or drop the existing object first.".into(),
        ),
        "2BP01" => (
            "Other objects still depend on this one.".into(),
            "Drop the dependent objects first, or use CASCADE if that is intended.".into(),
        ),
        other if other.starts_with("08") => (
            "The connection to the server was lost.".into(),
            "Reconnect from the top bar; enable Auto reconnect in Settings to do this automatically."
                .into(),
        ),
        other if other.starts_with("53") => (
            "The server is out of a resource such as memory or disk.".into(),
            "Free resources on the server, or reduce the size of the result set.".into(),
        ),
        _ => (
            format!("PostgreSQL reported: {message}"),
            "Review the statement and the server log for more context.".into(),
        ),
    }
}
