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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builders_set_their_kind() {
        assert_eq!(AppError::invalid("x").report().kind, "invalid");
        assert_eq!(AppError::not_found("x").report().kind, "notFound");
        assert_eq!(AppError::secret("x").report().kind, "secret");
    }

    #[test]
    fn every_builder_offers_a_reason_and_a_fix() {
        for error in [
            AppError::invalid("x"),
            AppError::not_found("x"),
            AppError::secret("x"),
        ] {
            let report = error.report();
            assert!(report.reason.is_some());
            assert!(report.suggestion.is_some());
        }
    }

    #[test]
    fn the_message_survives() {
        assert_eq!(
            AppError::invalid("be precise").report().message,
            "be precise"
        );
    }

    #[test]
    fn an_io_failure_is_reported_as_a_file_problem() {
        let error = AppError::from(std::io::Error::other("disk on fire"));
        assert_eq!(error.report().kind, "io");
        assert!(error.report().message.contains("disk on fire"));
    }

    #[test]
    fn a_parse_failure_names_the_stored_file() {
        let parsed = serde_json::from_str::<serde_json::Value>("{oops").unwrap_err();
        let error = AppError::from(parsed);
        assert_eq!(error.report().kind, "json");
        assert!(error
            .report()
            .suggestion
            .as_deref()
            .unwrap()
            .contains("Reset settings"));
    }

    #[test]
    fn a_core_failure_keeps_its_own_kind() {
        let error = AppError::from(pgl_core::CoreError::Invalid("no".into()));
        assert_eq!(error.report().kind, "invalid");
    }

    #[test]
    fn an_app_error_serialises_as_its_report() {
        let json = serde_json::to_string(&AppError::invalid("boom")).unwrap();
        assert!(json.contains("\"message\":\"boom\""));
        assert!(json.contains("\"kind\":\"invalid\""));
    }

    #[test]
    fn the_display_form_is_the_message() {
        assert_eq!(AppError::invalid("boom").to_string(), "boom");
    }
}
