//! Reading and writing table rows.
//!
//! Values are always bound as text parameters with an explicit `::type` cast
//! derived from the catalog, so no user supplied value is ever concatenated
//! into a statement. Identifiers go through [`crate::ident`].

use std::time::Instant;

use deadpool_postgres::Client;
use futures_util::{pin_mut, TryStreamExt};
use serde_json::Value;
use tokio_postgres::types::ToSql;

use crate::error::{CoreError, CoreResult};
use crate::ident::{quote_ident, quote_relation};
use crate::introspect;
use crate::models::*;
use crate::value::PgJson;

/// Above this many rows an exact `count(*)` is replaced by the planner
/// estimate, which keeps browsing instant on very large tables.
const ESTIMATE_THRESHOLD: i64 = 500_000;

pub async fn browse(client: &Client, request: &BrowseRequest) -> CoreResult<BrowseResult> {
    let started = Instant::now();
    let relation = quote_relation(&request.schema, &request.table)?;
    let columns = introspect::columns(client, &request.schema, &request.table).await?;
    if columns.is_empty() {
        return Err(CoreError::Invalid(format!(
            "`{}.{}` has no readable columns",
            request.schema, request.table
        )));
    }

    let relkind: String = client
        .query_one(
            "SELECT c.relkind::text FROM pg_class c WHERE c.oid = $1::text::regclass",
            &[&relation],
        )
        .await?
        .get(0);
    let is_table = matches!(relkind.as_str(), "r" | "p");

    let identity = choose_identity(&columns, is_table);
    let mut params: Vec<Option<String>> = Vec::new();
    let where_clause = build_where(&columns, request, &mut params)?;

    let page = build_select(&relation, &columns, &identity, request, &where_clause)?;
    let (sql, value_count) = (page.sql, page.value_count);

    let stream = client.query_raw(&sql, params.iter()).await?;
    pin_mut!(stream);

    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut identity_values: Vec<Vec<Value>> = Vec::new();
    while let Some(row) = stream.try_next().await? {
        let values: Vec<Value> = (0..value_count)
            .map(|index| row.get::<_, PgJson>(index).0)
            .collect();

        identity_values.push(match identity.kind {
            IdentityKind::Ctid => vec![row.get::<_, PgJson>(value_count).0],
            IdentityKind::PrimaryKey | IdentityKind::Unique => identity
                .columns
                .iter()
                .filter_map(|name| columns.iter().position(|column| &column.name == name))
                .map(|index| values[index].clone())
                .collect(),
            IdentityKind::None => Vec::new(),
        });
        rows.push(values);
    }

    let (total_rows, is_estimate) = count_rows(
        client,
        &relation,
        &where_clause,
        &params,
        request.exact_count,
    )
    .await?;

    Ok(BrowseResult {
        columns,
        rows,
        total_rows,
        is_estimate,
        duration_ms: started.elapsed().as_millis() as u64,
        editable: is_table && identity.kind != IdentityKind::None,
        identity,
        identity_values,
    })
}

async fn count_rows(
    client: &Client,
    relation: &str,
    where_clause: &str,
    params: &[Option<String>],
    exact: bool,
) -> CoreResult<(Option<i64>, bool)> {
    if !exact && where_clause.is_empty() {
        let estimate: Option<i64> = client
            .query_one(
                "SELECT CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END
                 FROM pg_class c WHERE c.oid = $1::text::regclass",
                &[&relation],
            )
            .await?
            .get(0);

        if let Some(value) = estimate {
            if value > ESTIMATE_THRESHOLD {
                return Ok((Some(value), true));
            }
        }
    }

    let sql = format!("SELECT count(*) FROM {relation}{where_clause}");
    let stream = client.query_raw(&sql, params.iter()).await?;
    pin_mut!(stream);
    let total = match stream.try_next().await? {
        Some(row) => row.get::<_, i64>(0),
        None => 0,
    };
    Ok((Some(total), false))
}

fn choose_identity(columns: &[ColumnMeta], is_table: bool) -> RowIdentity {
    let primary: Vec<String> = columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect();
    if !primary.is_empty() {
        return RowIdentity {
            kind: IdentityKind::PrimaryKey,
            columns: primary,
        };
    }

    let unique: Vec<String> = columns
        .iter()
        .filter(|column| column.is_unique && !column.nullable)
        .map(|column| column.name.clone())
        .collect();
    if !unique.is_empty() {
        return RowIdentity {
            kind: IdentityKind::Unique,
            columns: unique,
        };
    }

    if is_table {
        return RowIdentity {
            kind: IdentityKind::Ctid,
            columns: vec!["ctid".to_string()],
        };
    }

    RowIdentity {
        kind: IdentityKind::None,
        columns: Vec::new(),
    }
}

/// The `SELECT` for one page of a relation, and how many of its columns are
/// data rather than the appended row identity.
pub struct PageQuery {
    pub sql: String,
    pub value_count: usize,
}

/// Build the paged `SELECT` used by [`browse`].
///
/// `limit` and `offset` are clamped here rather than bound, because PostgreSQL
/// will not take a parameter for either; every other value in the statement is
/// a bound parameter and every name goes through [`quote_ident`].
pub fn build_select(
    relation: &str,
    columns: &[ColumnMeta],
    identity: &RowIdentity,
    request: &BrowseRequest,
    where_clause: &str,
) -> CoreResult<PageQuery> {
    let mut select: Vec<String> = columns
        .iter()
        .map(|column| quote_ident(&column.name))
        .collect::<CoreResult<_>>()?;
    let value_count = select.len();
    if identity.kind == IdentityKind::Ctid {
        select.push("ctid::text".to_string());
    }

    let order = build_order(columns, &request.sort)?;
    let limit = request.limit.clamp(1, 100_000);
    let offset = request.offset.max(0);

    Ok(PageQuery {
        sql: format!(
            "SELECT {} FROM {relation}{where_clause}{order} LIMIT {limit} OFFSET {offset}",
            select.join(", ")
        ),
        value_count,
    })
}

fn build_where(
    columns: &[ColumnMeta],
    request: &BrowseRequest,
    params: &mut Vec<Option<String>>,
) -> CoreResult<String> {
    let mut clauses: Vec<String> = Vec::new();

    for filter in &request.filters {
        let column = find_column(columns, &filter.column)?;
        let quoted = quote_ident(&column.name)?;

        let clause = match filter.operator {
            FilterOperator::IsNull => format!("{quoted} IS NULL"),
            FilterOperator::IsNotNull => format!("{quoted} IS NOT NULL"),
            FilterOperator::Contains
            | FilterOperator::NotContains
            | FilterOperator::StartsWith
            | FilterOperator::EndsWith => {
                let raw = filter.value.clone().unwrap_or_default();
                let escaped = raw
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                let pattern = match filter.operator {
                    FilterOperator::StartsWith => format!("{escaped}%"),
                    FilterOperator::EndsWith => format!("%{escaped}"),
                    _ => format!("%{escaped}%"),
                };
                params.push(Some(pattern));
                let negate = filter.operator == FilterOperator::NotContains;
                format!(
                    "{quoted}::text {}ILIKE ${}",
                    if negate { "NOT " } else { "" },
                    params.len()
                )
            }
            other => {
                if filter.value.is_none() && other.needs_value() {
                    return Err(CoreError::Invalid(format!(
                        "the filter on `{}` needs a value",
                        column.name
                    )));
                }
                params.push(filter.value.clone());
                format!(
                    "{quoted} {} {}",
                    comparison_operator(other),
                    text_param(params.len(), &column.data_type)
                )
            }
        };
        clauses.push(clause);
    }

    if let Some(term) = request
        .search
        .as_ref()
        .filter(|term| !term.trim().is_empty())
    {
        let escaped = term
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        params.push(Some(format!("%{escaped}%")));
        let index = params.len();
        let searchable: Vec<String> = columns
            .iter()
            .map(|column| {
                Ok(format!(
                    "{}::text ILIKE ${index}",
                    quote_ident(&column.name)?
                ))
            })
            .collect::<CoreResult<_>>()?;
        clauses.push(format!("({})", searchable.join(" OR ")));
    }

    Ok(if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    })
}

fn comparison_operator(operator: FilterOperator) -> &'static str {
    match operator {
        FilterOperator::Equals => "=",
        FilterOperator::NotEquals => "<>",
        FilterOperator::GreaterThan => ">",
        FilterOperator::GreaterOrEqual => ">=",
        FilterOperator::LessThan => "<",
        FilterOperator::LessOrEqual => "<=",
        _ => "=",
    }
}

fn build_order(columns: &[ColumnMeta], sort: &[SortSpec]) -> CoreResult<String> {
    if sort.is_empty() {
        return Ok(String::new());
    }
    let parts: Vec<String> = sort
        .iter()
        .map(|spec| {
            let column = find_column(columns, &spec.column)?;
            Ok(format!(
                "{} {} NULLS LAST",
                quote_ident(&column.name)?,
                spec.direction.as_sql()
            ))
        })
        .collect::<CoreResult<_>>()?;
    Ok(format!(" ORDER BY {}", parts.join(", ")))
}

fn find_column<'a>(columns: &'a [ColumnMeta], name: &str) -> CoreResult<&'a ColumnMeta> {
    columns
        .iter()
        .find(|column| column.name == name)
        .ok_or_else(|| CoreError::Invalid(format!("there is no column named `{name}`")))
}

/// Render a placeholder for a value that is always sent as text.
///
/// Every parameter in this module is an `Option<String>`, because that is what
/// the grid and the forms produce. Writing `$1::integer` would make PostgreSQL
/// infer the *parameter* as `integer`, and the driver then refuses to send a
/// Rust `String` for it — the whole statement fails with "error serializing
/// parameter 0". Casting through `text` first pins the parameter to `text` and
/// leaves the conversion to PostgreSQL's own input function, which is the same
/// one a literal would go through.
fn text_param(index: usize, data_type: &str) -> String {
    format!("${index}::text::{data_type}")
}

fn as_sql_params(params: &[Option<String>]) -> Vec<&(dyn ToSql + Sync)> {
    params
        .iter()
        .map(|value| value as &(dyn ToSql + Sync))
        .collect()
}

/// Convert a JSON identity value coming back from the grid into a text parameter.
fn identity_param(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Number(number) => Some(number.to_string()),
        other => Some(other.to_string()),
    }
}

fn identity_predicate(
    identity: &RowIdentity,
    columns: &[ColumnMeta],
    values: &[Value],
    params: &mut Vec<Option<String>>,
) -> CoreResult<String> {
    if identity.kind == IdentityKind::None {
        return Err(CoreError::Invalid(
            "this result has no primary key or row identity, so it cannot be edited".into(),
        ));
    }

    if identity.kind == IdentityKind::Ctid {
        let value = values
            .first()
            .ok_or_else(|| CoreError::Invalid("the row identity is missing".into()))?;
        params.push(identity_param(value));
        return Ok(format!("ctid = {}", text_param(params.len(), "tid")));
    }

    if values.len() != identity.columns.len() {
        return Err(CoreError::Invalid(
            "the row identity does not match the key columns".into(),
        ));
    }

    let mut clauses = Vec::with_capacity(values.len());
    for (name, value) in identity.columns.iter().zip(values) {
        let column = find_column(columns, name)?;
        let quoted = quote_ident(&column.name)?;
        match identity_param(value) {
            None => clauses.push(format!("{quoted} IS NULL")),
            Some(text) => {
                params.push(Some(text));
                clauses.push(format!(
                    "{quoted} = {}",
                    text_param(params.len(), &column.data_type)
                ));
            }
        }
    }
    Ok(clauses.join(" AND "))
}

/// Apply an inline cell edit.
pub async fn update_cell(client: &Client, change: &RowChange) -> CoreResult<u64> {
    let relation = quote_relation(&change.schema, &change.table)?;
    let columns = introspect::columns(client, &change.schema, &change.table).await?;
    let target = find_column(&columns, &change.column)?;

    if target.is_generated {
        return Err(CoreError::Invalid(format!(
            "`{}` is a generated column and cannot be written to",
            target.name
        )));
    }

    let (sql, params) = build_update(&relation, &columns, change)?;
    let affected = client.execute(&sql, &as_sql_params(&params)).await?;

    if affected == 0 {
        return Err(CoreError::Invalid(
            "no row matched — it may have been changed by someone else. Refresh and try again."
                .into(),
        ));
    }
    Ok(affected)
}

pub async fn insert_row(client: &Client, request: &InsertRequest) -> CoreResult<u64> {
    let relation = quote_relation(&request.schema, &request.table)?;
    let columns = introspect::columns(client, &request.schema, &request.table).await?;

    let supplied: Vec<&FieldValue> = request
        .values
        .iter()
        .filter(|field| !field.use_default)
        .collect();

    if supplied.is_empty() {
        let affected = client
            .execute(&format!("INSERT INTO {relation} DEFAULT VALUES"), &[])
            .await?;
        return Ok(affected);
    }

    match build_insert(&relation, &columns, &supplied)? {
        None => Ok(client
            .execute(&format!("INSERT INTO {relation} DEFAULT VALUES"), &[])
            .await?),
        Some((sql, params)) => Ok(client.execute(&sql, &as_sql_params(&params)).await?),
    }
}

/// Build the `INSERT`, or `None` when every supplied column turned out to be
/// generated and the row is entirely defaults.
pub fn build_insert(
    relation: &str,
    columns: &[ColumnMeta],
    supplied: &[&FieldValue],
) -> CoreResult<Option<(String, Vec<Option<String>>)>> {
    let mut names = Vec::with_capacity(supplied.len());
    let mut placeholders = Vec::with_capacity(supplied.len());
    let mut params: Vec<Option<String>> = Vec::with_capacity(supplied.len());

    for field in supplied {
        let column = find_column(columns, &field.column)?;
        if column.is_generated {
            continue;
        }
        names.push(quote_ident(&column.name)?);
        params.push(field.value.clone());
        placeholders.push(text_param(params.len(), &column.data_type));
    }

    if names.is_empty() {
        return Ok(None);
    }

    Ok(Some((
        format!(
            "INSERT INTO {relation} ({}) VALUES ({})",
            names.join(", "),
            placeholders.join(", ")
        ),
        params,
    )))
}

/// Build the single-cell `UPDATE`, with the row identity as its predicate.
pub fn build_update(
    relation: &str,
    columns: &[ColumnMeta],
    change: &RowChange,
) -> CoreResult<(String, Vec<Option<String>>)> {
    let target = find_column(columns, &change.column)?;
    let mut params: Vec<Option<String>> = vec![change.value.clone()];
    let assignment = format!(
        "{} = {}",
        quote_ident(&target.name)?,
        text_param(1, &target.data_type)
    );
    let predicate = identity_predicate(
        &change.identity,
        columns,
        &change.identity_values,
        &mut params,
    )?;
    Ok((
        format!("UPDATE {relation} SET {assignment} WHERE {predicate}"),
        params,
    ))
}

/// Build the `DELETE`, one `OR`-ed identity predicate per selected row.
pub fn build_delete(
    relation: &str,
    columns: &[ColumnMeta],
    request: &DeleteRequest,
) -> CoreResult<(String, Vec<Option<String>>)> {
    let mut params: Vec<Option<String>> = Vec::new();
    let mut predicates = Vec::with_capacity(request.rows.len());
    for values in &request.rows {
        predicates.push(format!(
            "({})",
            identity_predicate(&request.identity, columns, values, &mut params)?
        ));
    }
    Ok((
        format!("DELETE FROM {relation} WHERE {}", predicates.join(" OR ")),
        params,
    ))
}

pub async fn delete_rows(client: &Client, request: &DeleteRequest) -> CoreResult<u64> {
    if request.rows.is_empty() {
        return Ok(0);
    }
    let relation = quote_relation(&request.schema, &request.table)?;
    let columns = introspect::columns(client, &request.schema, &request.table).await?;

    let (sql, params) = build_delete(&relation, &columns, request)?;
    Ok(client.execute(&sql, &as_sql_params(&params)).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ident::SortDirection;
    use crate::testing::{
        browse_request, column, ctid_identity, field, filter, primary_key, ColumnExt,
    };
    use serde_json::json;

    fn where_of(columns: &[ColumnMeta], request: &BrowseRequest) -> (String, Vec<Option<String>>) {
        let mut params = Vec::new();
        let clause = build_where(columns, request, &mut params).unwrap();
        (clause, params)
    }

    // ---------------------------------------------------------------- identity

    #[test]
    fn prefers_the_primary_key() {
        let columns = vec![column("id", "integer").primary(), column("name", "text")];
        let identity = choose_identity(&columns, true);
        assert_eq!(identity.kind, IdentityKind::PrimaryKey);
        assert_eq!(identity.columns, vec!["id"]);
    }

    #[test]
    fn a_composite_primary_key_keeps_every_column() {
        let columns = vec![
            column("tenant", "uuid").primary(),
            column("id", "integer").primary(),
        ];
        let identity = choose_identity(&columns, true);
        assert_eq!(identity.columns, vec!["tenant", "id"]);
    }

    #[test]
    fn falls_back_to_a_unique_not_null_column() {
        let columns = vec![column("email", "text").unique().not_null()];
        let identity = choose_identity(&columns, true);
        assert_eq!(identity.kind, IdentityKind::Unique);
        assert_eq!(identity.columns, vec!["email"]);
    }

    #[test]
    fn a_nullable_unique_column_cannot_identify_a_row() {
        // NULL never equals NULL, so such a column would match nothing.
        let columns = vec![column("email", "text").unique()];
        assert_eq!(choose_identity(&columns, true).kind, IdentityKind::Ctid);
    }

    #[test]
    fn falls_back_to_ctid_for_tables() {
        let columns = vec![column("name", "text")];
        let identity = choose_identity(&columns, true);
        assert_eq!(identity.kind, IdentityKind::Ctid);
        assert_eq!(identity.columns, vec!["ctid"]);
    }

    #[test]
    fn views_are_not_identifiable() {
        let columns = vec![column("name", "text")];
        assert_eq!(choose_identity(&columns, false).kind, IdentityKind::None);
    }

    #[test]
    fn a_view_with_a_primary_key_column_is_still_identifiable() {
        // A materialised view can carry a unique index the catalog reports.
        let columns = vec![column("id", "integer").primary()];
        assert_eq!(
            choose_identity(&columns, false).kind,
            IdentityKind::PrimaryKey
        );
    }

    // ------------------------------------------------------------ text_param

    #[test]
    fn every_placeholder_casts_through_text() {
        assert_eq!(text_param(1, "integer"), "$1::text::integer");
        assert_eq!(text_param(7, "timestamptz"), "$7::text::timestamptz");
    }

    #[test]
    fn placeholders_keep_parameterised_type_modifiers() {
        assert_eq!(
            text_param(2, "character varying(120)"),
            "$2::text::character varying(120)"
        );
        assert_eq!(text_param(3, "numeric(12,2)"), "$3::text::numeric(12,2)");
    }

    #[test]
    fn placeholders_handle_array_types() {
        assert_eq!(text_param(1, "integer[]"), "$1::text::integer[]");
    }

    // ---------------------------------------------------------- identity_param

    #[test]
    fn identity_values_become_text() {
        assert_eq!(identity_param(&json!("abc")), Some("abc".to_string()));
        assert_eq!(identity_param(&json!(42)), Some("42".to_string()));
        assert_eq!(identity_param(&json!(true)), Some("true".to_string()));
        assert_eq!(identity_param(&Value::Null), None);
    }

    #[test]
    fn a_numeric_identity_keeps_its_precision() {
        assert_eq!(
            identity_param(&json!(9007199254740993i64)),
            Some("9007199254740993".to_string())
        );
    }

    #[test]
    fn a_json_identity_is_serialised_rather_than_debug_printed() {
        assert_eq!(
            identity_param(&json!({"a": 1})),
            Some("{\"a\":1}".to_string())
        );
    }

    // ------------------------------------------------------ identity_predicate

    #[test]
    fn row_identities_are_cast_through_text() {
        let columns = vec![column("id", "integer").primary()];
        let mut params = Vec::new();
        let clause =
            identity_predicate(&primary_key(&["id"]), &columns, &[json!(7)], &mut params).unwrap();
        assert_eq!(clause, "\"id\" = $1::text::integer");
        assert_eq!(params, vec![Some("7".to_string())]);
    }

    #[test]
    fn a_composite_identity_joins_with_and() {
        let columns = vec![
            column("tenant", "uuid").primary(),
            column("id", "integer").primary(),
        ];
        let mut params = Vec::new();
        let clause = identity_predicate(
            &primary_key(&["tenant", "id"]),
            &columns,
            &[json!("11111111-1111-1111-1111-111111111111"), json!(3)],
            &mut params,
        )
        .unwrap();
        assert_eq!(
            clause,
            "\"tenant\" = $1::text::uuid AND \"id\" = $2::text::integer"
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn a_null_identity_component_compares_with_is_null() {
        // `= NULL` is never true, so a NULL key part has to use IS NULL.
        let columns = vec![column("a", "text").primary(), column("b", "text").primary()];
        let mut params = Vec::new();
        let clause = identity_predicate(
            &primary_key(&["a", "b"]),
            &columns,
            &[Value::Null, json!("x")],
            &mut params,
        )
        .unwrap();
        assert_eq!(clause, "\"a\" IS NULL AND \"b\" = $1::text::text");
        assert_eq!(params, vec![Some("x".to_string())]);
    }

    #[test]
    fn ctid_identities_are_cast_through_text_too() {
        let columns = vec![column("name", "text")];
        let mut params = Vec::new();
        let clause =
            identity_predicate(&ctid_identity(), &columns, &[json!("(0,1)")], &mut params).unwrap();
        assert_eq!(clause, "ctid = $1::text::tid");
    }

    #[test]
    fn an_unidentifiable_row_is_refused() {
        let columns = vec![column("name", "text")];
        let identity = RowIdentity {
            kind: IdentityKind::None,
            columns: Vec::new(),
        };
        let mut params = Vec::new();
        assert!(identity_predicate(&identity, &columns, &[], &mut params).is_err());
    }

    #[test]
    fn a_mismatched_identity_length_is_refused() {
        let columns = vec![column("id", "integer").primary()];
        let mut params = Vec::new();
        assert!(identity_predicate(
            &primary_key(&["id"]),
            &columns,
            &[json!(1), json!(2)],
            &mut params
        )
        .is_err());
    }

    #[test]
    fn a_ctid_identity_without_a_value_is_refused() {
        let columns = vec![column("name", "text")];
        let mut params = Vec::new();
        assert!(identity_predicate(&ctid_identity(), &columns, &[], &mut params).is_err());
    }

    #[test]
    fn an_identity_naming_a_missing_column_is_refused() {
        let columns = vec![column("id", "integer").primary()];
        let mut params = Vec::new();
        assert!(
            identity_predicate(&primary_key(&["gone"]), &columns, &[json!(1)], &mut params)
                .is_err()
        );
    }

    #[test]
    fn identity_columns_needing_quotes_are_quoted() {
        let columns = vec![column("odd \"name\"", "integer").primary()];
        let mut params = Vec::new();
        let clause = identity_predicate(
            &primary_key(&["odd \"name\""]),
            &columns,
            &[json!(1)],
            &mut params,
        )
        .unwrap();
        assert!(clause.starts_with("\"odd \"\"name\"\"\" = "));
    }

    // ----------------------------------------------------------- build_where

    #[test]
    fn no_filters_produce_no_clause() {
        let columns = vec![column("name", "text")];
        let (clause, params) = where_of(&columns, &browse_request());
        assert_eq!(clause, "");
        assert!(params.is_empty());
    }

    #[test]
    fn filters_are_parameterised() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter(
            "name",
            FilterOperator::Equals,
            Some("x'; DROP TABLE t; --"),
        )];
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(clause, " WHERE \"name\" = $1::text::text");
        assert_eq!(params, vec![Some("x'; DROP TABLE t; --".to_string())]);
    }

    #[test]
    fn values_are_cast_through_text() {
        let columns = vec![column("id", "integer").primary()];
        let mut request = browse_request();
        request.filters = vec![filter("id", FilterOperator::GreaterThan, Some("42"))];
        let (clause, _) = where_of(&columns, &request);
        assert_eq!(clause, " WHERE \"id\" > $1::text::integer");
    }

    #[test]
    fn every_comparison_operator_has_a_symbol() {
        assert_eq!(comparison_operator(FilterOperator::Equals), "=");
        assert_eq!(comparison_operator(FilterOperator::NotEquals), "<>");
        assert_eq!(comparison_operator(FilterOperator::GreaterThan), ">");
        assert_eq!(comparison_operator(FilterOperator::GreaterOrEqual), ">=");
        assert_eq!(comparison_operator(FilterOperator::LessThan), "<");
        assert_eq!(comparison_operator(FilterOperator::LessOrEqual), "<=");
    }

    #[test]
    fn null_checks_bind_nothing() {
        let columns = vec![column("note", "text")];
        let mut request = browse_request();
        request.filters = vec![
            filter("note", FilterOperator::IsNull, None),
            filter("note", FilterOperator::IsNotNull, None),
        ];
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(clause, " WHERE \"note\" IS NULL AND \"note\" IS NOT NULL");
        assert!(params.is_empty());
    }

    #[test]
    fn contains_becomes_an_ilike_pattern() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("name", FilterOperator::Contains, Some("ann"))];
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(clause, " WHERE \"name\"::text ILIKE $1");
        assert_eq!(params, vec![Some("%ann%".to_string())]);
    }

    #[test]
    fn not_contains_negates_the_same_pattern() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("name", FilterOperator::NotContains, Some("ann"))];
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(clause, " WHERE \"name\"::text NOT ILIKE $1");
        assert_eq!(params, vec![Some("%ann%".to_string())]);
    }

    #[test]
    fn starts_and_ends_with_anchor_the_pattern() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("name", FilterOperator::StartsWith, Some("a"))];
        assert_eq!(where_of(&columns, &request).1, vec![Some("a%".to_string())]);

        request.filters = vec![filter("name", FilterOperator::EndsWith, Some("z"))];
        assert_eq!(where_of(&columns, &request).1, vec![Some("%z".to_string())]);
    }

    #[test]
    fn like_wildcards_inside_a_search_term_are_escaped() {
        // Without this, searching for "100%" would match everything.
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("name", FilterOperator::Contains, Some("100%_x"))];
        assert_eq!(
            where_of(&columns, &request).1,
            vec![Some("%100\\%\\_x%".to_string())]
        );
    }

    #[test]
    fn backslashes_in_a_search_term_are_escaped_first() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("name", FilterOperator::Contains, Some("a\\b"))];
        assert_eq!(
            where_of(&columns, &request).1,
            vec![Some("%a\\\\b%".to_string())]
        );
    }

    #[test]
    fn a_comparison_without_a_value_is_refused() {
        let columns = vec![column("id", "integer")];
        let mut request = browse_request();
        request.filters = vec![filter("id", FilterOperator::Equals, None)];
        let mut params = Vec::new();
        assert!(build_where(&columns, &request, &mut params).is_err());
    }

    #[test]
    fn unknown_filter_columns_are_rejected() {
        let columns = vec![column("name", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("nope", FilterOperator::Equals, Some("x"))];
        let mut params = Vec::new();
        assert!(build_where(&columns, &request, &mut params).is_err());
    }

    #[test]
    fn several_filters_are_joined_with_and() {
        let columns = vec![column("a", "text"), column("b", "integer")];
        let mut request = browse_request();
        request.filters = vec![
            filter("a", FilterOperator::Equals, Some("x")),
            filter("b", FilterOperator::LessThan, Some("5")),
        ];
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(
            clause,
            " WHERE \"a\" = $1::text::text AND \"b\" < $2::text::integer"
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn search_covers_every_column_with_one_parameter() {
        let columns = vec![column("a", "text"), column("b", "integer")];
        let mut request = browse_request();
        request.search = Some("term".into());
        let (clause, params) = where_of(&columns, &request);
        assert_eq!(
            clause,
            " WHERE (\"a\"::text ILIKE $1 OR \"b\"::text ILIKE $1)"
        );
        assert_eq!(params, vec![Some("%term%".to_string())]);
    }

    #[test]
    fn a_blank_search_is_ignored() {
        let columns = vec![column("a", "text")];
        let mut request = browse_request();
        request.search = Some("   ".into());
        assert_eq!(where_of(&columns, &request).0, "");
    }

    #[test]
    fn search_and_filters_combine() {
        let columns = vec![column("a", "text")];
        let mut request = browse_request();
        request.filters = vec![filter("a", FilterOperator::Equals, Some("x"))];
        request.search = Some("y".into());
        let (clause, params) = where_of(&columns, &request);
        assert!(clause.contains(" AND ("));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn search_escapes_wildcards_too() {
        let columns = vec![column("a", "text")];
        let mut request = browse_request();
        request.search = Some("50%".into());
        assert_eq!(
            where_of(&columns, &request).1,
            vec![Some("%50\\%%".to_string())]
        );
    }

    // ----------------------------------------------------------- build_order

    #[test]
    fn no_sort_produces_no_order_by() {
        let columns = vec![column("a", "text")];
        assert_eq!(build_order(&columns, &[]).unwrap(), "");
    }

    #[test]
    fn sorting_puts_nulls_last_in_both_directions() {
        let columns = vec![column("a", "text")];
        let ascending = build_order(
            &columns,
            &[SortSpec {
                column: "a".into(),
                direction: SortDirection::Asc,
            }],
        )
        .unwrap();
        assert_eq!(ascending, " ORDER BY \"a\" ASC NULLS LAST");

        let descending = build_order(
            &columns,
            &[SortSpec {
                column: "a".into(),
                direction: SortDirection::Desc,
            }],
        )
        .unwrap();
        assert_eq!(descending, " ORDER BY \"a\" DESC NULLS LAST");
    }

    #[test]
    fn multi_column_sorts_keep_their_order() {
        let columns = vec![column("a", "text"), column("b", "integer")];
        let order = build_order(
            &columns,
            &[
                SortSpec {
                    column: "b".into(),
                    direction: SortDirection::Desc,
                },
                SortSpec {
                    column: "a".into(),
                    direction: SortDirection::Asc,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            order,
            " ORDER BY \"b\" DESC NULLS LAST, \"a\" ASC NULLS LAST"
        );
    }

    #[test]
    fn sorting_on_an_unknown_column_is_refused() {
        let columns = vec![column("a", "text")];
        assert!(build_order(
            &columns,
            &[SortSpec {
                column: "nope".into(),
                direction: SortDirection::Asc,
            }]
        )
        .is_err());
    }

    // ---------------------------------------------------------- build_select

    #[test]
    fn the_page_query_selects_every_column() {
        let columns = vec![column("id", "integer").primary(), column("name", "text")];
        let page = build_select(
            "\"public\".\"t\"",
            &columns,
            &primary_key(&["id"]),
            &browse_request(),
            "",
        )
        .unwrap();
        assert_eq!(
            page.sql,
            "SELECT \"id\", \"name\" FROM \"public\".\"t\" LIMIT 100 OFFSET 0"
        );
        assert_eq!(page.value_count, 2);
    }

    #[test]
    fn a_ctid_identity_appends_a_hidden_column() {
        let columns = vec![column("name", "text")];
        let page = build_select(
            "\"public\".\"t\"",
            &columns,
            &ctid_identity(),
            &browse_request(),
            "",
        )
        .unwrap();
        assert!(page.sql.starts_with("SELECT \"name\", ctid::text FROM"));
        // The identity column is not part of the row data.
        assert_eq!(page.value_count, 1);
    }

    #[test]
    fn the_page_query_carries_the_where_clause_and_order() {
        let columns = vec![column("id", "integer").primary()];
        let mut request = browse_request();
        request.sort = vec![SortSpec {
            column: "id".into(),
            direction: SortDirection::Desc,
        }];
        let page = build_select(
            "\"public\".\"t\"",
            &columns,
            &primary_key(&["id"]),
            &request,
            " WHERE \"id\" > $1",
        )
        .unwrap();
        assert_eq!(
            page.sql,
            "SELECT \"id\" FROM \"public\".\"t\" WHERE \"id\" > $1 ORDER BY \"id\" DESC NULLS LAST LIMIT 100 OFFSET 0"
        );
    }

    #[test]
    fn the_page_size_is_clamped_to_something_sane() {
        let columns = vec![column("id", "integer").primary()];
        let identity = primary_key(&["id"]);

        let mut request = browse_request();
        request.limit = 0;
        let page = build_select("t", &columns, &identity, &request, "").unwrap();
        assert!(page.sql.ends_with("LIMIT 1 OFFSET 0"));

        request.limit = 10_000_000;
        let page = build_select("t", &columns, &identity, &request, "").unwrap();
        assert!(page.sql.ends_with("LIMIT 100000 OFFSET 0"));
    }

    #[test]
    fn a_negative_offset_is_clamped_to_zero() {
        let columns = vec![column("id", "integer").primary()];
        let mut request = browse_request();
        request.offset = -50;
        let page = build_select("t", &columns, &primary_key(&["id"]), &request, "").unwrap();
        assert!(page.sql.ends_with("OFFSET 0"));
    }

    #[test]
    fn the_offset_follows_the_page() {
        let columns = vec![column("id", "integer").primary()];
        let mut request = browse_request();
        request.limit = 50;
        request.offset = 150;
        let page = build_select("t", &columns, &primary_key(&["id"]), &request, "").unwrap();
        assert!(page.sql.ends_with("LIMIT 50 OFFSET 150"));
    }

    // ---------------------------------------------------------- build_insert

    #[test]
    fn an_insert_names_and_binds_every_supplied_column() {
        let columns = vec![column("id", "integer").primary(), column("name", "text")];
        let id = field("id", Some("1"));
        let name = field("name", Some("ann"));
        let (sql, params) = build_insert("\"public\".\"t\"", &columns, &[&id, &name])
            .unwrap()
            .unwrap();
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"t\" (\"id\", \"name\") VALUES ($1::text::integer, $2::text::text)"
        );
        assert_eq!(params, vec![Some("1".to_string()), Some("ann".to_string())]);
    }

    #[test]
    fn an_insert_skips_generated_columns() {
        let columns = vec![
            column("id", "integer").primary(),
            column("total", "integer").generated(),
        ];
        let id = field("id", Some("1"));
        let total = field("total", Some("9"));
        let (sql, params) = build_insert("t", &columns, &[&id, &total])
            .unwrap()
            .unwrap();
        assert_eq!(sql, "INSERT INTO t (\"id\") VALUES ($1::text::integer)");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn an_insert_of_only_generated_columns_falls_back_to_defaults() {
        let columns = vec![column("total", "integer").generated()];
        let total = field("total", Some("9"));
        assert!(build_insert("t", &columns, &[&total]).unwrap().is_none());
    }

    #[test]
    fn an_insert_with_nothing_supplied_falls_back_to_defaults() {
        let columns = vec![column("id", "integer").primary()];
        assert!(build_insert("t", &columns, &[]).unwrap().is_none());
    }

    #[test]
    fn a_null_insert_value_is_bound_as_null() {
        let columns = vec![column("note", "text")];
        let note = field("note", None);
        let (_, params) = build_insert("t", &columns, &[&note]).unwrap().unwrap();
        assert_eq!(params, vec![None]);
    }

    #[test]
    fn an_insert_naming_an_unknown_column_is_refused() {
        let columns = vec![column("id", "integer")];
        let ghost = field("ghost", Some("1"));
        assert!(build_insert("t", &columns, &[&ghost]).is_err());
    }

    // ---------------------------------------------------------- build_update

    #[test]
    fn an_update_sets_one_column_and_matches_on_the_identity() {
        let columns = vec![column("id", "integer").primary(), column("name", "text")];
        let change = RowChange {
            schema: "public".into(),
            table: "t".into(),
            identity: primary_key(&["id"]),
            identity_values: vec![json!(5)],
            column: "name".into(),
            value: Some("ann".into()),
        };
        let (sql, params) = build_update("\"public\".\"t\"", &columns, &change).unwrap();
        assert_eq!(
            sql,
            "UPDATE \"public\".\"t\" SET \"name\" = $1::text::text WHERE \"id\" = $2::text::integer"
        );
        assert_eq!(params, vec![Some("ann".to_string()), Some("5".to_string())]);
    }

    #[test]
    fn an_update_can_write_null() {
        let columns = vec![column("id", "integer").primary(), column("name", "text")];
        let change = RowChange {
            schema: "public".into(),
            table: "t".into(),
            identity: primary_key(&["id"]),
            identity_values: vec![json!(5)],
            column: "name".into(),
            value: None,
        };
        let (_, params) = build_update("t", &columns, &change).unwrap();
        assert_eq!(params[0], None);
    }

    #[test]
    fn an_update_of_an_unknown_column_is_refused() {
        let columns = vec![column("id", "integer").primary()];
        let change = RowChange {
            schema: "public".into(),
            table: "t".into(),
            identity: primary_key(&["id"]),
            identity_values: vec![json!(5)],
            column: "ghost".into(),
            value: Some("x".into()),
        };
        assert!(build_update("t", &columns, &change).is_err());
    }

    // ---------------------------------------------------------- build_delete

    #[test]
    fn a_single_row_delete_matches_on_the_identity() {
        let columns = vec![column("id", "integer").primary()];
        let request = DeleteRequest {
            schema: "public".into(),
            table: "t".into(),
            identity: primary_key(&["id"]),
            rows: vec![vec![json!(1)]],
        };
        let (sql, params) = build_delete("\"public\".\"t\"", &columns, &request).unwrap();
        assert_eq!(
            sql,
            "DELETE FROM \"public\".\"t\" WHERE (\"id\" = $1::text::integer)"
        );
        assert_eq!(params, vec![Some("1".to_string())]);
    }

    #[test]
    fn several_rows_are_ored_together_with_one_parameter_each() {
        let columns = vec![column("id", "integer").primary()];
        let request = DeleteRequest {
            schema: "public".into(),
            table: "t".into(),
            identity: primary_key(&["id"]),
            rows: vec![vec![json!(1)], vec![json!(2)], vec![json!(3)]],
        };
        let (sql, params) = build_delete("t", &columns, &request).unwrap();
        assert_eq!(
            sql,
            "DELETE FROM t WHERE (\"id\" = $1::text::integer) OR (\"id\" = $2::text::integer) OR (\"id\" = $3::text::integer)"
        );
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn deleting_by_ctid_is_supported() {
        let columns = vec![column("name", "text")];
        let request = DeleteRequest {
            schema: "public".into(),
            table: "t".into(),
            identity: ctid_identity(),
            rows: vec![vec![json!("(0,1)")]],
        };
        let (sql, _) = build_delete("t", &columns, &request).unwrap();
        assert_eq!(sql, "DELETE FROM t WHERE (ctid = $1::text::tid)");
    }

    #[test]
    fn a_delete_on_an_unidentifiable_relation_is_refused() {
        let columns = vec![column("name", "text")];
        let request = DeleteRequest {
            schema: "public".into(),
            table: "v".into(),
            identity: RowIdentity {
                kind: IdentityKind::None,
                columns: Vec::new(),
            },
            rows: vec![vec![json!(1)]],
        };
        assert!(build_delete("v", &columns, &request).is_err());
    }

    // ----------------------------------------------------------- find_column

    #[test]
    fn columns_are_found_by_exact_name() {
        let columns = vec![column("Name", "text")];
        assert!(find_column(&columns, "Name").is_ok());
        // PostgreSQL identifiers are case sensitive once quoted.
        assert!(find_column(&columns, "name").is_err());
    }
}
