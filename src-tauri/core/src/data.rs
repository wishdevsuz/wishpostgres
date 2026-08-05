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

    let mut select: Vec<String> = columns
        .iter()
        .map(|column| quote_ident(&column.name))
        .collect::<CoreResult<_>>()?;
    let value_count = select.len();
    if identity.kind == IdentityKind::Ctid {
        select.push("ctid::text".to_string());
    }

    let order = build_order(&columns, &request.sort)?;
    let limit = request.limit.clamp(1, 100_000);
    let offset = request.offset.max(0);

    // `limit` and `offset` are clamped integers produced here, never user text.
    let sql = format!(
        "SELECT {} FROM {relation}{where_clause}{order} LIMIT {limit} OFFSET {offset}",
        select.join(", ")
    );

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

    let (total_rows, is_estimate) =
        count_rows(client, &relation, &where_clause, &params, request.exact_count).await?;

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
                let escaped = raw.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
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
                    "{quoted} {} ${}::{}",
                    comparison_operator(other),
                    params.len(),
                    column.data_type
                )
            }
        };
        clauses.push(clause);
    }

    if let Some(term) = request.search.as_ref().filter(|term| !term.trim().is_empty()) {
        let escaped = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        params.push(Some(format!("%{escaped}%")));
        let index = params.len();
        let searchable: Vec<String> = columns
            .iter()
            .map(|column| Ok(format!("{}::text ILIKE ${index}", quote_ident(&column.name)?)))
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
        return Ok(format!("ctid = ${}::tid", params.len()));
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
                clauses.push(format!("{quoted} = ${}::{}", params.len(), column.data_type));
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

    let mut params: Vec<Option<String>> = vec![change.value.clone()];
    let assignment = format!(
        "{} = $1::{}",
        quote_ident(&target.name)?,
        target.data_type
    );
    let predicate = identity_predicate(
        &change.identity,
        &columns,
        &change.identity_values,
        &mut params,
    )?;

    let sql = format!("UPDATE {relation} SET {assignment} WHERE {predicate}");
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

    let mut names = Vec::with_capacity(supplied.len());
    let mut placeholders = Vec::with_capacity(supplied.len());
    let mut params: Vec<Option<String>> = Vec::with_capacity(supplied.len());

    for field in supplied {
        let column = find_column(&columns, &field.column)?;
        if column.is_generated {
            continue;
        }
        names.push(quote_ident(&column.name)?);
        params.push(field.value.clone());
        placeholders.push(format!("${}::{}", params.len(), column.data_type));
    }

    if names.is_empty() {
        let affected = client
            .execute(&format!("INSERT INTO {relation} DEFAULT VALUES"), &[])
            .await?;
        return Ok(affected);
    }

    let sql = format!(
        "INSERT INTO {relation} ({}) VALUES ({})",
        names.join(", "),
        placeholders.join(", ")
    );
    Ok(client.execute(&sql, &as_sql_params(&params)).await?)
}

pub async fn delete_rows(client: &Client, request: &DeleteRequest) -> CoreResult<u64> {
    if request.rows.is_empty() {
        return Ok(0);
    }
    let relation = quote_relation(&request.schema, &request.table)?;
    let columns = introspect::columns(client, &request.schema, &request.table).await?;

    let mut params: Vec<Option<String>> = Vec::new();
    let mut predicates = Vec::with_capacity(request.rows.len());
    for values in &request.rows {
        predicates.push(format!(
            "({})",
            identity_predicate(&request.identity, &columns, values, &mut params)?
        ));
    }

    let sql = format!(
        "DELETE FROM {relation} WHERE {}",
        predicates.join(" OR ")
    );
    Ok(client.execute(&sql, &as_sql_params(&params)).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, primary: bool) -> ColumnMeta {
        ColumnMeta {
            name: name.to_string(),
            data_type: data_type.to_string(),
            type_category: TypeCategory::Text,
            nullable: !primary,
            default: None,
            is_primary_key: primary,
            is_unique: false,
            is_identity: false,
            is_generated: false,
            comment: None,
            ordinal: 1,
            enum_values: Vec::new(),
            max_length: None,
        }
    }

    #[test]
    fn prefers_the_primary_key() {
        let columns = vec![column("id", "integer", true), column("name", "text", false)];
        let identity = choose_identity(&columns, true);
        assert_eq!(identity.kind, IdentityKind::PrimaryKey);
        assert_eq!(identity.columns, vec!["id"]);
    }

    #[test]
    fn falls_back_to_ctid_for_tables() {
        let columns = vec![column("name", "text", false)];
        assert_eq!(choose_identity(&columns, true).kind, IdentityKind::Ctid);
    }

    #[test]
    fn views_are_not_identifiable() {
        let columns = vec![column("name", "text", false)];
        assert_eq!(choose_identity(&columns, false).kind, IdentityKind::None);
    }

    #[test]
    fn filters_are_parameterised() {
        let columns = vec![column("name", "text", false)];
        let request = BrowseRequest {
            schema: "public".into(),
            table: "t".into(),
            limit: 100,
            offset: 0,
            sort: Vec::new(),
            filters: vec![FilterSpec {
                column: "name".into(),
                operator: FilterOperator::Equals,
                value: Some("x'; DROP TABLE t; --".into()),
            }],
            search: None,
            exact_count: false,
        };
        let mut params = Vec::new();
        let clause = build_where(&columns, &request, &mut params).unwrap();
        assert_eq!(clause, " WHERE \"name\" = $1::text");
        assert_eq!(params, vec![Some("x'; DROP TABLE t; --".to_string())]);
    }

    #[test]
    fn unknown_filter_columns_are_rejected() {
        let columns = vec![column("name", "text", false)];
        let request = BrowseRequest {
            schema: "public".into(),
            table: "t".into(),
            limit: 100,
            offset: 0,
            sort: vec![SortSpec {
                column: "injected\"".into(),
                direction: crate::ident::SortDirection::Asc,
            }],
            filters: Vec::new(),
            search: None,
            exact_count: false,
        };
        assert!(build_order(&columns, &request.sort).is_err());
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let columns = vec![column("name", "text", false)];
        let request = BrowseRequest {
            schema: "public".into(),
            table: "t".into(),
            limit: 100,
            offset: 0,
            sort: Vec::new(),
            filters: vec![FilterSpec {
                column: "name".into(),
                operator: FilterOperator::Contains,
                value: Some("100%".into()),
            }],
            search: None,
            exact_count: false,
        };
        let mut params = Vec::new();
        build_where(&columns, &request, &mut params).unwrap();
        assert_eq!(params, vec![Some("%100\\%%".to_string())]);
    }
}
