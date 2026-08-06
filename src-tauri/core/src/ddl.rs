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

pub async fn add_column(client: &Client, request: &AddColumnRequest) -> CoreResult<String> {
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

    client.batch_execute(&sql).await?;

    if let Some(comment) = request.comment.as_ref().filter(|text| !text.is_empty()) {
        let comment_sql = format!(
            "COMMENT ON COLUMN {relation}.{column} IS {}",
            quote_literal(comment)
        );
        client.batch_execute(&comment_sql).await?;
        return Ok(format!("{sql};\n{comment_sql};"));
    }

    Ok(format!("{sql};"))
}

pub async fn alter_column(client: &Client, request: &AlterColumnRequest) -> CoreResult<String> {
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

    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

pub async fn rename_relation(
    client: &Client,
    schema: &str,
    table: &str,
    new_name: &str,
) -> CoreResult<String> {
    let sql = format!(
        "ALTER TABLE {} RENAME TO {}",
        quote_relation(schema, table)?,
        quote_ident(new_name)?
    );
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
}

pub async fn truncate_table(client: &Client, schema: &str, table: &str) -> CoreResult<String> {
    let sql = format!("TRUNCATE TABLE {}", quote_relation(schema, table)?);
    client.batch_execute(&sql).await?;
    Ok(format!("{sql};"))
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

    let keyword = match kind.as_str() {
        "v" => "DROP VIEW",
        "m" => "DROP MATERIALIZED VIEW",
        "f" => "DROP FOREIGN TABLE",
        _ => "DROP TABLE",
    };

    let sql = format!(
        "{keyword} {relation}{}",
        if cascade { " CASCADE" } else { "" }
    );
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

    #[test]
    fn allows_ordinary_expressions() {
        assert!(validate_expression("now()").is_ok());
        assert!(validate_expression("'pending'").is_ok());
        assert!(validate_expression("nextval('seq'::regclass)").is_ok());
        assert!(validate_expression("'it''s ok'").is_ok());
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
}
