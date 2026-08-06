//! Writing result sets to CSV, JSON, XLSX and SQL.

use std::fs::File;
use std::io::{BufWriter, Write};

use rust_xlsxwriter::{Format, Workbook};
use serde_json::{Map, Value};

use crate::error::{CoreError, CoreResult};
use crate::ident::{quote_ident, quote_literal};
use crate::models::{ExportFormat, ExportRequest};

pub fn write(request: &ExportRequest) -> CoreResult<u64> {
    match request.format {
        ExportFormat::Csv => write_csv(request),
        ExportFormat::Json => write_json(request),
        ExportFormat::Xlsx => write_xlsx(request),
        ExportFormat::SqlInsert => write_sql_insert(request),
        ExportFormat::SqlCopy => write_sql_copy(request),
    }
}

fn write_csv(request: &ExportRequest) -> CoreResult<u64> {
    let mut writer = csv::Writer::from_path(&request.path)?;
    if request.include_header {
        writer.write_record(&request.columns)?;
    }
    for row in &request.rows {
        writer.write_record(row.iter().map(scalar))?;
    }
    writer.flush()?;
    Ok(request.rows.len() as u64)
}

fn write_json(request: &ExportRequest) -> CoreResult<u64> {
    let records: Vec<Value> = request
        .rows
        .iter()
        .map(|row| {
            let mut object = Map::new();
            for (index, column) in request.columns.iter().enumerate() {
                object.insert(
                    column.clone(),
                    row.get(index).cloned().unwrap_or(Value::Null),
                );
            }
            Value::Object(object)
        })
        .collect();

    let file = File::create(&request.path)?;
    serde_json::to_writer_pretty(BufWriter::new(file), &records)?;
    Ok(request.rows.len() as u64)
}

fn write_xlsx(request: &ExportRequest) -> CoreResult<u64> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let header = Format::new().set_bold();

    let mut offset = 0u32;
    if request.include_header {
        for (index, column) in request.columns.iter().enumerate() {
            sheet.write_string_with_format(0, index as u16, column, &header)?;
        }
        sheet.set_freeze_panes(1, 0)?;
        offset = 1;
    }

    for (row_index, row) in request.rows.iter().enumerate() {
        let target = row_index as u32 + offset;
        for (column_index, value) in row.iter().enumerate() {
            let column = column_index as u16;
            match value {
                Value::Null => {}
                Value::Bool(flag) => {
                    sheet.write_boolean(target, column, *flag)?;
                }
                Value::Number(number) => match number.as_f64() {
                    Some(numeric) => {
                        sheet.write_number(target, column, numeric)?;
                    }
                    None => {
                        sheet.write_string(target, column, number.to_string())?;
                    }
                },
                Value::String(text) => {
                    sheet.write_string(target, column, text)?;
                }
                other => {
                    sheet.write_string(target, column, other.to_string())?;
                }
            }
        }
    }

    sheet.autofit();
    workbook.save(&request.path)?;
    Ok(request.rows.len() as u64)
}

fn write_sql_insert(request: &ExportRequest) -> CoreResult<u64> {
    let table = qualified_table(request)?;
    let columns: Vec<String> = request
        .columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<CoreResult<_>>()?;

    let file = File::create(&request.path)?;
    let mut writer = BufWriter::new(file);

    for chunk in request.rows.chunks(500) {
        writeln!(
            writer,
            "INSERT INTO {table} ({}) VALUES",
            columns.join(", ")
        )?;
        let values: Vec<String> = chunk
            .iter()
            .map(|row| {
                let literals: Vec<String> = row.iter().map(sql_literal).collect();
                format!("  ({})", literals.join(", "))
            })
            .collect();
        writeln!(writer, "{};", values.join(",\n"))?;
    }

    writer.flush()?;
    Ok(request.rows.len() as u64)
}

fn write_sql_copy(request: &ExportRequest) -> CoreResult<u64> {
    let table = qualified_table(request)?;
    let columns: Vec<String> = request
        .columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<CoreResult<_>>()?;

    let file = File::create(&request.path)?;
    let mut writer = BufWriter::new(file);

    writeln!(writer, "COPY {table} ({}) FROM stdin;", columns.join(", "))?;
    for row in &request.rows {
        let fields: Vec<String> = row.iter().map(copy_field).collect();
        writeln!(writer, "{}", fields.join("\t"))?;
    }
    writeln!(writer, "\\.")?;

    writer.flush()?;
    Ok(request.rows.len() as u64)
}

fn qualified_table(request: &ExportRequest) -> CoreResult<String> {
    let raw = request
        .table_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| CoreError::Invalid("a table name is required for SQL export".into()))?;

    raw.split('.')
        .map(quote_ident)
        .collect::<CoreResult<Vec<_>>>()
        .map(|parts| parts.join("."))
}

/// Render a value the way the clipboard and CSV expect: scalars unquoted,
/// structured values as compact JSON.
pub fn scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        other => other.to_string(),
    }
}

fn sql_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => quote_literal(text),
        other => quote_literal(&other.to_string()),
    }
}

fn copy_field(value: &Value) -> String {
    match value {
        Value::Null => "\\N".to_string(),
        other => scalar(other)
            .replace('\\', "\\\\")
            .replace('\t', "\\t")
            .replace('\n', "\\n")
            .replace('\r', "\\r"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn escapes_sql_literals() {
        assert_eq!(sql_literal(&json!("it's")), "'it''s'");
        assert_eq!(sql_literal(&Value::Null), "NULL");
        assert_eq!(sql_literal(&json!(42)), "42");
        assert_eq!(sql_literal(&json!({"a": 1})), "'{\"a\":1}'");
    }

    #[test]
    fn escapes_copy_fields() {
        assert_eq!(copy_field(&Value::Null), "\\N");
        assert_eq!(copy_field(&json!("a\tb")), "a\\tb");
        assert_eq!(copy_field(&json!("back\\slash")), "back\\\\slash");
    }

    #[test]
    fn renders_scalars_plainly() {
        assert_eq!(scalar(&json!("text")), "text");
        assert_eq!(scalar(&Value::Null), "");
        assert_eq!(scalar(&json!([1, 2])), "[1,2]");
    }
}
