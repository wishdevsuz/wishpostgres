//! Catalog queries.
//!
//! Every statement here is parameterised. Where PostgreSQL cannot accept a
//! parameter, the value is a quoted identifier produced by [`crate::ident`] and
//! resolved server side through a `regclass` cast.

use deadpool_postgres::Client;

use crate::error::CoreResult;
use crate::ident::quote_relation;
use crate::models::*;

pub async fn databases(client: &Client) -> CoreResult<Vec<DatabaseInfo>> {
    let rows = client
        .query(
            "SELECT d.datname::text,
                    pg_get_userbyid(d.datdba)::text AS owner,
                    pg_encoding_to_char(d.encoding)::text AS encoding,
                    CASE WHEN has_database_privilege(d.datname, 'CONNECT')
                         THEN pg_database_size(d.oid) END AS size,
                    d.datistemplate,
                    d.datallowconn AND has_database_privilege(d.datname, 'CONNECT') AS can_connect
             FROM pg_database d
             ORDER BY d.datistemplate, d.datname",
            &[],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| DatabaseInfo {
            name: row.get(0),
            owner: row.get(1),
            encoding: row.get(2),
            size: row.get(3),
            is_template: row.get(4),
            can_connect: row.get(5),
        })
        .collect())
}

pub async fn schemas(client: &Client) -> CoreResult<Vec<SchemaInfo>> {
    let rows = client
        .query(
            "SELECT n.nspname::text,
                    pg_get_userbyid(n.nspowner)::text,
                    (n.nspname IN ('pg_catalog', 'information_schema')
                        OR n.nspname LIKE 'pg\\_toast%'
                        OR n.nspname LIKE 'pg\\_temp%') AS is_system
             FROM pg_namespace n
             WHERE has_schema_privilege(n.oid, 'USAGE')
             ORDER BY 3, 1",
            &[],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| SchemaInfo {
            name: row.get(0),
            owner: row.get(1),
            is_system: row.get(2),
        })
        .collect())
}

pub async fn relations(
    client: &Client,
    schema: &str,
    kinds: &[RelationKind],
) -> CoreResult<Vec<RelationInfo>> {
    let wanted: Vec<String> = kinds
        .iter()
        .map(|kind| relkind_code(*kind).to_string())
        .collect();

    let rows = client
        .query(
            "SELECT n.nspname::text,
                    c.relname::text,
                    c.relkind::text,
                    pg_get_userbyid(c.relowner)::text,
                    CASE WHEN c.relkind IN ('r', 'p', 'm', 'i')
                         THEN pg_total_relation_size(c.oid) END AS size,
                    CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS estimate,
                    obj_description(c.oid, 'pg_class') AS comment
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relkind::text = ANY($2)
               AND has_table_privilege(c.oid, 'SELECT')
             ORDER BY c.relname",
            &[&schema, &wanted],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| RelationInfo {
            schema: row.get(0),
            name: row.get(1),
            kind: relkind_from_code(row.get::<_, String>(2).as_str()),
            owner: row.get(3),
            size: row.get(4),
            estimated_rows: row.get(5),
            comment: row.get(6),
        })
        .collect())
}

fn relkind_code(kind: RelationKind) -> &'static str {
    match kind {
        RelationKind::Table => "r",
        RelationKind::View => "v",
        RelationKind::MaterializedView => "m",
        RelationKind::ForeignTable => "f",
        RelationKind::PartitionedTable => "p",
    }
}

fn relkind_from_code(code: &str) -> RelationKind {
    match code {
        "v" => RelationKind::View,
        "m" => RelationKind::MaterializedView,
        "f" => RelationKind::ForeignTable,
        "p" => RelationKind::PartitionedTable,
        _ => RelationKind::Table,
    }
}

pub async fn functions(client: &Client, schema: &str) -> CoreResult<Vec<FunctionInfo>> {
    let rows = client
        .query(
            "SELECT n.nspname::text,
                    p.proname::text,
                    pg_get_function_arguments(p.oid),
                    pg_get_function_result(p.oid),
                    l.lanname::text,
                    CASE p.prokind
                        WHEN 'p' THEN 'procedure'
                        WHEN 'a' THEN 'aggregate'
                        WHEN 'w' THEN 'window'
                        ELSE 'function'
                    END AS kind
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_language l ON l.oid = p.prolang
             WHERE n.nspname = $1
             ORDER BY p.proname, p.oid",
            &[&schema],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| FunctionInfo {
            schema: row.get(0),
            name: row.get(1),
            arguments: row.get(2),
            returns: row.get(3),
            language: row.get(4),
            kind: row.get(5),
        })
        .collect())
}

pub async fn extensions(client: &Client) -> CoreResult<Vec<ExtensionInfo>> {
    let rows = client
        .query(
            "SELECT a.name::text,
                    e.extnamespace::regnamespace::text AS schema,
                    a.installed_version,
                    a.default_version,
                    a.comment,
                    a.installed_version IS NOT NULL AS installed
             FROM pg_available_extensions a
             LEFT JOIN pg_extension e ON e.extname = a.name
             ORDER BY 6 DESC, 1",
            &[],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| ExtensionInfo {
            name: row.get(0),
            schema: row.get(1),
            installed_version: row.get(2),
            default_version: row.get(3),
            comment: row.get(4),
            installed: row.get(5),
        })
        .collect())
}

pub async fn columns(client: &Client, schema: &str, table: &str) -> CoreResult<Vec<ColumnMeta>> {
    let relation = quote_relation(schema, table)?;

    let rows = client
        .query(
            // A column only counts as unique when it is the *whole* key of a
            // unique constraint. A column of a composite UNIQUE(a, b) does not
            // identify a row on its own, and treating it as if it did would let
            // an inline edit update more rows than the user selected.
            "WITH keys AS (
                 SELECT contype, unnest(conkey) AS attnum
                 FROM pg_constraint
                 WHERE conrelid = $1::text::regclass
                   AND (contype = 'p' OR (contype = 'u' AND array_length(conkey, 1) = 1))
             )
             SELECT a.attname::text,
                    format_type(a.atttypid, a.atttypmod),
                    NOT a.attnotnull AS nullable,
                    pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
                    EXISTS (SELECT 1 FROM keys k WHERE k.contype = 'p' AND k.attnum = a.attnum),
                    EXISTS (SELECT 1 FROM keys k WHERE k.contype = 'u' AND k.attnum = a.attnum),
                    a.attidentity <> '' AS is_identity,
                    a.attgenerated <> '' AS is_generated,
                    col_description(a.attrelid, a.attnum) AS comment,
                    a.attnum::int,
                    COALESCE(
                        (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
                         FROM pg_enum e
                         WHERE e.enumtypid = COALESCE(bt.oid, t.oid)),
                        ARRAY[]::text[]
                    ) AS enum_values,
                    CASE WHEN a.atttypmod > 4 AND t.typname IN ('varchar', 'bpchar')
                         THEN a.atttypmod - 4 END AS max_length,
                    COALESCE(t.typtype = 'e' OR bt.typtype = 'e', false) AS is_enum,
                    t.typcategory = 'A' AS is_array
             FROM pg_attribute a
             JOIN pg_type t ON t.oid = a.atttypid
             LEFT JOIN pg_type bt ON bt.oid = t.typelem AND t.typcategory = 'A'
             LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
             WHERE a.attrelid = $1::text::regclass AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum",
            &[&relation],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| {
            let data_type: String = row.get(1);
            let is_enum: bool = row.get(12);
            let is_array: bool = row.get(13);
            ColumnMeta {
                name: row.get(0),
                type_category: TypeCategory::from_pg(base_type_name(&data_type), is_enum, is_array),
                data_type,
                nullable: row.get(2),
                default: row.get(3),
                is_primary_key: row.get(4),
                is_unique: row.get(5),
                is_identity: row.get(6),
                is_generated: row.get(7),
                comment: row.get(8),
                ordinal: row.get(9),
                enum_values: row.get(10),
                max_length: row.get(11),
            }
        })
        .collect())
}

/// Strip array brackets and type modifiers so `character varying(80)[]`
/// classifies the same way as `character varying`.
fn base_type_name(data_type: &str) -> &str {
    let without_array = data_type.trim_end_matches("[]");
    match without_array.find('(') {
        Some(index) => without_array[..index].trim_end(),
        None => without_array,
    }
}

pub async fn indexes(client: &Client, schema: &str, table: &str) -> CoreResult<Vec<IndexInfo>> {
    let relation = quote_relation(schema, table)?;

    let rows = client
        .query(
            "SELECT i.relname::text,
                    pg_get_indexdef(x.indexrelid),
                    x.indisunique,
                    x.indisprimary,
                    x.indisvalid,
                    pg_relation_size(x.indexrelid),
                    s.idx_scan,
                    ARRAY(
                        SELECT pg_get_indexdef(x.indexrelid, k + 1, true)
                        FROM generate_series(0, x.indnatts - 1) AS k
                    ) AS columns
             FROM pg_index x
             JOIN pg_class i ON i.oid = x.indexrelid
             LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = x.indexrelid
             WHERE x.indrelid = $1::text::regclass
             ORDER BY x.indisprimary DESC, i.relname",
            &[&relation],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| IndexInfo {
            name: row.get(0),
            definition: row.get(1),
            is_unique: row.get(2),
            is_primary: row.get(3),
            is_valid: row.get(4),
            size: row.get(5),
            scans: row.get(6),
            columns: row.get(7),
        })
        .collect())
}

pub async fn constraints(
    client: &Client,
    schema: &str,
    table: &str,
) -> CoreResult<Vec<ConstraintInfo>> {
    let relation = quote_relation(schema, table)?;

    let rows = client
        .query(
            "SELECT c.conname::text,
                    CASE c.contype
                        WHEN 'p' THEN 'PRIMARY KEY'
                        WHEN 'f' THEN 'FOREIGN KEY'
                        WHEN 'u' THEN 'UNIQUE'
                        WHEN 'c' THEN 'CHECK'
                        WHEN 'x' THEN 'EXCLUDE'
                        ELSE c.contype::text
                    END AS kind,
                    pg_get_constraintdef(c.oid),
                    c.condeferrable
             FROM pg_constraint c
             WHERE c.conrelid = $1::text::regclass
             ORDER BY c.contype, c.conname",
            &[&relation],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| ConstraintInfo {
            name: row.get(0),
            kind: row.get(1),
            definition: row.get(2),
            is_deferrable: row.get(3),
        })
        .collect())
}

pub async fn statistics(client: &Client, schema: &str, table: &str) -> CoreResult<TableStatistics> {
    let relation = quote_relation(schema, table)?;

    let row = client
        .query_one(
            "SELECT s.n_live_tup,
                    s.n_dead_tup,
                    pg_total_relation_size(c.oid),
                    pg_table_size(c.oid),
                    pg_indexes_size(c.oid),
                    CASE WHEN c.reltoastrelid <> 0
                         THEN pg_total_relation_size(c.reltoastrelid) END,
                    s.seq_scan,
                    s.idx_scan,
                    s.n_tup_ins,
                    s.n_tup_upd,
                    s.n_tup_del,
                    s.last_vacuum::text,
                    s.last_autovacuum::text,
                    s.last_analyze::text,
                    s.last_autoanalyze::text
             FROM pg_class c
             LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
             WHERE c.oid = $1::text::regclass",
            &[&relation],
        )
        .await?;

    let column_stats = client
        .query(
            "SELECT attname::text,
                    null_frac,
                    n_distinct,
                    avg_width,
                    COALESCE((
                        SELECT array_agg(value)
                        FROM (
                            SELECT value
                            FROM unnest(most_common_vals::text::text[]) AS value
                            LIMIT 5
                        ) top
                    ), ARRAY[]::text[])
             FROM pg_stats
             WHERE schemaname = $1 AND tablename = $2
             ORDER BY attname",
            &[&schema, &table],
        )
        .await?;

    Ok(TableStatistics {
        live_rows: row.get(0),
        dead_rows: row.get(1),
        total_size: row.get(2),
        table_size: row.get(3),
        index_size: row.get(4),
        toast_size: row.get(5),
        sequential_scans: row.get(6),
        index_scans: row.get(7),
        inserts: row.get(8),
        updates: row.get(9),
        deletes: row.get(10),
        last_vacuum: row.get(11),
        last_autovacuum: row.get(12),
        last_analyze: row.get(13),
        last_autoanalyze: row.get(14),
        column_stats: column_stats
            .iter()
            .map(|stat| ColumnStatistic {
                column: stat.get(0),
                null_fraction: stat.get(1),
                distinct_values: stat.get(2),
                average_width: stat.get(3),
                most_common: stat.get(4),
            })
            .collect(),
    })
}

/// Global search across schemas, relations, columns and routines.
pub async fn search(client: &Client, term: &str, limit: i64) -> CoreResult<Vec<SearchHit>> {
    let pattern = format!(
        "%{}%",
        term.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );

    let rows = client
        .query(
            "SELECT kind, schema_name, object_name, detail, parent FROM (
                 SELECT 'schema' AS kind,
                        n.nspname::text AS schema_name,
                        n.nspname::text AS object_name,
                        NULL::text AS detail,
                        NULL::text AS parent,
                        1 AS priority
                 FROM pg_namespace n
                 WHERE n.nspname ILIKE $1 AND has_schema_privilege(n.oid, 'USAGE')

                 UNION ALL

                 SELECT CASE c.relkind
                            WHEN 'v' THEN 'view'
                            WHEN 'm' THEN 'materialized view'
                            ELSE 'table'
                        END,
                        n.nspname::text,
                        c.relname::text,
                        obj_description(c.oid, 'pg_class'),
                        NULL::text,
                        2
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname ILIKE $1
                   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND has_table_privilege(c.oid, 'SELECT')

                 UNION ALL

                 SELECT 'column',
                        n.nspname::text,
                        a.attname::text,
                        format_type(a.atttypid, a.atttypmod),
                        c.relname::text,
                        3
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE a.attname ILIKE $1
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND has_table_privilege(c.oid, 'SELECT')

                 UNION ALL

                 SELECT 'function',
                        n.nspname::text,
                        p.proname::text,
                        pg_get_function_arguments(p.oid),
                        NULL::text,
                        4
                 FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.proname ILIKE $1
                   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             ) hits
             ORDER BY priority, schema_name, object_name
             LIMIT $2",
            &[&pattern, &limit],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|row| SearchHit {
            kind: row.get(0),
            schema: row.get(1),
            name: row.get(2),
            detail: row.get(3),
            parent: row.get(4),
        })
        .collect())
}

/// Reconstruct a `CREATE` statement for the SQL tab.
pub async fn definition(client: &Client, schema: &str, table: &str) -> CoreResult<String> {
    let relation = quote_relation(schema, table)?;

    let kind: String = client
        .query_one(
            "SELECT c.relkind::text FROM pg_class c WHERE c.oid = $1::text::regclass",
            &[&relation],
        )
        .await?
        .get(0);

    if matches!(kind.as_str(), "v" | "m") {
        let definition: String = client
            .query_one(
                "SELECT pg_get_viewdef($1::text::regclass, true)",
                &[&relation],
            )
            .await?
            .get(0);
        let keyword = if kind == "m" {
            "CREATE MATERIALIZED VIEW"
        } else {
            "CREATE OR REPLACE VIEW"
        };
        return Ok(format!("{keyword} {relation} AS\n{}\n", definition.trim()));
    }

    let columns = columns(client, schema, table).await?;
    let constraints = constraints(client, schema, table).await?;
    let indexes = indexes(client, schema, table).await?;

    let mut sql = format!("CREATE TABLE {relation} (\n");

    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| {
            let mut line = format!(
                "    {} {}",
                crate::ident::quote_ident(&column.name).unwrap_or_else(|_| column.name.clone()),
                column.data_type
            );
            if column.is_generated {
                if let Some(default) = &column.default {
                    line.push_str(&format!(" GENERATED ALWAYS AS ({default}) STORED"));
                }
            } else if column.is_identity {
                line.push_str(" GENERATED BY DEFAULT AS IDENTITY");
            } else if let Some(default) = &column.default {
                line.push_str(&format!(" DEFAULT {default}"));
            }
            if !column.nullable {
                line.push_str(" NOT NULL");
            }
            line
        })
        .collect();

    lines.extend(constraints.iter().map(|constraint| {
        format!(
            "    CONSTRAINT {} {}",
            crate::ident::quote_ident(&constraint.name).unwrap_or_else(|_| constraint.name.clone()),
            constraint.definition
        )
    }));

    sql.push_str(&lines.join(",\n"));
    sql.push_str("\n);\n");

    let extra_indexes: Vec<&IndexInfo> = indexes
        .iter()
        .filter(|index| {
            !index.is_primary
                && !constraints
                    .iter()
                    .any(|constraint| constraint.name == index.name)
        })
        .collect();

    if !extra_indexes.is_empty() {
        sql.push('\n');
        for index in extra_indexes {
            sql.push_str(&index.definition);
            sql.push_str(";\n");
        }
    }

    let comments: Vec<String> = columns
        .iter()
        .filter_map(|column| {
            column.comment.as_ref().map(|comment| {
                format!(
                    "COMMENT ON COLUMN {relation}.{} IS {};",
                    crate::ident::quote_ident(&column.name).unwrap_or_else(|_| column.name.clone()),
                    crate::ident::quote_literal(comment)
                )
            })
        })
        .collect();

    if !comments.is_empty() {
        sql.push('\n');
        sql.push_str(&comments.join("\n"));
        sql.push('\n');
    }

    Ok(sql)
}

#[cfg(test)]
mod tests {
    use super::base_type_name;

    #[test]
    fn normalises_type_names() {
        assert_eq!(base_type_name("character varying(80)"), "character varying");
        assert_eq!(base_type_name("numeric(10,2)"), "numeric");
        assert_eq!(base_type_name("text[]"), "text");
        assert_eq!(base_type_name("integer"), "integer");
    }
}
