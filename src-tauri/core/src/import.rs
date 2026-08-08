//! Reading CSV, JSON and XLSX files into a table.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Instant;

use calamine::{open_workbook_auto, Data, Reader};
use deadpool_postgres::Client;
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
use crate::ident::{quote_ident, quote_relation};
use crate::introspect;
use crate::models::*;

const PREVIEW_ROWS: usize = 50;
const BATCH_ROWS: usize = 500;
/// PostgreSQL's wire protocol carries the bind parameter count as an `int16`,
/// so one statement can never have more than 65535 of them.
const MAX_BIND_PARAMS: usize = 65_535;

/// How many rows fit in one multi-row `INSERT` given a column count.
///
/// A wide file — 200 mapped columns — would otherwise blow past the parameter
/// limit at the default batch size and fail the whole import.
fn batch_rows(columns: usize) -> usize {
    if columns == 0 {
        return BATCH_ROWS;
    }
    BATCH_ROWS.min(MAX_BIND_PARAMS / columns).max(1)
}

/// A file parsed into a header plus string cells, which is all three importable
/// formats reduced to one shape.
struct Sheet {
    columns: Vec<String>,
    rows: Vec<Vec<Option<String>>>,
}

pub fn preview(path: &str, has_header: bool, delimiter: Option<&str>) -> CoreResult<ImportPreview> {
    let sheet = read_file(path, has_header, delimiter)?;
    let total = sheet.rows.len();
    let truncated = total > PREVIEW_ROWS;

    Ok(ImportPreview {
        columns: sheet.columns,
        rows: sheet.rows.into_iter().take(PREVIEW_ROWS).collect(),
        total_rows: total,
        truncated,
    })
}

pub async fn run(client: &Client, request: &ImportRequest) -> CoreResult<ImportOutcome> {
    let started = Instant::now();
    let sheet = read_file(
        &request.path,
        request.has_header,
        request.delimiter.as_deref(),
    )?;

    if request.mapping.is_empty() {
        return Err(CoreError::Invalid(
            "map at least one source column onto a table column".into(),
        ));
    }

    let relation = quote_relation(&request.schema, &request.table)?;
    let columns = introspect::columns(client, &request.schema, &request.table).await?;

    let mut targets = Vec::with_capacity(request.mapping.len());
    for mapping in &request.mapping {
        let column = columns
            .iter()
            .find(|column| column.name == mapping.target)
            .ok_or_else(|| {
                CoreError::Invalid(format!("there is no column named `{}`", mapping.target))
            })?;
        let source = sheet
            .columns
            .iter()
            .position(|name| name == &mapping.source)
            .ok_or_else(|| {
                CoreError::Invalid(format!("the file has no column named `{}`", mapping.source))
            })?;
        targets.push((column.clone(), source));
    }

    if request.truncate_first {
        client
            .batch_execute(&format!("TRUNCATE TABLE {relation}"))
            .await?;
    }

    let names: Vec<String> = targets
        .iter()
        .map(|(column, _)| quote_ident(&column.name))
        .collect::<CoreResult<_>>()?;

    let mut inserted = 0u64;
    let mut failed = 0u64;
    let mut errors: Vec<String> = Vec::new();
    let null_literal = request.null_literal.as_deref();

    let rows_per_batch = batch_rows(targets.len());

    for (chunk_index, chunk) in sheet.rows.chunks(rows_per_batch).enumerate() {
        let mut params: Vec<Option<String>> = Vec::with_capacity(chunk.len() * targets.len());
        let mut tuples: Vec<String> = Vec::with_capacity(chunk.len());

        for row in chunk {
            let mut placeholders = Vec::with_capacity(targets.len());
            for (column, source) in &targets {
                let cell = row
                    .get(*source)
                    .cloned()
                    .flatten()
                    .filter(|text| Some(text.as_str()) != null_literal);
                params.push(cell);
                placeholders.push(format!("${}::{}", params.len(), column.data_type));
            }
            tuples.push(format!("({})", placeholders.join(", ")));
        }

        let sql = format!(
            "INSERT INTO {relation} ({}) VALUES {}",
            names.join(", "),
            tuples.join(", ")
        );
        let bound: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|value| value as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        match client.execute(&sql, &bound).await {
            Ok(count) => inserted += count,
            Err(error) => {
                failed += chunk.len() as u64;
                let first_row = chunk_index * rows_per_batch + 1;
                let last_row = first_row + chunk.len() - 1;
                errors.push(format!("rows {first_row}–{last_row}: {error}"));
                if request.stop_on_error {
                    return Err(CoreError::Postgres(error));
                }
            }
        }
    }

    Ok(ImportOutcome {
        inserted,
        failed,
        errors,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn read_file(path: &str, has_header: bool, delimiter: Option<&str>) -> CoreResult<Sheet> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "json" => read_json(path),
        "xlsx" | "xlsm" | "xls" | "ods" => read_spreadsheet(path, has_header),
        _ => read_csv(path, has_header, delimiter),
    }
}

fn read_csv(path: &str, has_header: bool, delimiter: Option<&str>) -> CoreResult<Sheet> {
    let separator = delimiter
        .and_then(|value| value.as_bytes().first().copied())
        .unwrap_or(b',');

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(separator)
        .flexible(true)
        .has_headers(false)
        .from_path(path)?;

    let mut records = reader.records();
    let first = match records.next() {
        Some(record) => record?,
        None => {
            return Ok(Sheet {
                columns: Vec::new(),
                rows: Vec::new(),
            })
        }
    };

    let columns: Vec<String> = if has_header {
        first.iter().map(|field| field.trim().to_string()).collect()
    } else {
        (1..=first.len())
            .map(|index| format!("column{index}"))
            .collect()
    };

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    if !has_header {
        rows.push(to_cells(first.iter()));
    }
    for record in records {
        rows.push(to_cells(record?.iter()));
    }

    Ok(Sheet { columns, rows })
}

fn to_cells<'a>(fields: impl Iterator<Item = &'a str>) -> Vec<Option<String>> {
    fields
        .map(|field| {
            if field.is_empty() {
                None
            } else {
                Some(field.to_string())
            }
        })
        .collect()
}

fn read_json(path: &str) -> CoreResult<Sheet> {
    let file = File::open(path)?;
    let parsed: Value = serde_json::from_reader(BufReader::new(file))?;

    let records = match parsed {
        Value::Array(items) => items,
        Value::Object(_) => vec![parsed],
        _ => {
            return Err(CoreError::Invalid(
                "the JSON file must contain an array of objects".into(),
            ))
        }
    };

    let mut columns: Vec<String> = Vec::new();
    for record in &records {
        if let Value::Object(map) = record {
            for key in map.keys() {
                if !columns.iter().any(|existing| existing == key) {
                    columns.push(key.clone());
                }
            }
        }
    }

    if columns.is_empty() {
        return Err(CoreError::Invalid(
            "no object keys were found in the JSON file".into(),
        ));
    }

    let rows = records
        .iter()
        .map(|record| {
            columns
                .iter()
                .map(|column| match record.get(column) {
                    None | Some(Value::Null) => None,
                    Some(Value::String(text)) => Some(text.clone()),
                    Some(other) => Some(other.to_string()),
                })
                .collect()
        })
        .collect();

    Ok(Sheet { columns, rows })
}

fn read_spreadsheet(path: &str, has_header: bool) -> CoreResult<Sheet> {
    let mut workbook =
        open_workbook_auto(path).map_err(|error| CoreError::Spreadsheet(error.to_string()))?;

    let name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| CoreError::Spreadsheet("the workbook has no sheets".into()))?;

    let range = workbook
        .worksheet_range(&name)
        .map_err(|error| CoreError::Spreadsheet(error.to_string()))?;

    let mut iterator = range.rows();
    let first = match iterator.next() {
        Some(row) => row,
        None => {
            return Ok(Sheet {
                columns: Vec::new(),
                rows: Vec::new(),
            })
        }
    };

    let columns: Vec<String> = if has_header {
        first
            .iter()
            .enumerate()
            .map(|(index, cell)| match cell_text(cell) {
                Some(text) if !text.trim().is_empty() => text.trim().to_string(),
                _ => format!("column{}", index + 1),
            })
            .collect()
    } else {
        (1..=first.len())
            .map(|index| format!("column{index}"))
            .collect()
    };

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    if !has_header {
        rows.push(first.iter().map(cell_text).collect());
    }
    for row in iterator {
        rows.push(row.iter().map(cell_text).collect());
    }

    Ok(Sheet { columns, rows })
}

fn cell_text(cell: &Data) -> Option<String> {
    match cell {
        Data::Empty => None,
        Data::String(text) if text.is_empty() => None,
        Data::String(text) => Some(text.clone()),
        Data::Float(number) => Some(format_number(*number)),
        Data::Int(number) => Some(number.to_string()),
        Data::Bool(flag) => Some(flag.to_string()),
        Data::DateTime(value) => Some(
            value
                .as_datetime()
                .map(|datetime| datetime.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| value.as_f64().to_string()),
        ),
        Data::DateTimeIso(text) => Some(text.clone()),
        Data::DurationIso(text) => Some(text.clone()),
        Data::Error(error) => Some(format!("{error:?}")),
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::temp_file;

    fn csv(name: &str, body: &str) -> String {
        temp_file(&format!("{name}.csv"), body)
    }

    // ---------------------------------------------------------- small helpers

    #[test]
    fn formats_whole_floats_as_integers() {
        assert_eq!(format_number(42.0), "42");
        assert_eq!(format_number(42.5), "42.5");
    }

    #[test]
    fn formats_negative_and_zero_numbers() {
        assert_eq!(format_number(0.0), "0");
        assert_eq!(format_number(-7.0), "-7");
        assert_eq!(format_number(-7.25), "-7.25");
    }

    #[test]
    fn batches_stay_within_the_bind_parameter_limit() {
        assert_eq!(batch_rows(4), BATCH_ROWS);
        // 200 columns × 500 rows would be 100,000 parameters.
        assert!(batch_rows(200) * 200 <= MAX_BIND_PARAMS);
        assert_eq!(batch_rows(200), 327);
        // Absurdly wide files still make progress one row at a time.
        assert_eq!(batch_rows(70_000), 1);
    }

    #[test]
    fn a_batch_is_never_zero_rows() {
        for columns in [1usize, 10, 100, 1000, 10_000, 65_535, 100_000] {
            assert!(batch_rows(columns) >= 1, "{columns} columns gave no rows");
        }
    }

    #[test]
    fn empty_cells_become_null() {
        let cells = to_cells(["a", "", "c"].into_iter());
        assert_eq!(
            cells,
            vec![Some("a".to_string()), None, Some("c".to_string())]
        );
    }

    #[test]
    fn whitespace_is_a_value_not_a_null() {
        assert_eq!(to_cells([" "].into_iter()), vec![Some(" ".to_string())]);
    }

    // ------------------------------------------------------------------- CSV

    #[test]
    fn reads_a_header_and_rows() {
        let path = csv("basic", "id,name\n1,ann\n2,bo\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.rows[0], vec![Some("1".into()), Some("ann".into())]);
    }

    #[test]
    fn without_a_header_the_columns_are_numbered() {
        let path = csv("headerless", "1,ann\n2,bo\n");
        let preview = preview(&path, false, Some(",")).unwrap();
        assert_eq!(preview.columns, vec!["column1", "column2"]);
        assert_eq!(preview.total_rows, 2);
    }

    #[test]
    fn header_names_are_trimmed() {
        let path = csv("padded", " id , name \n1,ann\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn a_semicolon_delimiter_is_honoured() {
        let path = csv("semi", "id;name\n1;ann\n");
        let preview = preview(&path, true, Some(";")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn a_tab_delimiter_is_honoured() {
        let path = csv("tab", "id\tname\n1\tann\n");
        let preview = preview(&path, true, Some("\t")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn a_pipe_delimiter_is_honoured() {
        let path = csv("pipe", "id|name\n1|ann\n");
        let preview = preview(&path, true, Some("|")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn the_delimiter_defaults_to_a_comma() {
        let path = csv("default", "id,name\n1,ann\n");
        let preview = preview(&path, true, None).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn quoted_fields_may_contain_the_delimiter_and_newlines() {
        let path = csv("quoted", "id,note\n1,\"a,b\"\n2,\"line1\nline2\"\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.rows[0][1], Some("a,b".into()));
        assert_eq!(preview.rows[1][1], Some("line1\nline2".into()));
    }

    #[test]
    fn doubled_quotes_inside_a_field_are_unescaped() {
        let path = csv("escaped", "id,note\n1,\"it\"\"s\"\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.rows[0][1], Some("it\"s".into()));
    }

    #[test]
    fn empty_fields_read_back_as_null() {
        let path = csv("blank", "id,note\n1,\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.rows[0][1], None);
    }

    #[test]
    fn ragged_rows_are_tolerated() {
        let path = csv("ragged", "a,b,c\n1,2\n3,4,5,6\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.rows[0].len(), 2);
        assert_eq!(preview.rows[1].len(), 4);
    }

    #[test]
    fn an_empty_file_reads_as_nothing() {
        let path = csv("empty", "");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert!(preview.columns.is_empty());
        assert_eq!(preview.total_rows, 0);
    }

    #[test]
    fn a_header_only_file_has_columns_but_no_rows() {
        let path = csv("header-only", "id,name\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
        assert_eq!(preview.total_rows, 0);
    }

    #[test]
    fn a_missing_file_is_reported() {
        assert!(preview("/no/such/file.csv", true, Some(",")).is_err());
    }

    // ------------------------------------------------------------- previews

    #[test]
    fn the_preview_is_capped_and_says_so() {
        let mut body = String::from("id\n");
        for n in 0..(PREVIEW_ROWS + 25) {
            body.push_str(&format!("{n}\n"));
        }
        let path = csv("long", &body);
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.rows.len(), PREVIEW_ROWS);
        assert_eq!(preview.total_rows, PREVIEW_ROWS + 25);
        assert!(preview.truncated);
    }

    #[test]
    fn a_short_file_is_not_marked_truncated() {
        let path = csv("short", "id\n1\n2\n");
        assert!(!preview(&path, true, Some(",")).unwrap().truncated);
    }

    // ------------------------------------------------------------------ JSON

    #[test]
    fn reads_an_array_of_objects() {
        let path = temp_file(
            "array.json",
            r#"[{"id":1,"name":"ann"},{"id":2,"name":"bo"}]"#,
        );
        let preview = preview(&path, true, None).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.rows[0][0], Some("1".into()));
    }

    #[test]
    fn a_lone_object_is_read_as_one_row() {
        let path = temp_file("single.json", r#"{"id":1}"#);
        let preview = preview(&path, true, None).unwrap();
        assert_eq!(preview.total_rows, 1);
    }

    #[test]
    fn json_columns_are_the_union_of_every_object() {
        let path = temp_file("union.json", r#"[{"a":1},{"b":2}]"#);
        let preview = preview(&path, true, None).unwrap();
        assert_eq!(preview.columns, vec!["a", "b"]);
        assert_eq!(preview.rows[0][1], None);
        assert_eq!(preview.rows[1][0], None);
    }

    #[test]
    fn json_nulls_and_nested_values() {
        let path = temp_file(
            "nested.json",
            r#"[{"a":null,"b":{"x":1},"c":[1,2],"d":true}]"#,
        );
        let preview = preview(&path, true, None).unwrap();
        let row = &preview.rows[0];
        assert_eq!(row[0], None);
        assert_eq!(row[1], Some("{\"x\":1}".into()));
        assert_eq!(row[2], Some("[1,2]".into()));
        assert_eq!(row[3], Some("true".into()));
    }

    #[test]
    fn json_strings_keep_their_text_rather_than_their_quotes() {
        let path = temp_file("strings.json", r#"[{"a":"hello"}]"#);
        assert_eq!(
            preview(&path, true, None).unwrap().rows[0][0],
            Some("hello".into())
        );
    }

    #[test]
    fn a_json_scalar_is_refused() {
        let path = temp_file("scalar.json", "42");
        assert!(preview(&path, true, None).is_err());
    }

    #[test]
    fn a_json_array_without_objects_is_refused() {
        let path = temp_file("flat.json", "[1,2,3]");
        assert!(preview(&path, true, None).is_err());
    }

    #[test]
    fn malformed_json_is_reported() {
        let path = temp_file("broken.json", "{not json");
        assert!(preview(&path, true, None).is_err());
    }

    // -------------------------------------------------------- unknown suffix

    #[test]
    fn an_unknown_extension_is_read_as_delimited_text() {
        let path = temp_file("data.dat", "id,name\n1,ann\n");
        let preview = preview(&path, true, Some(",")).unwrap();
        assert_eq!(preview.columns, vec!["id", "name"]);
    }

    #[test]
    fn a_txt_file_is_read_as_delimited_text() {
        let path = temp_file("notes.txt", "a|b\n1|2\n");
        let preview = preview(&path, true, Some("|")).unwrap();
        assert_eq!(preview.columns, vec!["a", "b"]);
    }
}
