use std::time::Instant;

use deadpool_postgres::Client;
use futures_util::{pin_mut, TryStreamExt};
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
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
                push_statement(&mut statements, &current);
                current.clear();
            }
            _ => {
                current.push(ch);
                index += 1;
            }
        }
    }

    push_statement(&mut statements, &current);
    statements
}

/// Keep a chunk only when it contains SQL.
///
/// A run of comments between two semicolons is not a statement: sending it on
/// would have PostgreSQL answer with an empty query response the user has no
/// way to interpret.
fn push_statement(statements: &mut Vec<String>, chunk: &str) {
    let trimmed = chunk.trim();
    if !trimmed.is_empty() && !is_only_comments(trimmed) {
        statements.push(trimmed.to_string());
    }
}

/// Whether a chunk is nothing but comments and whitespace.
fn is_only_comments(sql: &str) -> bool {
    let chars: Vec<char> = sql.chars().collect();
    let mut index = 0usize;
    let mut block_depth = 0usize;

    while index < chars.len() {
        if block_depth > 0 {
            if chars[index] == '*' && chars.get(index + 1) == Some(&'/') {
                block_depth -= 1;
                index += 2;
            } else if chars[index] == '/' && chars.get(index + 1) == Some(&'*') {
                block_depth += 1;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        match chars[index] {
            c if c.is_whitespace() => index += 1,
            '-' if chars.get(index + 1) == Some(&'-') => {
                while index < chars.len() && chars[index] != '\n' {
                    index += 1;
                }
            }
            '/' if chars.get(index + 1) == Some(&'*') => {
                block_depth = 1;
                index += 2;
            }
            _ => return false,
        }
    }
    true
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

/// Statements PostgreSQL refuses to run through the extended query protocol,
/// because that protocol wraps every statement in an implicit transaction and
/// these commands cannot run inside a transaction block.
///
/// They are sent through the simple query protocol instead, which is how `psql`
/// runs them.
const SIMPLE_PROTOCOL_ONLY: [&[&str]; 10] = [
    &["VACUUM"],
    &["CREATE", "DATABASE"],
    &["DROP", "DATABASE"],
    &["ALTER", "DATABASE"],
    &["CREATE", "TABLESPACE"],
    &["DROP", "TABLESPACE"],
    &["ALTER", "SYSTEM"],
    &["REINDEX"],
    &["CLUSTER"],
    &["DISCARD"],
];

/// Whether a statement has to go through the simple query protocol.
///
/// `CREATE INDEX` and `DROP INDEX` only need it with `CONCURRENTLY`, and
/// `REINDEX`/`CLUSTER` are listed unconditionally because their non-concurrent
/// forms work either way.
fn needs_simple_protocol(sql: &str) -> bool {
    let words: Vec<String> = sql
        .split_whitespace()
        .take(4)
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_uppercase()
        })
        .filter(|word| !word.is_empty())
        .collect();

    if words.is_empty() {
        return false;
    }

    if SIMPLE_PROTOCOL_ONLY.iter().any(|prefix| {
        words.len() >= prefix.len()
            && words[..prefix.len()]
                .iter()
                .zip(prefix.iter())
                .all(|(word, expected)| word == expected)
    }) {
        return true;
    }

    matches!(words[0].as_str(), "CREATE" | "DROP") && words.contains(&"CONCURRENTLY".to_string())
}

/// Run a statement through the simple query protocol, where every value comes
/// back as text and there is no implicit transaction.
async fn execute_simple(client: &Client, sql: &str, started: Instant) -> CoreResult<QueryResult> {
    use tokio_postgres::SimpleQueryMessage;

    let messages = client.simple_query(sql).await?;
    let command = leading_keyword(sql);

    let mut columns: Vec<ResultColumn> = Vec::new();
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut affected: Option<u64> = None;

    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(description) => {
                columns = description
                    .iter()
                    .map(|column| ResultColumn {
                        name: column.name().to_string(),
                        data_type: "text".to_string(),
                        type_category: TypeCategory::Text,
                    })
                    .collect();
            }
            SimpleQueryMessage::Row(row) => {
                rows.push(
                    (0..row.len())
                        .map(|index| match row.get(index) {
                            Some(text) => Value::String(text.to_string()),
                            None => Value::Null,
                        })
                        .collect(),
                );
            }
            SimpleQueryMessage::CommandComplete(count) => {
                affected = Some(affected.unwrap_or(0) + count);
            }
            _ => {}
        }
    }

    Ok(QueryResult {
        row_count: rows.len(),
        affected_rows: if columns.is_empty() { affected } else { None },
        duration_ms: started.elapsed().as_millis() as u64,
        command,
        columns,
        rows,
        truncated: false,
    })
}

/// Run a single statement and materialise its result.
pub async fn execute_statement(client: &Client, sql: &str) -> CoreResult<QueryResult> {
    let started = Instant::now();
    if needs_simple_protocol(sql) {
        return execute_simple(client, sql, started).await;
    }

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

/// Run one statement under an `EXPLAIN` prefix and return the plan as text.
///
/// Generic over the client so the caller can hand in a transaction: an
/// `EXPLAIN ANALYZE` really executes its statement, so a plan for anything that
/// writes has to be taken inside a transaction the caller then rolls back.
pub async fn explain<C>(client: &C, statement: &str, prefix: &str) -> CoreResult<String>
where
    C: deadpool_postgres::GenericClient + Sync,
{
    let rows = client.query(&format!("{prefix}{statement}"), &[]).await?;
    Ok(rows
        .iter()
        .map(|row| row.get::<_, String>(0))
        .collect::<Vec<_>>()
        .join("\n"))
}

/// Run every statement in a script, returning one result per statement.
pub async fn execute_script(client: &Client, sql: &str) -> CoreResult<Vec<QueryResult>> {
    let statements = split_statements(sql);
    if statements.is_empty() {
        return Err(CoreError::Invalid("there is nothing to run".into()));
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
    fn routes_transaction_hostile_statements_to_the_simple_protocol() {
        assert!(needs_simple_protocol("VACUUM ANALYZE users"));
        assert!(needs_simple_protocol("  vacuum full  "));
        assert!(needs_simple_protocol("CREATE DATABASE shop"));
        assert!(needs_simple_protocol("DROP DATABASE shop"));
        assert!(needs_simple_protocol("ALTER SYSTEM SET work_mem = '64MB'"));
        assert!(needs_simple_protocol("REINDEX TABLE users"));
        assert!(needs_simple_protocol(
            "CREATE INDEX CONCURRENTLY idx ON users (email)"
        ));

        assert!(!needs_simple_protocol("SELECT 1"));
        assert!(!needs_simple_protocol("CREATE TABLE t (id int)"));
        assert!(!needs_simple_protocol("CREATE INDEX idx ON users (email)"));
        assert!(!needs_simple_protocol("UPDATE users SET name = 'vacuum'"));
        assert!(!needs_simple_protocol(""));
    }

    #[test]
    fn extracts_command_keyword() {
        assert_eq!(leading_keyword("  select * from t"), "SELECT");
        assert_eq!(leading_keyword("INSERT INTO t VALUES (1)"), "INSERT");
    }

    // ------------------------------------------------- split_statements edges

    #[test]
    fn an_empty_script_yields_nothing() {
        assert!(split_statements("").is_empty());
        assert!(split_statements("   \n\t  ").is_empty());
        assert!(split_statements(";;;").is_empty());
    }

    #[test]
    fn a_statement_without_a_terminator_still_counts() {
        assert_eq!(split_statements("SELECT 1"), vec!["SELECT 1"]);
    }

    #[test]
    fn trailing_whitespace_is_trimmed_from_each_statement() {
        assert_eq!(
            split_statements("  SELECT 1  ;   SELECT 2  "),
            vec!["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn a_comment_only_script_yields_nothing() {
        assert!(split_statements("-- just a note").is_empty());
        assert!(split_statements("/* just a note */").is_empty());
    }

    #[test]
    fn double_quoted_identifiers_can_contain_a_semicolon() {
        let parts = split_statements("SELECT * FROM \"od;d\"; SELECT 2");
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains("\"od;d\""));
    }

    #[test]
    fn a_dollar_quote_tag_must_match_to_close() {
        let parts = split_statements("SELECT $a$ x; $b$ y; $a$; SELECT 2");
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn an_unterminated_dollar_quote_swallows_the_rest() {
        assert_eq!(split_statements("SELECT $$ a; b").len(), 1);
    }

    #[test]
    fn an_unterminated_block_comment_swallows_the_rest() {
        // "SELECT 1" stays; the dangling comment is not a statement of its own.
        assert_eq!(split_statements("SELECT 1; /* a; b"), vec!["SELECT 1"]);
        assert_eq!(split_statements("SELECT 1 /* a; b").len(), 1);
    }

    #[test]
    fn comments_between_statements_are_dropped() {
        assert_eq!(
            split_statements("SELECT 1; -- note\n; SELECT 2"),
            vec!["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn a_comment_attached_to_a_statement_is_kept_with_it() {
        let parts = split_statements("-- why\nSELECT 1");
        assert_eq!(parts.len(), 1);
        assert!(parts[0].contains("-- why"));
    }

    #[test]
    fn recognises_chunks_that_are_only_comments() {
        assert!(is_only_comments(""));
        assert!(is_only_comments("   \n  "));
        assert!(is_only_comments("-- a note"));
        assert!(is_only_comments("/* a note */"));
        assert!(is_only_comments("/* outer /* inner */ still */"));
        assert!(is_only_comments("-- one\n /* two */ \n-- three"));

        assert!(!is_only_comments("SELECT 1"));
        assert!(!is_only_comments("-- note\nSELECT 1"));
        assert!(!is_only_comments("/* note */ SELECT 1"));
    }

    #[test]
    fn a_line_comment_ends_at_the_newline() {
        let parts = split_statements("SELECT 1; -- note\nSELECT 2");
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn many_statements_are_all_kept() {
        let script = (1..=25)
            .map(|n| format!("SELECT {n};"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(split_statements(&script).len(), 25);
    }

    #[test]
    fn a_dollar_sign_that_is_not_a_quote_is_ordinary() {
        // `$1` is a parameter placeholder, not the start of a dollar quote.
        let parts = split_statements("SELECT $1; SELECT 2");
        assert_eq!(parts.len(), 2);
    }

    // ---------------------------------------------------- needs_simple_protocol

    #[test]
    fn more_transaction_hostile_statements_are_recognised() {
        assert!(needs_simple_protocol("CLUSTER users"));
        assert!(needs_simple_protocol("DROP INDEX CONCURRENTLY idx"));
    }

    #[test]
    fn concurrently_further_along_the_statement_still_counts() {
        assert!(needs_simple_protocol(
            "CREATE UNIQUE INDEX CONCURRENTLY idx"
        ));
    }

    #[test]
    fn leading_whitespace_does_not_hide_the_keyword() {
        assert!(needs_simple_protocol("\n\t  VACUUM users"));
    }

    #[test]
    fn a_column_named_like_a_keyword_is_not_mistaken() {
        assert!(!needs_simple_protocol("SELECT vacuum FROM t"));
        assert!(!needs_simple_protocol("INSERT INTO t (cluster) VALUES (1)"));
    }

    // ------------------------------------------------------- leading_keyword

    #[test]
    fn the_command_keyword_is_upper_cased() {
        assert_eq!(leading_keyword("select 1"), "SELECT");
        assert_eq!(leading_keyword("  insert into t values (1)"), "INSERT");
    }

    #[test]
    fn punctuation_around_the_keyword_is_stripped() {
        assert_eq!(leading_keyword("(SELECT 1)"), "SELECT");
    }

    #[test]
    fn an_empty_statement_reports_a_generic_command() {
        assert_eq!(leading_keyword(""), "QUERY");
        assert_eq!(leading_keyword("   "), "QUERY");
    }

    #[test]
    fn a_leading_comment_is_skipped_when_finding_the_keyword() {
        assert_eq!(leading_keyword("--note\nSELECT 1"), "SELECT");
    }
}
