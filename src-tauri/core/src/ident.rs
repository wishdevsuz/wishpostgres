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
///
/// Backslashes are doubled and the literal is emitted as an escape string when
/// one is present, so the result means the same thing whether or not the server
/// has `standard_conforming_strings` turned on. Null bytes cannot appear in a
/// PostgreSQL text value at all and are dropped rather than silently truncating
/// the statement.
pub fn quote_literal(raw: &str) -> String {
    let cleaned: String = raw.chars().filter(|c| *c != '\0').collect();
    let escaped = cleaned.replace('\'', "''");
    if escaped.contains('\\') {
        format!("E'{}'", escaped.replace('\\', "\\\\"))
    } else {
        format!("'{escaped}'")
    }
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
        return Err(CoreError::Invalid(
            "that data type expression is too long".into(),
        ));
    }
    let allowed = trimmed.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(
                c,
                ' ' | '_' | '(' | ')' | ',' | '[' | ']' | '.' | '"' | '\'' | '+' | '-'
            )
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

    // ----------------------------------------------------------- quote_ident

    #[test]
    fn quotes_and_escapes() {
        assert_eq!(quote_ident("users").unwrap(), "\"users\"");
        assert_eq!(quote_ident("we\"ird").unwrap(), "\"we\"\"ird\"");
        assert_eq!(quote_ident("drop\"; --").unwrap(), "\"drop\"\"; --\"");
    }

    #[test]
    fn quoting_is_unconditional() {
        // Always quoting means a reserved word or a capital never breaks.
        assert_eq!(quote_ident("select").unwrap(), "\"select\"");
        assert_eq!(quote_ident("Name").unwrap(), "\"Name\"");
        assert_eq!(quote_ident("1st").unwrap(), "\"1st\"");
    }

    #[test]
    fn every_embedded_quote_is_doubled() {
        assert_eq!(quote_ident("a\"b\"c").unwrap(), "\"a\"\"b\"\"c\"");
    }

    #[test]
    fn rejects_empty_identifier() {
        assert!(quote_ident("").is_err());
    }

    #[test]
    fn rejects_an_identifier_past_the_server_limit() {
        assert!(quote_ident(&"a".repeat(63)).is_ok());
        assert!(quote_ident(&"a".repeat(64)).is_err());
    }

    #[test]
    fn rejects_a_null_byte() {
        assert!(quote_ident("a\0b").is_err());
    }

    #[test]
    fn accepts_non_ascii_identifiers() {
        assert_eq!(quote_ident("ustunlar").unwrap(), "\"ustunlar\"");
        assert_eq!(quote_ident("столбец").unwrap(), "\"столбец\"");
    }

    // -------------------------------------------------------- quote_relation

    #[test]
    fn qualifies_a_relation() {
        assert_eq!(
            quote_relation("public", "users").unwrap(),
            "\"public\".\"users\""
        );
    }

    #[test]
    fn a_relation_quotes_both_halves() {
        assert_eq!(
            quote_relation("my schema", "my table").unwrap(),
            "\"my schema\".\"my table\""
        );
    }

    #[test]
    fn a_relation_with_an_empty_half_is_refused() {
        assert!(quote_relation("", "t").is_err());
        assert!(quote_relation("public", "").is_err());
    }

    // --------------------------------------------------------- quote_literal

    #[test]
    fn literal_escaping() {
        assert_eq!(quote_literal("it's"), "'it''s'");
        assert_eq!(quote_literal("plain"), "'plain'");
        // A backslash means one thing with standard_conforming_strings on and
        // another with it off; the explicit escape string settles it.
        assert_eq!(
            quote_literal("a\\'; DROP TABLE t --"),
            "E'a\\\\''; DROP TABLE t --'"
        );
        assert_eq!(quote_literal("nul\0byte"), "'nulbyte'");
    }

    #[test]
    fn an_empty_literal_is_an_empty_string() {
        assert_eq!(quote_literal(""), "''");
    }

    #[test]
    fn a_literal_without_a_backslash_is_not_an_escape_string() {
        assert!(!quote_literal("plain text").starts_with('E'));
    }

    #[test]
    fn a_literal_with_a_backslash_becomes_an_escape_string() {
        assert_eq!(quote_literal("a\\b"), "E'a\\\\b'");
    }

    #[test]
    fn newlines_and_tabs_survive_a_literal() {
        assert_eq!(quote_literal("a\nb\tc"), "'a\nb\tc'");
    }

    // ---------------------------------------------------- validate_type_expr

    #[test]
    fn type_expressions() {
        assert!(validate_type_expr("character varying(255)").is_ok());
        assert!(validate_type_expr("numeric(10, 2)").is_ok());
        assert!(validate_type_expr("text[]").is_ok());
        assert!(validate_type_expr("text; DROP TABLE users").is_err());
        assert!(validate_type_expr("int -- comment").is_err());
    }

    #[test]
    fn type_expressions_are_trimmed() {
        assert_eq!(validate_type_expr("  text  ").unwrap(), "text");
    }

    #[test]
    fn an_empty_type_expression_is_refused() {
        assert!(validate_type_expr("").is_err());
        assert!(validate_type_expr("   ").is_err());
    }

    #[test]
    fn an_overlong_type_expression_is_refused() {
        assert!(validate_type_expr(&"a".repeat(128)).is_ok());
        assert!(validate_type_expr(&"a".repeat(129)).is_err());
    }

    #[test]
    fn qualified_and_quoted_types_are_allowed() {
        assert!(validate_type_expr("my_schema.my_enum").is_ok());
        assert!(validate_type_expr("\"My Type\"").is_ok());
        assert!(validate_type_expr("timestamp(3) with time zone").is_ok());
        assert!(validate_type_expr("integer[][]").is_ok());
    }

    #[test]
    fn a_type_expression_cannot_contain_a_block_comment() {
        assert!(validate_type_expr("int /* x */").is_err());
    }

    #[test]
    fn a_type_expression_cannot_contain_odd_punctuation() {
        assert!(validate_type_expr("text || 1").is_err());
        assert!(validate_type_expr("text$$").is_err());
        assert!(validate_type_expr("text\\").is_err());
    }

    // -------------------------------------------------------- SortDirection

    #[test]
    fn sort_directions_render_as_sql() {
        assert_eq!(SortDirection::Asc.as_sql(), "ASC");
        assert_eq!(SortDirection::Desc.as_sql(), "DESC");
    }

    #[test]
    fn sort_directions_round_trip_through_json() {
        let json = serde_json::to_string(&SortDirection::Desc).unwrap();
        assert_eq!(json, "\"desc\"");
        let back: SortDirection = serde_json::from_str(&json).unwrap();
        assert_eq!(back, SortDirection::Desc);
    }
}
