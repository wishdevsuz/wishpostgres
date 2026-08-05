//! Backup and restore by driving the `pg_dump` and `psql` binaries.
//!
//! Credentials are passed through the environment rather than the command line
//! so they never appear in the process list.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::error::{CoreError, CoreResult};
use crate::models::TransferProgress;
use crate::pool::ConnectionTarget;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub database: String,
    pub path: String,
    #[serde(default)]
    pub schema_only: bool,
    #[serde(default)]
    pub data_only: bool,
    #[serde(default = "default_true")]
    pub include_drop: bool,
    #[serde(default)]
    pub include_create: bool,
    #[serde(default)]
    pub schemas: Vec<String>,
    #[serde(default)]
    pub tables: Vec<String>,
    #[serde(default)]
    pub binary_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub database: String,
    pub path: String,
    #[serde(default = "default_true")]
    pub stop_on_error: bool,
    #[serde(default)]
    pub single_transaction: bool,
    #[serde(default)]
    pub binary_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOutcome {
    pub path: String,
    pub bytes: u64,
    pub duration_ms: u64,
    pub warnings: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn resolve_binary(directory: Option<&str>, name: &str) -> PathBuf {
    match directory.filter(|value| !value.trim().is_empty()) {
        Some(base) => Path::new(base).join(name),
        None => PathBuf::from(name),
    }
}

fn apply_environment(command: &mut Command, target: &ConnectionTarget, database: &str) {
    command
        .env("PGHOST", &target.host)
        .env("PGPORT", target.port.to_string())
        .env("PGUSER", &target.username)
        .env("PGDATABASE", database)
        .env("PGCLIENTENCODING", "UTF8")
        .env(
            "PGSSLMODE",
            if target.ssl {
                if target.verify_certificate {
                    "verify-full"
                } else {
                    "require"
                }
            } else {
                "prefer"
            },
        );

    match &target.password {
        Some(password) => {
            command.env("PGPASSWORD", password);
        }
        None => {
            command.env_remove("PGPASSWORD");
        }
    }
}

/// Number of tables `pg_dump` will visit, used to turn its verbose output into
/// a real percentage rather than a spinner.
pub async fn dump(
    target: &ConnectionTarget,
    request: &BackupRequest,
    total_tables: Option<u64>,
    token: &str,
    report: impl Fn(TransferProgress) + Send + Sync,
) -> CoreResult<TransferOutcome> {
    let started = std::time::Instant::now();
    let binary = resolve_binary(request.binary_directory.as_deref(), "pg_dump");

    let mut command = Command::new(&binary);
    apply_environment(&mut command, target, &request.database);
    command
        .arg("--verbose")
        .arg("--no-password")
        .arg("--format=plain")
        .arg("--encoding=UTF8")
        .arg("--file")
        .arg(&request.path);

    if request.schema_only {
        command.arg("--schema-only");
    }
    if request.data_only {
        command.arg("--data-only");
    }
    if request.include_drop && !request.data_only {
        command.arg("--clean").arg("--if-exists");
    }
    if request.include_create {
        command.arg("--create");
    }
    for schema in &request.schemas {
        command.arg("--schema").arg(schema);
    }
    for table in &request.tables {
        command.arg("--table").arg(table);
    }

    command.stdout(Stdio::null()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| missing_binary(&binary, error))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CoreError::Invalid("could not read pg_dump output".into()))?;

    report(TransferProgress {
        token: token.to_string(),
        stage: "starting".into(),
        percent: Some(0.0),
        message: format!("Dumping {}", request.database),
        done: false,
    });

    let mut lines = BufReader::new(stderr).lines();
    let mut warnings: Vec<String> = Vec::new();
    let mut tables_done = 0u64;

    while let Some(line) = lines.next_line().await? {
        if let Some(table) = line.split("dumping contents of table ").nth(1) {
            tables_done += 1;
            report(TransferProgress {
                token: token.to_string(),
                stage: "dumping".into(),
                percent: total_tables
                    .filter(|total| *total > 0)
                    .map(|total| (tables_done as f32 / total as f32 * 100.0).min(99.0)),
                message: format!("Dumping {}", table.trim().trim_matches('"')),
                done: false,
            });
        } else if is_problem(&line) {
            warnings.push(clean_line(&line));
        }
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(CoreError::Invalid(if warnings.is_empty() {
            format!("pg_dump exited with status {}", status_code(&status))
        } else {
            warnings.join("\n")
        }));
    }

    let bytes = tokio::fs::metadata(&request.path)
        .await
        .map(|meta| meta.len())
        .unwrap_or(0);

    report(TransferProgress {
        token: token.to_string(),
        stage: "complete".into(),
        percent: Some(100.0),
        message: format!("Wrote {}", human_bytes(bytes)),
        done: true,
    });

    Ok(TransferOutcome {
        path: request.path.clone(),
        bytes,
        duration_ms: started.elapsed().as_millis() as u64,
        warnings,
    })
}

/// Restore a plain SQL dump by streaming it into `psql`, which gives an exact
/// byte-based progress reading.
pub async fn restore(
    target: &ConnectionTarget,
    request: &RestoreRequest,
    token: &str,
    report: impl Fn(TransferProgress) + Send + Sync,
) -> CoreResult<TransferOutcome> {
    let started = std::time::Instant::now();
    let binary = resolve_binary(request.binary_directory.as_deref(), "psql");

    let total = tokio::fs::metadata(&request.path).await?.len();
    let mut file = tokio::fs::File::open(&request.path).await?;

    let mut command = Command::new(&binary);
    apply_environment(&mut command, target, &request.database);
    command
        .arg("--no-password")
        .arg("--quiet")
        .arg("--no-psqlrc")
        .arg("--set")
        .arg(if request.stop_on_error {
            "ON_ERROR_STOP=1"
        } else {
            "ON_ERROR_STOP=0"
        });

    if request.single_transaction {
        command.arg("--single-transaction");
    }

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| missing_binary(&binary, error))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| CoreError::Invalid("could not write to psql".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| CoreError::Invalid("could not read psql output".into()))?;

    let collector = tokio::spawn(async move {
        let mut buffer = String::new();
        stderr.read_to_string(&mut buffer).await.ok();
        buffer
    });

    report(TransferProgress {
        token: token.to_string(),
        stage: "starting".into(),
        percent: Some(0.0),
        message: format!("Restoring into {}", request.database),
        done: false,
    });

    let mut buffer = vec![0u8; 128 * 1024];
    let mut written = 0u64;
    let mut last_reported = 0u64;

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        if stdin.write_all(&buffer[..read]).await.is_err() {
            // psql exited early, usually because ON_ERROR_STOP tripped.
            break;
        }
        written += read as u64;

        if written - last_reported >= 1024 * 1024 || written == total {
            last_reported = written;
            report(TransferProgress {
                token: token.to_string(),
                stage: "restoring".into(),
                percent: Some((written as f32 / total.max(1) as f32 * 100.0).min(99.0)),
                message: format!("{} of {}", human_bytes(written), human_bytes(total)),
                done: false,
            });
        }
    }

    stdin.shutdown().await.ok();
    drop(stdin);

    let status = child.wait().await?;
    let output = collector.await.unwrap_or_default();
    let messages: Vec<String> = output
        .lines()
        .filter(|line| is_problem(line))
        .map(clean_line)
        .collect();

    if !status.success() {
        return Err(CoreError::Invalid(if messages.is_empty() {
            format!("psql exited with status {}", status_code(&status))
        } else {
            messages.join("\n")
        }));
    }

    report(TransferProgress {
        token: token.to_string(),
        stage: "complete".into(),
        percent: Some(100.0),
        message: format!("Restored {}", human_bytes(written)),
        done: true,
    });

    Ok(TransferOutcome {
        path: request.path.clone(),
        bytes: written,
        duration_ms: started.elapsed().as_millis() as u64,
        warnings: messages,
    })
}

/// Report whether the external tools are available and which version they are.
pub async fn tool_version(directory: Option<&str>, name: &str) -> Option<String> {
    let binary = resolve_binary(directory, name);
    let output = Command::new(&binary).arg("--version").output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn missing_binary(binary: &Path, error: std::io::Error) -> CoreError {
    if error.kind() == std::io::ErrorKind::NotFound {
        CoreError::Invalid(format!(
            "`{}` was not found. Install the PostgreSQL client tools \
             (`sudo apt install postgresql-client`) or set the binary directory in Settings.",
            binary.display()
        ))
    } else {
        CoreError::Io(error)
    }
}

fn status_code(status: &std::process::ExitStatus) -> String {
    status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "signal".to_string())
}

fn is_problem(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("error") || lower.contains("fatal") || lower.contains("warning")
}

fn clean_line(line: &str) -> String {
    line.trim()
        .trim_start_matches("pg_dump: ")
        .trim_start_matches("psql: ")
        .to_string()
}

pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[0])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_sizes() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(2048), "2.0 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024), "5.0 MB");
    }

    #[test]
    fn detects_problem_lines() {
        assert!(is_problem("pg_dump: error: connection failed"));
        assert!(!is_problem("pg_dump: dumping contents of table users"));
    }

    #[test]
    fn resolves_binaries() {
        assert_eq!(resolve_binary(None, "psql"), PathBuf::from("psql"));
        assert_eq!(
            resolve_binary(Some("/usr/lib/postgresql/16/bin"), "psql"),
            PathBuf::from("/usr/lib/postgresql/16/bin/psql")
        );
    }
}
