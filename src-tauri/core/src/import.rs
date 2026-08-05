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
                CoreError::Invalid(format!(
                    "the file has no column named `{}`",
                    mapping.source
                ))
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

    for (chunk_index, chunk) in sheet.rows.chunks(BATCH_ROWS).enumerate() {
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
                let first_row = chunk_index * BATCH_ROWS + 1;
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
        (1..=first.len()).map(|index| format!("column{index}")).collect()
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
        (1..=first.len()).map(|index| format!("column{index}")).collect()
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

    #[test]
    fn formats_whole_floats_as_integers() {
        assert_eq!(format_number(42.0), "42");
        assert_eq!(format_number(42.5), "42.5");
    }

    #[test]
    fn empty_cells_become_null() {
        let cells = to_cells(["a", "", "c"].into_iter());
        assert_eq!(
            cells,
            vec![Some("a".to_string()), None, Some("c".to_string())]
        );
    }
}
