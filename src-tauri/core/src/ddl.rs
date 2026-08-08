//! Structure editing. Every identifier and type expression is validated by
//! [`crate::ident`] before it becomes part of a statement.

use deadpool_postgres::Client;
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::ident::{quote_ident, quote_literal, quote_relation, validate_type_expr};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddColumnRequest {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub unique: bool,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterColumnRequest {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub action: ColumnAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum ColumnAction {
    Rename(String),
    ChangeType {
        data_type: String,
        using: Option<String>,
    },
    SetNullable(bool),
    SetDefault(Option<String>),
    SetComment(Option<String>),
    Drop {
        cascade: bool,
    },
}

/// Build the statements `add_column` runs.
///
/// Separated from the execution so every branch — defaults, NOT NULL, UNIQUE,
/// the trailing `COMMENT ON` — can be asserted without a server.
pub fn add_column_sql(request: &AddColumnRequest) -> CoreResult<(String, Option<String>)> {
    let relation = quote_relation(&request.schema, &request.table)?;
    let column = quote_ident(&request.name)?;
    let data_type = validate_type_expr(&request.data_type)?;

    let mut sql = format!("ALTER TABLE {relation} ADD COLUMN {column} {data_type}");
    if let Some(default) = request
        .default
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        // A DEFAULT is an expression, so it is validated rather than bound.
        sql.push_str(&format!(" DEFAULT {}", validate_expression(default)?));
    }
    if !request.nullable {
        sql.push_str(" NOT NULL");
    }
    if request.unique {
        sql.push_str(" UNIQUE");
    }

    let comment = request
        .comment
        .as_ref()
        .filter(|text| !text.is_empty())
        .map(|text| {
            format!(
                "COMMENT ON COLUMN {relation}.{column} IS {}",
                quote_literal(text)
            )
        });

    Ok((sql, comment))
}

pub async fn add_column(client: &Client, request: &AddColumnRequest) -> CoreResult<String> {
    let (sql, comment) = add_column_sql(request)?;
    client.batch_execute(&sql).await?;

    if let Some(comment_sql) = comment {
        client.batch_execute(&comment_sql).await?;
        return Ok(format!("{sql};\n{comment_sql};"));
    }

    Ok(format!("{sql};"))
}

pub fn alter_column_sql(request: &AlterColumnRequest) -> CoreResult<String> {
    let relation = quote_relation(&request.schema, &request.table)?;
    let column = quote_ident(&request.column)?;

    let sql = match &request.action {
        ColumnAction::Rename(new_name) => {
            format!(
                "ALTER TABLE {relation} RENAME COLUMN {column} TO {}",
                quote_ident(new_name)?
            )
        }
        ColumnAction::ChangeType { data_type, using } => {
            let validated = validate_type_expr(data_type)?;
            let mut statement =
                format!("ALTER TABLE {relation} ALTER COLUMN {column} TYPE {validated}");
            match using.as_ref().filter(|text| !text.trim().is_empty()) {
                Some(expression) => {
                    statement.push_str(&format!(" USING {}", validate_expression(expression)?))
                }
                None => statement.push_str(&format!(" USING {column}::{validated}")),
            }
            statement
        }
        ColumnAction::SetNullable(nullable) => format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} {} NOT NULL",
            if *nullable { "DROP" } else { "SET" }
        ),
        ColumnAction::SetDefault(default) => {
            match default.as_ref().filter(|value| !value.trim().is_empty()) {
                Some(value) => format!(
                    "ALTER TABLE {relation} ALTER COLUMN {column} SET DEFAULT {}",
                    validate_expression(value)?
                ),
                None => format!("ALTER TABLE {relation} ALTER COLUMN {column} DROP DEFAULT"),
            }
        }
        ColumnAction::SetComment(comment) => format!(
            "COMMENT ON COLUMN {relation}.{column} IS {}",
            match comment.as_ref().filter(|text| !text.is_empty()) {
                Some(text) => quote_literal(text),
                None => "NULL".to_string(),
            }
        ),
        ColumnAction::Drop { cascade } => format!(
            "ALTER TABLE {relation} DROP COLUMN {column}{}",
            if *cascade { " CASCADE" } else { "" }
        ),
    };

    Ok(sql)
}

pub async fn alter_column(client: &Client, request: &AlterColumnRequest) -> CoreResult<String> {
    let sql = alter_column_sql(request)?;
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

pub fn rename_relation_sql(schema: &str, table: &str, new_name: &str) -> CoreResult<String> {
    Ok(format!(
        "ALTER TABLE {} RENAME TO {}",
        quote_relation(schema, table)?,
        quote_ident(new_name)?
    ))
}

pub async fn rename_relation(
    client: &Client,
    schema: &str,
    table: &str,
    new_name: &str,
) -> CoreResult<String> {
    let sql = rename_relation_sql(schema, table, new_name)?;
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

pub fn truncate_table_sql(schema: &str, table: &str) -> CoreResult<String> {
    Ok(format!("TRUNCATE TABLE {}", quote_relation(schema, table)?))
}

pub async fn truncate_table(client: &Client, schema: &str, table: &str) -> CoreResult<String> {
    let sql = truncate_table_sql(schema, table)?;
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

/// The `DROP` keyword for a `pg_class.relkind`.
///
/// PostgreSQL insists the keyword matches the object: `DROP TABLE` on a view is
/// an error rather than a no-op, so the kind is read from the catalog first.
pub fn drop_keyword(relkind: &str) -> &'static str {
    match relkind {
        "v" => "DROP VIEW",
        "m" => "DROP MATERIALIZED VIEW",
        "f" => "DROP FOREIGN TABLE",
        _ => "DROP TABLE",
    }
}

pub fn drop_relation_sql(
    schema: &str,
    table: &str,
    relkind: &str,
    cascade: bool,
) -> CoreResult<String> {
    Ok(format!(
        "{} {}{}",
        drop_keyword(relkind),
        quote_relation(schema, table)?,
        if cascade { " CASCADE" } else { "" }
    ))
}

pub async fn drop_relation(
    client: &Client,
    schema: &str,
    table: &str,
    cascade: bool,
) -> CoreResult<String> {
    let relation = quote_relation(schema, table)?;
    let kind: String = client
        .query_one(
            "SELECT c.relkind::text FROM pg_class c WHERE c.oid = $1::text::regclass",
            &[&relation],
        )
        .await?
        .get(0);

    let sql = drop_relation_sql(schema, table, &kind, cascade)?;
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

/// Statement for one of the extension actions the UI offers.
pub fn extension_sql(name: &str, action: ExtensionAction) -> CoreResult<String> {
    let quoted = quote_ident(name)?;
    Ok(match action {
        ExtensionAction::Install => format!("CREATE EXTENSION IF NOT EXISTS {quoted}"),
        ExtensionAction::Update => format!("ALTER EXTENSION {quoted} UPDATE"),
        ExtensionAction::Uninstall => format!("DROP EXTENSION {quoted}"),
        ExtensionAction::UninstallCascade => format!("DROP EXTENSION {quoted} CASCADE"),
    })
}

/// What the Extensions page can do to an extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionAction {
    Install,
    Update,
    Uninstall,
    UninstallCascade,
}

impl std::str::FromStr for ExtensionAction {
    type Err = CoreError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw {
            "install" => Ok(Self::Install),
            "update" => Ok(Self::Update),
            "uninstall" => Ok(Self::Uninstall),
            "uninstallCascade" => Ok(Self::UninstallCascade),
            other => Err(CoreError::Invalid(format!(
                "`{other}` is not a known extension action"
            ))),
        }
    }
}

pub async fn set_extension(
    client: &Client,
    name: &str,
    action: ExtensionAction,
) -> CoreResult<String> {
    let sql = extension_sql(name, action)?;
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

/// Guard for the few places PostgreSQL requires a raw expression, such as a
/// column `DEFAULT` or an `ALTER … USING` clause. Statement terminators and
/// comment markers are rejected so a single expression cannot smuggle in a
/// second statement.
fn validate_expression(raw: &str) -> CoreResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Invalid("the expression is empty".into()));
    }
    if trimmed.len() > 512 {
        return Err(CoreError::Invalid("that expression is too long".into()));
    }
    if trimmed.contains("--") || trimmed.contains("/*") {
        return Err(CoreError::Invalid(
            "an expression cannot contain comments".into(),
        ));
    }
    if contains_bare_semicolon(trimmed) {
        return Err(CoreError::Invalid(
            "an expression cannot contain more than one statement".into(),
        ));
    }
    Ok(trimmed.to_string())
}

/// Whether a semicolon appears outside any string literal.
///
/// Dollar quoting has to be understood here, not just `'…'`: without it
/// `$$'$$; DROP TABLE t` would leave the scanner believing it was inside a
/// single-quoted string and the trailing statement would sail through.
fn contains_bare_semicolon(raw: &str) -> bool {
    let chars: Vec<char> = raw.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        match chars[index] {
            '\'' => {
                index += 1;
                while index < chars.len() {
                    if chars[index] == '\'' {
                        // A doubled quote is an escaped quote, not the end.
                        if chars.get(index + 1) == Some(&'\'') {
                            index += 2;
                            continue;
                        }
                        index += 1;
                        break;
                    }
                    index += 1;
                }
            }
            '$' => match dollar_tag(&chars, index) {
                Some(tag) => {
                    index += tag.len();
                    match find_tag(&chars, index, &tag) {
                        Some(end) => index = end + tag.len(),
                        // An unterminated dollar quote is malformed SQL; treat
                        // the rest as opaque rather than as executable text.
                        None => return false,
                    }
                }
                None => index += 1,
            },
            ';' => return true,
            _ => index += 1,
        }
    }
    false
}

/// Read a dollar-quote opening tag such as `$$` or `$body$` at `start`.
fn dollar_tag(chars: &[char], start: usize) -> Option<Vec<char>> {
    let mut tag = vec!['$'];
    let mut cursor = start + 1;
    while let Some(&ch) = chars.get(cursor) {
        if ch == '$' {
            tag.push('$');
            return Some(tag);
        }
        if ch.is_alphanumeric() || ch == '_' {
            tag.push(ch);
            cursor += 1;
        } else {
            return None;
        }
    }
    None
}

fn find_tag(chars: &[char], from: usize, tag: &[char]) -> Option<usize> {
    (from..chars.len().saturating_sub(tag.len() - 1))
        .find(|&index| chars[index..index + tag.len()] == *tag)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add_request(name: &str, data_type: &str) -> AddColumnRequest {
        AddColumnRequest {
            schema: "public".into(),
            table: "t".into(),
            name: name.into(),
            data_type: data_type.into(),
            nullable: true,
            default: None,
            unique: false,
            comment: None,
        }
    }

    fn alter_request(column: &str, action: ColumnAction) -> AlterColumnRequest {
        AlterColumnRequest {
            schema: "public".into(),
            table: "t".into(),
            column: column.into(),
            action,
        }
    }

    fn alter(column: &str, action: ColumnAction) -> String {
        alter_column_sql(&alter_request(column, action)).unwrap()
    }

    // ------------------------------------------------------------ add_column

    #[test]
    fn adding_a_plain_column() {
        let (sql, comment) = add_column_sql(&add_request("note", "text")).unwrap();
        assert_eq!(sql, "ALTER TABLE \"public\".\"t\" ADD COLUMN \"note\" text");
        assert!(comment.is_none());
    }

    #[test]
    fn a_not_null_column_says_so() {
        let mut request = add_request("note", "text");
        request.nullable = false;
        assert!(add_column_sql(&request).unwrap().0.ends_with(" NOT NULL"));
    }

    #[test]
    fn a_unique_column_says_so() {
        let mut request = add_request("email", "text");
        request.unique = true;
        assert!(add_column_sql(&request).unwrap().0.ends_with(" UNIQUE"));
    }

    #[test]
    fn a_default_lands_before_the_constraints() {
        let mut request = add_request("created", "timestamptz");
        request.default = Some("now()".into());
        request.nullable = false;
        request.unique = true;
        assert_eq!(
            add_column_sql(&request).unwrap().0,
            "ALTER TABLE \"public\".\"t\" ADD COLUMN \"created\" timestamptz DEFAULT now() NOT NULL UNIQUE"
        );
    }

    #[test]
    fn a_blank_default_is_treated_as_absent() {
        let mut request = add_request("note", "text");
        request.default = Some("   ".into());
        assert_eq!(
            add_column_sql(&request).unwrap().0,
            "ALTER TABLE \"public\".\"t\" ADD COLUMN \"note\" text"
        );
    }

    #[test]
    fn a_comment_becomes_a_second_statement() {
        let mut request = add_request("note", "text");
        request.comment = Some("what it holds".into());
        let (_, comment) = add_column_sql(&request).unwrap();
        assert_eq!(
            comment.unwrap(),
            "COMMENT ON COLUMN \"public\".\"t\".\"note\" IS 'what it holds'"
        );
    }

    #[test]
    fn an_empty_comment_is_treated_as_absent() {
        let mut request = add_request("note", "text");
        request.comment = Some(String::new());
        assert!(add_column_sql(&request).unwrap().1.is_none());
    }

    #[test]
    fn a_comment_with_a_quote_is_escaped() {
        let mut request = add_request("note", "text");
        request.comment = Some("it's here".into());
        assert!(add_column_sql(&request)
            .unwrap()
            .1
            .unwrap()
            .contains("'it''s here'"));
    }

    #[test]
    fn identifiers_needing_quotes_are_quoted() {
        let mut request = add_request("odd name", "text");
        request.table = "my table".into();
        assert_eq!(
            add_column_sql(&request).unwrap().0,
            "ALTER TABLE \"public\".\"my table\" ADD COLUMN \"odd name\" text"
        );
    }

    #[test]
    fn a_default_that_chains_a_statement_is_refused() {
        let mut request = add_request("note", "text");
        request.default = Some("'x'; DROP TABLE users".into());
        assert!(add_column_sql(&request).is_err());
    }

    #[test]
    fn an_empty_column_name_is_refused() {
        assert!(add_column_sql(&add_request("", "text")).is_err());
    }

    #[test]
    fn an_empty_data_type_is_refused() {
        assert!(add_column_sql(&add_request("note", "")).is_err());
    }

    #[test]
    fn a_hostile_data_type_is_refused() {
        assert!(add_column_sql(&add_request("note", "text; DROP TABLE users")).is_err());
    }

    #[test]
    fn parameterised_and_array_types_are_allowed() {
        assert!(add_column_sql(&add_request("a", "numeric(12,2)")).is_ok());
        assert!(add_column_sql(&add_request("b", "character varying(255)")).is_ok());
        assert!(add_column_sql(&add_request("c", "text[]")).is_ok());
        assert!(add_column_sql(&add_request("d", "my_schema.my_enum")).is_ok());
    }

    // ---------------------------------------------------------- alter_column

    #[test]
    fn renaming_a_column() {
        assert_eq!(
            alter("old", ColumnAction::Rename("new".into())),
            "ALTER TABLE \"public\".\"t\" RENAME COLUMN \"old\" TO \"new\""
        );
    }

    #[test]
    fn renaming_to_an_empty_name_is_refused() {
        assert!(
            alter_column_sql(&alter_request("old", ColumnAction::Rename(String::new()))).is_err()
        );
    }

    #[test]
    fn changing_type_adds_a_default_using_clause() {
        assert_eq!(
            alter(
                "amount",
                ColumnAction::ChangeType {
                    data_type: "numeric(12,2)".into(),
                    using: None,
                }
            ),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"amount\" TYPE numeric(12,2) USING \"amount\"::numeric(12,2)"
        );
    }

    #[test]
    fn a_supplied_using_clause_wins() {
        assert_eq!(
            alter(
                "amount",
                ColumnAction::ChangeType {
                    data_type: "integer".into(),
                    using: Some("round(amount)".into()),
                }
            ),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"amount\" TYPE integer USING round(amount)"
        );
    }

    #[test]
    fn a_blank_using_clause_falls_back_to_the_cast() {
        let sql = alter(
            "amount",
            ColumnAction::ChangeType {
                data_type: "integer".into(),
                using: Some("  ".into()),
            },
        );
        assert!(sql.ends_with("USING \"amount\"::integer"));
    }

    #[test]
    fn a_hostile_using_clause_is_refused() {
        assert!(alter_column_sql(&alter_request(
            "amount",
            ColumnAction::ChangeType {
                data_type: "integer".into(),
                using: Some("1; DROP TABLE users".into()),
            }
        ))
        .is_err());
    }

    #[test]
    fn setting_and_dropping_not_null() {
        assert_eq!(
            alter("note", ColumnAction::SetNullable(false)),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"note\" SET NOT NULL"
        );
        assert_eq!(
            alter("note", ColumnAction::SetNullable(true)),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"note\" DROP NOT NULL"
        );
    }

    #[test]
    fn setting_a_default() {
        assert_eq!(
            alter("created", ColumnAction::SetDefault(Some("now()".into()))),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"created\" SET DEFAULT now()"
        );
    }

    #[test]
    fn an_absent_or_blank_default_drops_it() {
        assert_eq!(
            alter("created", ColumnAction::SetDefault(None)),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"created\" DROP DEFAULT"
        );
        assert_eq!(
            alter("created", ColumnAction::SetDefault(Some("  ".into()))),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"created\" DROP DEFAULT"
        );
    }

    #[test]
    fn a_hostile_default_is_refused() {
        assert!(alter_column_sql(&alter_request(
            "created",
            ColumnAction::SetDefault(Some("now(); DROP TABLE users".into()))
        ))
        .is_err());
    }

    #[test]
    fn setting_and_clearing_a_comment() {
        assert_eq!(
            alter("note", ColumnAction::SetComment(Some("hello".into()))),
            "COMMENT ON COLUMN \"public\".\"t\".\"note\" IS 'hello'"
        );
        assert_eq!(
            alter("note", ColumnAction::SetComment(None)),
            "COMMENT ON COLUMN \"public\".\"t\".\"note\" IS NULL"
        );
        assert_eq!(
            alter("note", ColumnAction::SetComment(Some(String::new()))),
            "COMMENT ON COLUMN \"public\".\"t\".\"note\" IS NULL"
        );
    }

    #[test]
    fn a_comment_is_a_literal_not_an_expression() {
        // Comments are quoted rather than validated, so a semicolon is data.
        let sql = alter(
            "note",
            ColumnAction::SetComment(Some("a; DROP TABLE users".into())),
        );
        assert!(sql.ends_with("IS 'a; DROP TABLE users'"));
    }

    #[test]
    fn dropping_a_column_with_and_without_cascade() {
        assert_eq!(
            alter("note", ColumnAction::Drop { cascade: false }),
            "ALTER TABLE \"public\".\"t\" DROP COLUMN \"note\""
        );
        assert_eq!(
            alter("note", ColumnAction::Drop { cascade: true }),
            "ALTER TABLE \"public\".\"t\" DROP COLUMN \"note\" CASCADE"
        );
    }

    // ------------------------------------------------------ relation actions

    #[test]
    fn renaming_a_relation() {
        assert_eq!(
            rename_relation_sql("public", "old", "new").unwrap(),
            "ALTER TABLE \"public\".\"old\" RENAME TO \"new\""
        );
    }

    #[test]
    fn renaming_quotes_every_part() {
        assert_eq!(
            rename_relation_sql("my schema", "my table", "new \"name\"").unwrap(),
            "ALTER TABLE \"my schema\".\"my table\" RENAME TO \"new \"\"name\"\"\""
        );
    }

    #[test]
    fn renaming_to_an_empty_name_is_rejected() {
        assert!(rename_relation_sql("public", "t", "").is_err());
    }

    #[test]
    fn truncating_a_table() {
        assert_eq!(
            truncate_table_sql("public", "t").unwrap(),
            "TRUNCATE TABLE \"public\".\"t\""
        );
    }

    #[test]
    fn the_drop_keyword_follows_the_relation_kind() {
        assert_eq!(drop_keyword("r"), "DROP TABLE");
        assert_eq!(drop_keyword("p"), "DROP TABLE");
        assert_eq!(drop_keyword("v"), "DROP VIEW");
        assert_eq!(drop_keyword("m"), "DROP MATERIALIZED VIEW");
        assert_eq!(drop_keyword("f"), "DROP FOREIGN TABLE");
        assert_eq!(drop_keyword("anything else"), "DROP TABLE");
    }

    #[test]
    fn dropping_a_table_and_a_view() {
        assert_eq!(
            drop_relation_sql("public", "t", "r", false).unwrap(),
            "DROP TABLE \"public\".\"t\""
        );
        assert_eq!(
            drop_relation_sql("public", "v", "v", true).unwrap(),
            "DROP VIEW \"public\".\"v\" CASCADE"
        );
        assert_eq!(
            drop_relation_sql("public", "m", "m", false).unwrap(),
            "DROP MATERIALIZED VIEW \"public\".\"m\""
        );
    }

    // ------------------------------------------------------------ extensions

    #[test]
    fn extension_actions_parse_from_the_wire_names() {
        assert_eq!(
            "install".parse::<ExtensionAction>().unwrap(),
            ExtensionAction::Install
        );
        assert_eq!(
            "update".parse::<ExtensionAction>().unwrap(),
            ExtensionAction::Update
        );
        assert_eq!(
            "uninstall".parse::<ExtensionAction>().unwrap(),
            ExtensionAction::Uninstall
        );
        assert_eq!(
            "uninstallCascade".parse::<ExtensionAction>().unwrap(),
            ExtensionAction::UninstallCascade
        );
    }

    #[test]
    fn an_unknown_extension_action_is_refused() {
        assert!("drop everything".parse::<ExtensionAction>().is_err());
        assert!("".parse::<ExtensionAction>().is_err());
    }

    #[test]
    fn installing_an_extension_is_idempotent() {
        assert_eq!(
            extension_sql("pg_trgm", ExtensionAction::Install).unwrap(),
            "CREATE EXTENSION IF NOT EXISTS \"pg_trgm\""
        );
    }

    #[test]
    fn updating_and_removing_an_extension() {
        assert_eq!(
            extension_sql("pg_trgm", ExtensionAction::Update).unwrap(),
            "ALTER EXTENSION \"pg_trgm\" UPDATE"
        );
        assert_eq!(
            extension_sql("pg_trgm", ExtensionAction::Uninstall).unwrap(),
            "DROP EXTENSION \"pg_trgm\""
        );
        assert_eq!(
            extension_sql("pg_trgm", ExtensionAction::UninstallCascade).unwrap(),
            "DROP EXTENSION \"pg_trgm\" CASCADE"
        );
    }

    #[test]
    fn an_extension_name_cannot_smuggle_in_a_statement() {
        let sql = extension_sql("a\"; DROP TABLE users; --", ExtensionAction::Install).unwrap();
        assert_eq!(
            sql,
            "CREATE EXTENSION IF NOT EXISTS \"a\"\"; DROP TABLE users; --\""
        );
    }

    #[test]
    fn an_empty_extension_name_is_refused() {
        assert!(extension_sql("", ExtensionAction::Install).is_err());
    }

    // ---------------------------------------------------- validate_expression

    #[test]
    fn allows_ordinary_expressions() {
        assert!(validate_expression("now()").is_ok());
        assert!(validate_expression("'pending'").is_ok());
        assert!(validate_expression("nextval('seq'::regclass)").is_ok());
        assert!(validate_expression("'it''s ok'").is_ok());
    }

    #[test]
    fn expressions_are_trimmed() {
        assert_eq!(validate_expression("  now()  ").unwrap(), "now()");
    }

    #[test]
    fn an_empty_expression_is_refused() {
        assert!(validate_expression("").is_err());
        assert!(validate_expression("    ").is_err());
    }

    #[test]
    fn an_overlong_expression_is_refused() {
        assert!(validate_expression(&"a".repeat(513)).is_err());
        assert!(validate_expression(&"a".repeat(512)).is_ok());
    }

    #[test]
    fn rejects_chained_statements() {
        assert!(validate_expression("1; DROP TABLE users").is_err());
        assert!(validate_expression("1 -- comment").is_err());
        assert!(validate_expression("1 /* comment */").is_err());
    }

    #[test]
    fn semicolons_inside_strings_are_fine() {
        assert!(validate_expression("'a;b'").is_ok());
        assert!(validate_expression("$$a;b$$").is_ok());
        assert!(validate_expression("$tag$a;b$tag$").is_ok());
    }

    #[test]
    fn dollar_quotes_cannot_hide_a_second_statement() {
        // The lone quote inside the dollar quote used to desynchronise the
        // scanner so the semicolon after it looked like string content.
        assert!(validate_expression("$$'$$; DROP TABLE users").is_err());
        assert!(validate_expression("$t$'$t$; DROP TABLE users").is_err());
        assert!(validate_expression("'a' || $$b$$; DROP TABLE users").is_err());
    }

    #[test]
    fn an_unterminated_string_swallows_the_rest() {
        // Nothing after an unterminated quote can be a separate statement.
        assert!(validate_expression("'a; DROP TABLE users").is_ok());
    }

    #[test]
    fn a_trailing_semicolon_is_still_a_second_statement() {
        assert!(validate_expression("now();").is_err());
    }
}
