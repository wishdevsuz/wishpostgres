use std::time::Instant;

use deadpool_postgres::Client;
use futures_util::{pin_mut, TryStreamExt};
use serde_json::Value;

use crate::error::CoreResult;
use crate::models::{QueryResult, ResultColumn, TypeCategory};
use crate::value::{friendly_type_name, PgJson};

/// Hard ceiling on rows materialised for one statement. The grid virtualises
/// what it renders, but the process should never buffer an unbounded result.
pub const MAX_RESULT_ROWS: usize = 200_000;

/// Split a script into individual statements.
///
/// Handles single and double quoted strings, dollar quoting with tags, line
/// comments and nested block comments, all of which PostgreSQL allows.
pub fn split_statements(sql: &str) -> Vec<String> {
    let bytes: Vec<char> = sql.chars().collect();
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut index = 0usize;
    let mut block_depth = 0usize;

    while index < bytes.len() {
        let ch = bytes[index];

        if block_depth > 0 {
            current.push(ch);
            if ch == '*' && bytes.get(index + 1) == Some(&'/') {
                current.push('/');
                index += 2;
                block_depth -= 1;
                continue;
            }
            if ch == '/' && bytes.get(index + 1) == Some(&'*') {
                current.push('*');
                index += 2;
                block_depth += 1;
                continue;
            }
            index += 1;
            continue;
        }

        match ch {
            '-' if bytes.get(index + 1) == Some(&'-') => {
                while index < bytes.len() && bytes[index] != '\n' {
                    current.push(bytes[index]);
                    index += 1;
                }
            }
            '/' if bytes.get(index + 1) == Some(&'*') => {
                current.push('/');
                current.push('*');
                index += 2;
                block_depth = 1;
            }
            '\'' | '"' => {
                let quote = ch;
                current.push(ch);
                index += 1;
                while index < bytes.len() {
                    let inner = bytes[index];
                    current.push(inner);
                    index += 1;
                    if inner == quote {
                        if bytes.get(index) == Some(&quote) {
                            current.push(quote);
                            index += 1;
                        } else {
                            break;
                        }
                    }
                }
            }
            '$' => {
                if let Some(tag) = dollar_tag(&bytes, index) {
                    let closing: Vec<char> = tag.chars().collect();
                    current.push_str(&tag);
                    index += closing.len();
                    while index < bytes.len() {
                        if bytes[index..].starts_with(&closing[..]) {
                            current.push_str(&tag);
                            index += closing.len();
                            break;
                        }
                        current.push(bytes[index]);
                        index += 1;
                    }
                } else {
                    current.push(ch);
                    index += 1;
                }
            }
            ';' => {
                index += 1;
                if !current.trim().is_empty() {
                    statements.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => {
                current.push(ch);
                index += 1;
            }
        }
    }

    if !current.trim().is_empty() {
        statements.push(current.trim().to_string());
    }
    statements
}

/// Read a dollar-quote opening tag such as `$$` or `$body$` at `start`.
fn dollar_tag(chars: &[char], start: usize) -> Option<String> {
    let mut cursor = start + 1;
    let mut tag = String::from("$");
    while cursor < chars.len() {
        let ch = chars[cursor];
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

/// Run a single statement and materialise its result.
pub async fn execute_statement(client: &Client, sql: &str) -> CoreResult<QueryResult> {
    let started = Instant::now();
    let statement = client.prepare(sql).await?;
    let command = leading_keyword(sql);

    if statement.columns().is_empty() {
        let affected = client.execute(&statement, &[]).await?;
        return Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: 0,
            affected_rows: Some(affected),
            duration_ms: started.elapsed().as_millis() as u64,
            command,
            truncated: false,
        });
    }

    let columns: Vec<ResultColumn> = statement
        .columns()
        .iter()
        .map(|column| {
            let data_type = friendly_type_name(column.type_());
            let is_array = data_type.ends_with("[]");
            let is_enum = matches!(column.type_().kind(), tokio_postgres::types::Kind::Enum(_));
            ResultColumn {
                name: column.name().to_string(),
                type_category: TypeCategory::from_pg(
                    data_type.trim_end_matches("[]"),
                    is_enum,
                    is_array,
                ),
                data_type,
            }
        })
        .collect();

    let stream = client
        .query_raw::<_, &str, _>(&statement, std::iter::empty())
        .await?;
    pin_mut!(stream);

    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut truncated = false;
    while let Some(row) = stream.try_next().await? {
        if rows.len() >= MAX_RESULT_ROWS {
            truncated = true;
            break;
        }
        rows.push(
            (0..columns.len())
                .map(|index| row.get::<_, PgJson>(index).0)
                .collect(),
        );
    }

    Ok(QueryResult {
        row_count: rows.len(),
        affected_rows: None,
        duration_ms: started.elapsed().as_millis() as u64,
        command,
        columns,
        rows,
        truncated,
    })
}

/// Run every statement in a script, returning one result per statement.
pub async fn execute_script(client: &Client, sql: &str) -> CoreResult<Vec<QueryResult>> {
    let statements = split_statements(sql);
    if statements.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::with_capacity(statements.len());
    for statement in statements {
        results.push(execute_statement(client, &statement).await?);
    }
    Ok(results)
}

fn leading_keyword(sql: &str) -> String {
    sql.split_whitespace()
        .find(|word| !word.starts_with("--"))
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_uppercase()
        })
        .filter(|word| !word.is_empty())
        .unwrap_or_else(|| "QUERY".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_statements() {
        let parts = split_statements("SELECT 1; SELECT 2;");
        assert_eq!(parts, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn keeps_semicolons_inside_strings() {
        let parts = split_statements("SELECT 'a;b'; SELECT 2");
        assert_eq!(parts, vec!["SELECT 'a;b'", "SELECT 2"]);
    }

    #[test]
    fn keeps_semicolons_inside_dollar_quotes() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ \
                   LANGUAGE plpgsql; SELECT f()";
        let parts = split_statements(sql);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains("RETURN 1;"));
        assert_eq!(parts[1], "SELECT f()");
    }

    #[test]
    fn keeps_semicolons_inside_comments() {
        let parts = split_statements("SELECT 1 -- one; two\n; /* three; */ SELECT 2");
        assert_eq!(parts.len(), 2);
        assert!(parts[1].contains("SELECT 2"));
    }

    #[test]
    fn handles_nested_block_comments() {
        let parts = split_statements("/* outer /* inner; */ still; */ SELECT 1");
        assert_eq!(parts.len(), 1);
    }

    #[test]
    fn handles_escaped_quotes() {
        let parts = split_statements("SELECT 'it''s; fine'; SELECT 2");
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn extracts_command_keyword() {
        assert_eq!(leading_keyword("  select * from t"), "SELECT");
        assert_eq!(leading_keyword("INSERT INTO t VALUES (1)"), "INSERT");
    }
}
