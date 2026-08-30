//! Append-only audit log.
//!
//! JSONL rather than a database: one event per line, append-only, readable
//! with `tail` and `grep` when the app is not running. An audit trail whose
//! contents can only be inspected through the thing being audited is worth
//! considerably less.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("could not write the audit log: {0}")]
    Write(String),
    #[error("could not read the audit log: {0}")]
    Read(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditKind {
    /// The stored key was read in order to make a request.
    SecretRead,
    /// The model asked for a tool.
    ToolCall,
    /// The user approved a command and it ran.
    CommandRun,
    /// The user declined a command.
    CommandRejected,
    /// A request was sent to a provider.
    ProviderRequest,
    /// An account was linked — GitHub, or another service the user connects.
    ///
    /// Worth a line of its own: it is the moment this machine gained standing
    /// access to something outside it, and the owner should be able to see
    /// when that happened without asking the app.
    AccountConnected,
    /// An account was unlinked and its token deleted.
    AccountDisconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    /// RFC 3339 UTC.
    pub at: String,
    pub kind: AuditKind,
    pub detail: String,
}

impl AuditEvent {
    pub fn new(kind: AuditKind, detail: &str) -> Self {
        Self { at: now_rfc3339(), kind, detail: sanitise(detail) }
    }
}

/// Strip anything that could end a JSONL record early.
///
/// Details are built from tool arguments, which come from the model. Without
/// this, a newline inside a detail writes a second record and lets a prompt
/// injection fabricate audit history.
fn sanitise(detail: &str) -> String {
    detail.replace(['\n', '\r'], " ")
}

fn now_rfc3339() -> String {
    // Formatted by hand rather than pulling in a date crate for one call site.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days-from-civil, inverted. Public domain algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub struct AuditLog {
    path: PathBuf,
}

impl AuditLog {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    pub fn append(&self, event: AuditEvent) -> Result<(), AuditError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AuditError::Write(e.to_string()))?;
        }
        let line = serde_json::to_string(&event).map_err(|e| AuditError::Write(e.to_string()))?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| AuditError::Write(e.to_string()))?;
        writeln!(file, "{line}").map_err(|e| AuditError::Write(e.to_string()))
    }

    /// Read every event, skipping any line that will not parse.
    ///
    /// A crash mid-append leaves a partial final line. Discarding the entire
    /// history because of it would be the wrong trade for an audit log.
    pub fn read_all(&self) -> Result<Vec<AuditEvent>, AuditError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(AuditError::Read(e.to_string())),
        };
        Ok(raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn log() -> (TempDir, AuditLog) {
        let d = TempDir::new().unwrap();
        let l = AuditLog::new(d.path().join("audit.jsonl"));
        (d, l)
    }

    #[test]
    fn an_empty_log_reads_as_no_events() {
        let (_d, l) = log();
        assert!(l.read_all().unwrap().is_empty());
    }

    #[test]
    fn an_appended_event_reads_back() {
        let (_d, l) = log();
        l.append(AuditEvent::new(AuditKind::ToolCall, "read_file src/main.rs")).unwrap();

        let events = l.read_all().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, AuditKind::ToolCall);
        assert!(events[0].detail.contains("read_file"));
    }

    #[test]
    fn events_keep_the_order_they_were_appended_in() {
        // An audit log whose order cannot be trusted is not an audit log.
        let (_d, l) = log();
        for i in 0..5 {
            l.append(AuditEvent::new(AuditKind::CommandRun, &format!("cmd-{i}"))).unwrap();
        }
        let details: Vec<String> = l.read_all().unwrap().into_iter().map(|e| e.detail).collect();
        assert_eq!(details, vec!["cmd-0", "cmd-1", "cmd-2", "cmd-3", "cmd-4"]);
    }

    #[test]
    fn every_event_carries_a_timestamp() {
        let (_d, l) = log();
        l.append(AuditEvent::new(AuditKind::SecretRead, "anthropic")).unwrap();
        assert!(!l.read_all().unwrap()[0].at.is_empty());
    }

    #[test]
    fn one_unreadable_line_does_not_discard_the_rest() {
        // A partially written final line — a crash mid-append — must not make
        // the whole history unreadable.
        let d = TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        let l = AuditLog::new(&path);
        l.append(AuditEvent::new(AuditKind::ToolCall, "good")).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{ truncated\n")
            .unwrap();

        assert_eq!(l.read_all().unwrap().len(), 1, "the good line must survive");
    }

    #[test]
    fn the_parent_directory_is_created_on_first_append() {
        let d = TempDir::new().unwrap();
        let nested = d.path().join("deep/deeper/audit.jsonl");
        AuditLog::new(&nested)
            .append(AuditEvent::new(AuditKind::ToolCall, "x"))
            .unwrap();
        assert!(nested.is_file());
    }

    #[test]
    fn a_detail_containing_a_newline_cannot_forge_a_second_entry() {
        // Details come from tool arguments, which come from the model. A
        // newline in a detail would otherwise write a second JSONL record and
        // let a prompt injection fabricate audit history.
        let (_d, l) = log();
        l.append(AuditEvent::new(
            AuditKind::ToolCall,
            "innocent\n{\"kind\":\"CommandRun\",\"detail\":\"forged\"}",
        ))
        .unwrap();

        let events = l.read_all().unwrap();
        assert_eq!(events.len(), 1, "a newline in a detail forged an entry");
    }
}

#[cfg(test)]
mod account_event_tests {
    use super::*;

    // The log is read back with `cat` by the machine's owner, so the names
    // in it are an interface: they have to say what happened without the
    // reader knowing the code.
    #[test]
    fn account_events_serialise_under_readable_names() {
        let connected = serde_json::to_string(&AuditEvent::new(
            AuditKind::AccountConnected,
            "github as octocat",
        ))
        .expect("serialises");
        assert!(connected.contains("AccountConnected"), "got {connected}");
        assert!(connected.contains("github as octocat"));

        let gone = serde_json::to_string(&AuditEvent::new(AuditKind::AccountDisconnected, "github"))
            .expect("serialises");
        assert!(gone.contains("AccountDisconnected"), "got {gone}");
    }

    #[test]
    fn an_account_event_reads_back_the_way_it_was_written() {
        let dir = tempfile::TempDir::new().unwrap();
        let log = AuditLog::new(dir.path().join("audit.jsonl"));
        log.append(AuditEvent::new(AuditKind::AccountConnected, "github as octocat"))
            .unwrap();

        let read = log.read_all().unwrap();
        assert_eq!(read.len(), 1);
        assert!(matches!(read[0].kind, AuditKind::AccountConnected));
        assert_eq!(read[0].detail, "github as octocat");
    }
}
