use crate::error::{CoreError, CoreResult};

/// Quote an SQL identifier the way `quote_ident()` does server side.
///
/// Identifiers can never be parameterised, so every identifier that reaches a
/// statement must pass through here.
pub fn quote_ident(raw: &str) -> CoreResult<String> {
    if raw.is_empty() {
        return Err(CoreError::Invalid("an identifier cannot be empty".into()));
    }
    if raw.len() > 63 {
        return Err(CoreError::Invalid(format!(
            "the identifier `{raw}` is longer than PostgreSQL's 63 byte limit"
        )));
    }
    if raw.contains('\0') {
        return Err(CoreError::Invalid(
            "an identifier cannot contain a null byte".into(),
        ));
    }
    Ok(format!("\"{}\"", raw.replace('"', "\"\"")))
}

/// Quote a schema-qualified relation as `"schema"."table"`.
pub fn quote_relation(schema: &str, name: &str) -> CoreResult<String> {
    Ok(format!("{}.{}", quote_ident(schema)?, quote_ident(name)?))
}

/// Quote a string literal, used only where PostgreSQL forbids parameters
/// (for example inside `COMMENT ON` or `SET`).
pub fn quote_literal(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "''"))
}

/// Validate a type expression supplied by the structure editor.
///
/// Types cannot be parameterised either, so the input is restricted to the
/// character set PostgreSQL type names actually use.
pub fn validate_type_expr(raw: &str) -> CoreResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Invalid("a data type is required".into()));
    }
    if trimmed.len() > 128 {
        return Err(CoreError::Invalid("that data type expression is too long".into()));
    }
    let allowed = trimmed.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(c, ' ' | '_' | '(' | ')' | ',' | '[' | ']' | '.' | '"' | '\'' | '+' | '-')
    });
    if !allowed {
        return Err(CoreError::Invalid(format!(
            "`{trimmed}` is not a valid data type expression"
        )));
    }
    if trimmed.contains(';') || trimmed.contains("--") || trimmed.contains("/*") {
        return Err(CoreError::Invalid(
            "a data type expression cannot contain statements or comments".into(),
        ));
    }
    Ok(trimmed.to_string())
}

/// Sort direction for browse queries; kept as an enum so no user string ever
/// reaches the `ORDER BY` clause.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortDirection {
    pub fn as_sql(self) -> &'static str {
        match self {
            SortDirection::Asc => "ASC",
            SortDirection::Desc => "DESC",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_and_escapes() {
        assert_eq!(quote_ident("users").unwrap(), "\"users\"");
        assert_eq!(quote_ident("we\"ird").unwrap(), "\"we\"\"ird\"");
        assert_eq!(quote_ident("drop\"; --").unwrap(), "\"drop\"\"; --\"");
    }

    #[test]
    fn rejects_empty_identifier() {
        assert!(quote_ident("").is_err());
    }

    #[test]
    fn literal_escaping() {
        assert_eq!(quote_literal("it's"), "'it''s'");
    }

    #[test]
    fn type_expressions() {
        assert!(validate_type_expr("character varying(255)").is_ok());
        assert!(validate_type_expr("numeric(10, 2)").is_ok());
        assert!(validate_type_expr("text[]").is_ok());
        assert!(validate_type_expr("text; DROP TABLE users").is_err());
        assert!(validate_type_expr("int -- comment").is_err());
    }
}
