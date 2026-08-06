//! Conversion of arbitrary PostgreSQL values into `serde_json::Value`.
//!
//! `tokio_postgres` hands back values in the binary wire format, so every type
//! the grid can display is decoded here. Types without a dedicated decoder fall
//! back to their UTF-8 rendering when that is meaningful and to a `\x…` hex
//! escape otherwise, which mirrors how `psql` prints unknown binary data.

use std::error::Error as StdError;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use fallible_iterator::FallibleIterator;
use postgres_protocol::types as proto;
use serde_json::{Number, Value};
use tokio_postgres::types::{FromSql, Kind, Type};

type DecodeError = Box<dyn StdError + Sync + Send>;

const JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Newtype whose `FromSql` implementation accepts every type.
#[derive(Debug, Clone)]
pub struct PgJson(pub Value);

impl<'a> FromSql<'a> for PgJson {
    fn from_sql(ty: &Type, raw: &'a [u8]) -> Result<Self, DecodeError> {
        Ok(PgJson(decode(ty, raw)))
    }

    fn from_sql_null(_: &Type) -> Result<Self, DecodeError> {
        Ok(PgJson(Value::Null))
    }

    fn accepts(_: &Type) -> bool {
        true
    }
}

/// Decode a single value. Decoding never fails: anything unrecognised degrades
/// to a printable representation so one exotic column cannot break a result set.
pub fn decode(ty: &Type, raw: &[u8]) -> Value {
    match ty.kind() {
        Kind::Array(inner) => decode_array(inner, raw),
        Kind::Domain(inner) => decode(inner, raw),
        Kind::Enum(_) => text_or_hex(raw),
        _ => decode_scalar(ty, raw),
    }
}

fn decode_scalar(ty: &Type, raw: &[u8]) -> Value {
    let decoded = match *ty {
        Type::BOOL => proto::bool_from_sql(raw).map(Value::Bool).map_err(drop),
        Type::INT2 => proto::int2_from_sql(raw).map(Value::from).map_err(drop),
        Type::INT4 => proto::int4_from_sql(raw).map(Value::from).map_err(drop),
        Type::OID => proto::oid_from_sql(raw).map(Value::from).map_err(drop),
        Type::INT8 => proto::int8_from_sql(raw).map(big_int).map_err(drop),
        Type::FLOAT4 => proto::float4_from_sql(raw)
            .map(|v| float(v as f64))
            .map_err(drop),
        Type::FLOAT8 => proto::float8_from_sql(raw).map(float).map_err(drop),
        Type::NUMERIC => numeric(raw).map(Value::String),
        Type::MONEY => proto::int8_from_sql(raw).map(money).map_err(drop),
        Type::CHAR => proto::char_from_sql(raw)
            .map(|v| Value::String(v.to_string()))
            .map_err(drop),
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::UNKNOWN | Type::XML => {
            Ok(text_or_hex(raw))
        }
        Type::JSON | Type::JSONB => json(raw),
        Type::UUID => <uuid::Uuid as FromSql>::from_sql(ty, raw)
            .map(|v| Value::String(v.to_string()))
            .map_err(drop),
        Type::BYTEA => Ok(Value::String(hex_escape(raw))),
        Type::DATE => date(raw),
        Type::TIME => time(raw),
        Type::TIMETZ => time_tz(raw),
        Type::TIMESTAMP => timestamp(raw),
        Type::TIMESTAMPTZ => timestamp_tz(raw),
        Type::INTERVAL => interval(raw),
        Type::INET | Type::CIDR => inet(raw),
        Type::MACADDR => mac(raw, 6),
        Type::MACADDR8 => mac(raw, 8),
        Type::POINT => geometric(raw, 2, |p| format!("({},{})", p[0], p[1])),
        Type::LSEG => geometric(raw, 4, |p| {
            format!("[({},{}),({},{})]", p[0], p[1], p[2], p[3])
        }),
        Type::BOX => geometric(raw, 4, |p| {
            format!("({},{}),({},{})", p[0], p[1], p[2], p[3])
        }),
        Type::LINE => geometric(raw, 3, |p| format!("{{{},{},{}}}", p[0], p[1], p[2])),
        Type::CIRCLE => geometric(raw, 3, |p| format!("<({},{}),{}>", p[0], p[1], p[2])),
        _ => Ok(text_or_hex(raw)),
    };

    decoded.unwrap_or_else(|_| text_or_hex(raw))
}

fn decode_array(inner: &Type, raw: &[u8]) -> Value {
    let Ok(array) = proto::array_from_sql(raw) else {
        return text_or_hex(raw);
    };

    let mut dimensions = Vec::new();
    let mut dims = array.dimensions();
    while let Ok(Some(dim)) = dims.next() {
        dimensions.push(dim.len.max(0) as usize);
    }

    let mut flat = Vec::new();
    let mut values = array.values();
    loop {
        match values.next() {
            Ok(Some(Some(bytes))) => flat.push(decode(inner, bytes)),
            Ok(Some(None)) => flat.push(Value::Null),
            Ok(None) => break,
            Err(_) => return text_or_hex(raw),
        }
    }

    nest(&dimensions, flat)
}

fn nest(dimensions: &[usize], flat: Vec<Value>) -> Value {
    if dimensions.len() <= 1 {
        return Value::Array(flat);
    }
    let chunk: usize = dimensions[1..].iter().product::<usize>().max(1);
    Value::Array(
        flat.chunks(chunk)
            .map(|slice| nest(&dimensions[1..], slice.to_vec()))
            .collect(),
    )
}

fn big_int(value: i64) -> Value {
    // `unsigned_abs`, because `i64::MIN.abs()` overflows.
    if value.unsigned_abs() <= JS_SAFE_INTEGER as u64 {
        Value::from(value)
    } else {
        Value::String(value.to_string())
    }
}

fn float(value: f64) -> Value {
    match Number::from_f64(value) {
        Some(number) => Value::Number(number),
        None if value.is_nan() => Value::String("NaN".into()),
        None if value.is_sign_positive() => Value::String("Infinity".into()),
        None => Value::String("-Infinity".into()),
    }
}

fn money(cents: i64) -> Value {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.unsigned_abs();
    Value::String(format!("{sign}{}.{:02}", abs / 100, abs % 100))
}

fn json(raw: &[u8]) -> Result<Value, ()> {
    // `jsonb` is sent as a one byte version header followed by the same text
    // `json` uses. Strip the header first — a leading 0x01 can never start a
    // valid JSON document, so there is no ambiguity — then fall back to the
    // untouched bytes for plain `json`.
    if let Some((1, rest)) = raw.split_first().map(|(first, rest)| (*first, rest)) {
        if let Ok(value) = serde_json::from_slice(rest) {
            return Ok(value);
        }
    }
    serde_json::from_slice(raw).map_err(drop)
}

fn date(raw: &[u8]) -> Result<Value, ()> {
    let days = proto::date_from_sql(raw).map_err(drop)?;
    if days == i32::MAX {
        return Ok(Value::String("infinity".into()));
    }
    if days == i32::MIN {
        return Ok(Value::String("-infinity".into()));
    }
    let base = NaiveDate::from_ymd_opt(2000, 1, 1).ok_or(())?;
    let value = base
        .checked_add_signed(chrono::Duration::days(days as i64))
        .ok_or(())?;
    Ok(Value::String(value.to_string()))
}

fn time(raw: &[u8]) -> Result<Value, ()> {
    let micros = proto::time_from_sql(raw).map_err(drop)?;
    Ok(Value::String(format_time(micros)))
}

fn time_tz(raw: &[u8]) -> Result<Value, ()> {
    if raw.len() < 12 {
        return Err(());
    }
    let micros = i64::from_be_bytes(raw[0..8].try_into().map_err(drop)?);
    let zone = i32::from_be_bytes(raw[8..12].try_into().map_err(drop)?);
    // PostgreSQL stores the zone as seconds west of UTC.
    let offset = -zone;
    let sign = if offset < 0 { '-' } else { '+' };
    let abs = offset.abs();
    Ok(Value::String(format!(
        "{}{sign}{:02}:{:02}",
        format_time(micros),
        abs / 3600,
        (abs % 3600) / 60
    )))
}

fn format_time(micros: i64) -> String {
    let total_seconds = micros.div_euclid(1_000_000);
    let fraction = micros.rem_euclid(1_000_000);
    let base =
        NaiveTime::from_num_seconds_from_midnight_opt((total_seconds.rem_euclid(86_400)) as u32, 0)
            .unwrap_or_default();
    if fraction == 0 {
        base.format("%H:%M:%S").to_string()
    } else {
        format!(
            "{}.{}",
            base.format("%H:%M:%S"),
            trim_fraction(fraction as u64)
        )
    }
}

fn trim_fraction(fraction: u64) -> String {
    format!("{fraction:06}").trim_end_matches('0').to_string()
}

fn timestamp(raw: &[u8]) -> Result<Value, ()> {
    match epoch_micros(raw)? {
        Timestamp::Infinite(text) => Ok(Value::String(text)),
        Timestamp::Value(value) => Ok(Value::String(
            value.format("%Y-%m-%d %H:%M:%S%.f").to_string(),
        )),
    }
}

fn timestamp_tz(raw: &[u8]) -> Result<Value, ()> {
    match epoch_micros(raw)? {
        Timestamp::Infinite(text) => Ok(Value::String(text)),
        Timestamp::Value(value) => {
            let utc = DateTime::<Utc>::from_naive_utc_and_offset(value, Utc);
            Ok(Value::String(
                utc.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
            ))
        }
    }
}

enum Timestamp {
    Value(NaiveDateTime),
    Infinite(String),
}

fn epoch_micros(raw: &[u8]) -> Result<Timestamp, ()> {
    let micros = proto::timestamp_from_sql(raw).map_err(drop)?;
    if micros == i64::MAX {
        return Ok(Timestamp::Infinite("infinity".into()));
    }
    if micros == i64::MIN {
        return Ok(Timestamp::Infinite("-infinity".into()));
    }
    let base = NaiveDate::from_ymd_opt(2000, 1, 1)
        .ok_or(())?
        .and_hms_opt(0, 0, 0)
        .ok_or(())?;
    let value = base
        .checked_add_signed(chrono::Duration::microseconds(micros))
        .ok_or(())?;
    Ok(Timestamp::Value(value))
}

fn interval(raw: &[u8]) -> Result<Value, ()> {
    if raw.len() < 16 {
        return Err(());
    }
    let micros = i64::from_be_bytes(raw[0..8].try_into().map_err(drop)?);
    let days = i32::from_be_bytes(raw[8..12].try_into().map_err(drop)?);
    let months = i32::from_be_bytes(raw[12..16].try_into().map_err(drop)?);

    let mut parts = Vec::new();
    if months != 0 {
        let years = months / 12;
        let remaining = months % 12;
        if years != 0 {
            parts.push(format!("{years} year{}", plural(years)));
        }
        if remaining != 0 {
            parts.push(format!("{remaining} mon{}", plural(remaining)));
        }
    }
    if days != 0 {
        parts.push(format!("{days} day{}", plural(days)));
    }
    if micros != 0 || parts.is_empty() {
        let negative = micros < 0;
        let abs = micros.unsigned_abs();
        let seconds = abs / 1_000_000;
        let fraction = abs % 1_000_000;
        let clock = format!(
            "{}{:02}:{:02}:{:02}",
            if negative { "-" } else { "" },
            seconds / 3600,
            (seconds % 3600) / 60,
            seconds % 60
        );
        parts.push(if fraction == 0 {
            clock
        } else {
            format!("{clock}.{}", trim_fraction(fraction))
        });
    }
    Ok(Value::String(parts.join(" ")))
}

fn plural(value: i32) -> &'static str {
    if value.abs() == 1 {
        ""
    } else {
        "s"
    }
}

fn inet(raw: &[u8]) -> Result<Value, ()> {
    if raw.len() < 4 {
        return Err(());
    }
    let bits = raw[1];
    let length = raw[3] as usize;
    let body = raw.get(4..4 + length).ok_or(())?;
    // `Ipv4Addr`/`Ipv6Addr` render the canonical form, including `::` collapsing
    // for IPv6, which hand-rolled joining does not.
    let (address, full_mask) = match length {
        4 => {
            let octets: [u8; 4] = body.try_into().map_err(drop)?;
            (std::net::Ipv4Addr::from(octets).to_string(), 32u8)
        }
        16 => {
            let octets: [u8; 16] = body.try_into().map_err(drop)?;
            (std::net::Ipv6Addr::from(octets).to_string(), 128u8)
        }
        _ => return Err(()),
    };
    Ok(Value::String(if bits == full_mask {
        address
    } else {
        format!("{address}/{bits}")
    }))
}

fn mac(raw: &[u8], length: usize) -> Result<Value, ()> {
    if raw.len() < length {
        return Err(());
    }
    Ok(Value::String(
        raw[..length]
            .iter()
            .map(|octet| format!("{octet:02x}"))
            .collect::<Vec<_>>()
            .join(":"),
    ))
}

fn geometric(raw: &[u8], count: usize, render: fn(&[f64]) -> String) -> Result<Value, ()> {
    if raw.len() < count * 8 {
        return Err(());
    }
    let mut values = Vec::with_capacity(count);
    for index in 0..count {
        let offset = index * 8;
        let bytes: [u8; 8] = raw[offset..offset + 8].try_into().map_err(drop)?;
        values.push(f64::from_be_bytes(bytes));
    }
    Ok(Value::String(render(&values)))
}

/// Decode PostgreSQL's base-10000 `numeric` wire format without loss.
fn numeric(raw: &[u8]) -> Result<String, ()> {
    if raw.len() < 8 {
        return Err(());
    }
    let digit_count = i16::from_be_bytes([raw[0], raw[1]]).max(0) as usize;
    let weight = i16::from_be_bytes([raw[2], raw[3]]) as i32;
    let sign = u16::from_be_bytes([raw[4], raw[5]]);
    let scale = u16::from_be_bytes([raw[6], raw[7]]) as usize;

    match sign {
        0xC000 => return Ok("NaN".into()),
        0xD000 => return Ok("Infinity".into()),
        0xF000 => return Ok("-Infinity".into()),
        _ => {}
    }
    if raw.len() < 8 + digit_count * 2 {
        return Err(());
    }

    let digits: Vec<i16> = (0..digit_count)
        .map(|index| {
            let offset = 8 + index * 2;
            i16::from_be_bytes([raw[offset], raw[offset + 1]])
        })
        .collect();

    let mut integer = String::new();
    if weight < 0 {
        integer.push('0');
    } else {
        for index in 0..=weight {
            let digit = digits.get(index as usize).copied().unwrap_or(0);
            if index == 0 {
                integer.push_str(&digit.to_string());
            } else {
                integer.push_str(&format!("{digit:04}"));
            }
        }
    }

    let mut fraction = String::new();
    let mut index = weight + 1;
    while fraction.len() < scale {
        let digit = if index < 0 {
            0
        } else {
            digits.get(index as usize).copied().unwrap_or(0)
        };
        fraction.push_str(&format!("{digit:04}"));
        index += 1;
    }
    fraction.truncate(scale);

    let prefix = if sign == 0x4000 { "-" } else { "" };
    Ok(if scale > 0 {
        format!("{prefix}{integer}.{fraction}")
    } else {
        format!("{prefix}{integer}")
    })
}

fn text_or_hex(raw: &[u8]) -> Value {
    match std::str::from_utf8(raw) {
        Ok(text)
            if !text
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r') =>
        {
            Value::String(text.to_string())
        }
        _ => Value::String(hex_escape(raw)),
    }
}

fn hex_escape(raw: &[u8]) -> String {
    let mut out = String::with_capacity(raw.len() * 2 + 2);
    out.push_str("\\x");
    for byte in raw {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Map an internal type name onto the SQL name people expect to read.
pub fn friendly_type_name(ty: &Type) -> String {
    if let Kind::Array(inner) = ty.kind() {
        return format!("{}[]", friendly_type_name(inner));
    }
    match ty.name() {
        "int2" => "smallint",
        "int4" => "integer",
        "int8" => "bigint",
        "float4" => "real",
        "float8" => "double precision",
        "bpchar" => "character",
        "varchar" => "character varying",
        "bool" => "boolean",
        "timestamptz" => "timestamp with time zone",
        "timetz" => "time with time zone",
        other => other,
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numeric_bytes(digits: &[i16], weight: i16, sign: u16, scale: u16) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(digits.len() as i16).to_be_bytes());
        bytes.extend_from_slice(&weight.to_be_bytes());
        bytes.extend_from_slice(&sign.to_be_bytes());
        bytes.extend_from_slice(&scale.to_be_bytes());
        for digit in digits {
            bytes.extend_from_slice(&digit.to_be_bytes());
        }
        bytes
    }

    #[test]
    fn decodes_numeric() {
        assert_eq!(numeric(&numeric_bytes(&[], 0, 0, 0)).unwrap(), "0");
        assert_eq!(
            numeric(&numeric_bytes(&[1234, 5000], 0, 0, 1)).unwrap(),
            "1234.5"
        );
        assert_eq!(numeric(&numeric_bytes(&[10], -1, 0, 3)).unwrap(), "0.001");
        assert_eq!(
            numeric(&numeric_bytes(&[1, 2345], 1, 0x4000, 0)).unwrap(),
            "-12345"
        );
        assert_eq!(numeric(&numeric_bytes(&[], 0, 0xC000, 0)).unwrap(), "NaN");
    }

    #[test]
    fn large_integers_stay_exact() {
        assert_eq!(big_int(42), Value::from(42));
        assert_eq!(
            big_int(9_223_372_036_854_775_807),
            Value::String("9223372036854775807".into())
        );
    }

    #[test]
    fn nests_multidimensional_arrays() {
        let flat = vec![
            Value::from(1),
            Value::from(2),
            Value::from(3),
            Value::from(4),
        ];
        assert_eq!(nest(&[2, 2], flat), serde_json::json!([[1, 2], [3, 4]]));
    }

    #[test]
    fn money_formatting() {
        assert_eq!(money(12345), Value::String("123.45".into()));
        assert_eq!(money(-5), Value::String("-0.05".into()));
    }

    #[test]
    fn binary_falls_back_to_hex() {
        assert_eq!(hex_escape(&[0xde, 0xad]), "\\xdead");
    }

    #[test]
    fn decodes_jsonb_including_bare_scalars() {
        // jsonb arrives as a version byte followed by the JSON text. A bare
        // string used to be mistaken for plain json and fell back to hex.
        let jsonb = |text: &str| {
            let mut bytes = vec![1u8];
            bytes.extend_from_slice(text.as_bytes());
            bytes
        };
        assert_eq!(json(&jsonb(r#""hello""#)).unwrap(), Value::from("hello"));
        assert_eq!(json(&jsonb("42")).unwrap(), Value::from(42));
        assert_eq!(json(&jsonb("null")).unwrap(), Value::Null);
        assert_eq!(
            json(&jsonb(r#"{"a":1}"#)).unwrap(),
            serde_json::json!({"a": 1})
        );
        // plain json has no version byte
        assert_eq!(json(br#"{"a":1}"#).unwrap(), serde_json::json!({"a": 1}));
        assert_eq!(json(br#""hello""#).unwrap(), Value::from("hello"));
    }

    #[test]
    fn extreme_integers_do_not_overflow() {
        assert_eq!(
            big_int(i64::MIN),
            Value::String("-9223372036854775808".into())
        );
        assert_eq!(
            interval(&[0; 16]).unwrap(),
            Value::String("00:00:00".into())
        );
    }

    #[test]
    fn renders_addresses_canonically() {
        // family, netmask bits, is_cidr, address length, then the octets.
        let v4 = [2u8, 24, 0, 4, 192, 168, 0, 1];
        assert_eq!(inet(&v4).unwrap(), Value::String("192.168.0.1/24".into()));

        let mut v6 = vec![3u8, 128, 0, 16];
        v6.extend_from_slice(&[0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        assert_eq!(inet(&v6).unwrap(), Value::String("2001:db8::1".into()));
    }
}
