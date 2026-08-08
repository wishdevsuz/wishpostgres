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
    use crate::testing::temp_path;
    use serde_json::json;

    fn request(format: ExportFormat, rows: Vec<Vec<Value>>) -> ExportRequest {
        ExportRequest {
            path: temp_path("export"),
            format,
            columns: vec!["id".into(), "name".into()],
            rows,
            table_name: Some("public.people".into()),
            include_header: true,
        }
    }

    fn written(request: &ExportRequest) -> String {
        std::fs::read_to_string(&request.path).expect("the export should exist")
    }

    // ------------------------------------------------------------- rendering

    #[test]
    fn escapes_sql_literals() {
        assert_eq!(sql_literal(&json!("it's")), "'it''s'");
        assert_eq!(sql_literal(&Value::Null), "NULL");
        assert_eq!(sql_literal(&json!(42)), "42");
        assert_eq!(sql_literal(&json!({"a": 1})), "'{\"a\":1}'");
    }

    #[test]
    fn sql_literals_keep_booleans_unquoted() {
        assert_eq!(sql_literal(&json!(true)), "true");
        assert_eq!(sql_literal(&json!(false)), "false");
    }

    #[test]
    fn a_sql_literal_with_a_backslash_becomes_an_escape_string() {
        assert_eq!(sql_literal(&json!("a\\b")), "E'a\\\\b'");
    }

    #[test]
    fn escapes_copy_fields() {
        assert_eq!(copy_field(&Value::Null), "\\N");
        assert_eq!(copy_field(&json!("a\tb")), "a\\tb");
        assert_eq!(copy_field(&json!("back\\slash")), "back\\\\slash");
    }

    #[test]
    fn copy_fields_escape_newlines_and_carriage_returns() {
        assert_eq!(copy_field(&json!("a\nb")), "a\\nb");
        assert_eq!(copy_field(&json!("a\rb")), "a\\rb");
    }

    #[test]
    fn a_copy_field_escapes_the_backslash_before_anything_else() {
        // Otherwise "\t" written by the user would become a real tab escape.
        assert_eq!(copy_field(&json!("\\t")), "\\\\t");
    }

    #[test]
    fn renders_scalars_plainly() {
        assert_eq!(scalar(&json!("text")), "text");
        assert_eq!(scalar(&Value::Null), "");
        assert_eq!(scalar(&json!([1, 2])), "[1,2]");
    }

    #[test]
    fn scalars_render_numbers_and_booleans_without_quotes() {
        assert_eq!(scalar(&json!(1.5)), "1.5");
        assert_eq!(scalar(&json!(true)), "true");
        assert_eq!(scalar(&json!({"a": 1})), "{\"a\":1}");
    }

    // ------------------------------------------------------- qualified_table

    #[test]
    fn a_qualified_table_name_is_quoted_part_by_part() {
        let mut req = request(ExportFormat::SqlInsert, vec![]);
        req.table_name = Some("public.people".into());
        assert_eq!(qualified_table(&req).unwrap(), "\"public\".\"people\"");
    }

    #[test]
    fn an_unqualified_table_name_works_too() {
        let mut req = request(ExportFormat::SqlInsert, vec![]);
        req.table_name = Some("people".into());
        assert_eq!(qualified_table(&req).unwrap(), "\"people\"");
    }

    #[test]
    fn a_missing_or_blank_table_name_is_refused() {
        let mut req = request(ExportFormat::SqlInsert, vec![]);
        req.table_name = None;
        assert!(qualified_table(&req).is_err());
        req.table_name = Some("   ".into());
        assert!(qualified_table(&req).is_err());
    }

    #[test]
    fn a_table_name_cannot_smuggle_in_a_statement() {
        let mut req = request(ExportFormat::SqlInsert, vec![]);
        req.table_name = Some("t\"; DROP TABLE users; --".into());
        assert_eq!(
            qualified_table(&req).unwrap(),
            "\"t\"\"; DROP TABLE users; --\""
        );
    }

    // -------------------------------------------------------------- CSV

    #[test]
    fn csv_writes_a_header_and_every_row() {
        let req = request(
            ExportFormat::Csv,
            vec![vec![json!(1), json!("ann")], vec![json!(2), json!("bo")]],
        );
        assert_eq!(write(&req).unwrap(), 2);
        assert_eq!(written(&req), "id,name\n1,ann\n2,bo\n");
    }

    #[test]
    fn csv_can_omit_the_header() {
        let mut req = request(ExportFormat::Csv, vec![vec![json!(1), json!("ann")]]);
        req.include_header = false;
        write(&req).unwrap();
        assert_eq!(written(&req), "1,ann\n");
    }

    #[test]
    fn csv_quotes_a_field_containing_the_delimiter() {
        let req = request(ExportFormat::Csv, vec![vec![json!(1), json!("a,b")]]);
        write(&req).unwrap();
        assert!(written(&req).contains("\"a,b\""));
    }

    #[test]
    fn csv_writes_null_as_an_empty_field() {
        let req = request(ExportFormat::Csv, vec![vec![json!(1), Value::Null]]);
        write(&req).unwrap();
        assert!(written(&req).ends_with("1,\n"));
    }

    #[test]
    fn csv_with_no_rows_still_writes_the_header() {
        let req = request(ExportFormat::Csv, vec![]);
        assert_eq!(write(&req).unwrap(), 0);
        assert_eq!(written(&req), "id,name\n");
    }

    // -------------------------------------------------------------- JSON

    #[test]
    fn json_writes_one_object_per_row() {
        let req = request(
            ExportFormat::Json,
            vec![vec![json!(1), json!("ann")], vec![json!(2), Value::Null]],
        );
        assert_eq!(write(&req).unwrap(), 2);
        let parsed: Vec<Value> = serde_json::from_str(&written(&req)).unwrap();
        assert_eq!(parsed[0]["id"], json!(1));
        assert_eq!(parsed[0]["name"], json!("ann"));
        assert_eq!(parsed[1]["name"], Value::Null);
    }

    #[test]
    fn json_fills_missing_cells_with_null() {
        // A short row must not shift the remaining column names.
        let req = request(ExportFormat::Json, vec![vec![json!(1)]]);
        write(&req).unwrap();
        let parsed: Vec<Value> = serde_json::from_str(&written(&req)).unwrap();
        assert_eq!(parsed[0]["name"], Value::Null);
    }

    #[test]
    fn json_with_no_rows_is_an_empty_array() {
        let req = request(ExportFormat::Json, vec![]);
        write(&req).unwrap();
        let parsed: Vec<Value> = serde_json::from_str(&written(&req)).unwrap();
        assert!(parsed.is_empty());
    }

    // ----------------------------------------------------------- SQL INSERT

    #[test]
    fn sql_insert_names_the_table_and_columns() {
        let req = request(ExportFormat::SqlInsert, vec![vec![json!(1), json!("ann")]]);
        assert_eq!(write(&req).unwrap(), 1);
        let text = written(&req);
        assert!(text.starts_with("INSERT INTO \"public\".\"people\" (\"id\", \"name\") VALUES\n"));
        assert!(text.contains("  (1, 'ann');"));
    }

    #[test]
    fn sql_insert_batches_long_exports() {
        let rows: Vec<Vec<Value>> = (0..1200).map(|n| vec![json!(n), json!("x")]).collect();
        let req = request(ExportFormat::SqlInsert, rows);
        assert_eq!(write(&req).unwrap(), 1200);
        // 500 rows per statement: three INSERT headers.
        assert_eq!(written(&req).matches("INSERT INTO").count(), 3);
    }

    #[test]
    fn sql_insert_escapes_values() {
        let req = request(ExportFormat::SqlInsert, vec![vec![json!(1), json!("it's")]]);
        write(&req).unwrap();
        assert!(written(&req).contains("'it''s'"));
    }

    #[test]
    fn sql_insert_without_a_table_name_is_refused() {
        let mut req = request(ExportFormat::SqlInsert, vec![vec![json!(1), json!("a")]]);
        req.table_name = None;
        assert!(write(&req).is_err());
    }

    // ------------------------------------------------------------- SQL COPY

    #[test]
    fn sql_copy_writes_a_header_body_and_terminator() {
        let req = request(
            ExportFormat::SqlCopy,
            vec![vec![json!(1), json!("ann")], vec![json!(2), Value::Null]],
        );
        assert_eq!(write(&req).unwrap(), 2);
        assert_eq!(
            written(&req),
            "COPY \"public\".\"people\" (\"id\", \"name\") FROM stdin;\n1\tann\n2\t\\N\n\\.\n"
        );
    }

    #[test]
    fn sql_copy_with_no_rows_is_still_valid() {
        let req = request(ExportFormat::SqlCopy, vec![]);
        write(&req).unwrap();
        let text = written(&req);
        assert!(text.starts_with("COPY "));
        assert!(text.ends_with("\\.\n"));
    }

    // ------------------------------------------------------------- XLSX

    #[test]
    fn xlsx_produces_a_zip_container() {
        let req = request(ExportFormat::Xlsx, vec![vec![json!(1), json!("ann")]]);
        assert_eq!(write(&req).unwrap(), 1);
        let bytes = std::fs::read(&req.path).unwrap();
        // Every xlsx is a zip; the magic number is the cheapest proof.
        assert_eq!(&bytes[..2], b"PK");
        assert!(bytes.len() > 100);
    }

    #[test]
    fn xlsx_handles_an_empty_result() {
        let req = request(ExportFormat::Xlsx, vec![]);
        assert_eq!(write(&req).unwrap(), 0);
        assert!(std::fs::metadata(&req.path).unwrap().len() > 0);
    }

    // ------------------------------------------------------------- failures

    #[test]
    fn an_unwritable_path_is_reported() {
        let mut req = request(ExportFormat::Csv, vec![vec![json!(1), json!("a")]]);
        req.path = "/this/directory/does/not/exist/out.csv".into();
        assert!(write(&req).is_err());
    }
}
