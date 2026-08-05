use pgl_core::error::ErrorReport;
use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

/// Every failure is converted to an [`ErrorReport`] as soon as it is produced,
/// which keeps the PostgreSQL diagnostics (SQLSTATE, detail, hint, position)
/// intact all the way to the error dialog.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{}", .0.message)]
    Reported(Box<ErrorReport>),
}

impl AppError {
    pub fn report(&self) -> &ErrorReport {
        match self {
            AppError::Reported(report) => report,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::from(ErrorReport {
            reason: Some("The request was rejected before it reached the server.".into()),
            suggestion: Some("Correct the highlighted input and try again.".into()),
            ..ErrorReport::simple("invalid", message)
        })
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::from(ErrorReport {
            reason: Some("The requested item no longer exists.".into()),
            suggestion: Some("Refresh the sidebar and try again.".into()),
            ..ErrorReport::simple("notFound", message)
        })
    }

    pub fn secret(message: impl Into<String>) -> Self {
        Self::from(ErrorReport {
            reason: Some("The credential store could not be used.".into()),
            suggestion: Some(
                "Unlock your keyring, or re-enter the password so it can be stored again.".into(),
            ),
            ..ErrorReport::simple("secret", message)
        })
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.report().serialize(serializer)
    }
}

impl From<ErrorReport> for AppError {
    fn from(report: ErrorReport) -> Self {
        AppError::Reported(Box::new(report))
    }
}

impl From<pgl_core::CoreError> for AppError {
    fn from(error: pgl_core::CoreError) -> Self {
        AppError::from(ErrorReport::from(error))
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::from(ErrorReport {
            reason: Some("A file could not be read or written.".into()),
            suggestion: Some(
                "Check that the path exists and that you have permission to use it.".into(),
            ),
            ..ErrorReport::simple("io", error.to_string())
        })
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::from(ErrorReport {
            reason: Some("A stored file could not be parsed.".into()),
            suggestion: Some(
                "The file may be corrupt. Reset settings, or remove it from the config directory \
                 to start fresh."
                    .into(),
            ),
            ..ErrorReport::simple("json", error.to_string())
        })
    }
}
