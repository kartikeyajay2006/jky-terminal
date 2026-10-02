//! Append-only, tamper-evident audit log.
//!
//! JSONL rather than a database: one event per line, append-only, readable
//! with `tail` and `grep` when the app is not running. An audit trail whose
//! contents can only be inspected through the thing being audited is worth
//! considerably less.
//!
//! **Tamper-evident.** Anything running as you can edit a file you own, so a
//! plain log is a record, not evidence. Every line therefore carries a
//! sequence number and a *link*: an HMAC-SHA-256 over the previous link and
//! this record, keyed with a secret kept in the OS keychain — or a plain
//! SHA-256 when no keychain is available, which still catches edits but is
//! honestly reported as unsigned. Changing, removing, reordering or inserting
//! a record breaks the chain from that point. Removing the *newest* records
//! leaves a valid chain behind, so the newest sequence number and link are
//! also kept in the keychain, beside the key. `jky-terminal --verify-audit`
//! checks all of it; the window is never handed the log.

mod keychain;

pub use keychain::{KeychainAnchor, HEAD_ENTRY, KEY_ENTRY};

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

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
    /// A picture of the window was taken, and where it went.
    ///
    /// A capture is one of the few things in this app that leaves it — onto
    /// the disk, or onto a clipboard any other program can read. That makes it
    /// worth a line, for the same reason a linked account is: the owner should
    /// be able to see what left without having to ask the app.
    Captured,
    /// A sign-in was started: a browser was opened at a provider's
    /// authorisation page.
    ///
    /// Recorded separately from the connection it may become, because the two
    /// are different facts and only one of them is usually written down. A
    /// sign-in that a person abandoned, or that a provider refused, leaves no
    /// account behind and would otherwise leave no trace at all — so the log
    /// would show a machine that never tried, which is not what happened.
    AccountConnectStarted,
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

/// The version of a chained record line.
pub const RECORD_VERSION: u32 = 2;

/// Where the signing key and the newest link are kept — the OS keychain in
/// the app, outside the file a tamperer would edit.
pub trait Anchor: Send + Sync {
    /// The signing key, created on first use. `None` when no keychain is
    /// available, in which case records are chained but not signed.
    fn key(&self) -> Option<[u8; 32]>;
    /// The newest record's sequence number and link, as last written.
    fn head(&self) -> Option<Head>;
    fn set_head(&self, head: &Head);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub seq: u64,
    pub link: String,
}

/// How the newest records compare with the anchored head.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TailCheck {
    Matches,
    /// No head was anchored — no keychain, or no records yet.
    NotAnchored,
    /// The newest records are gone: the head says `expected`, the file ends at `found`.
    Missing { expected: u64, found: u64 },
    /// The newest record is not the one that was written.
    Replaced { seq: u64 },
    /// More records than the head knows about: written while the keychain was unavailable.
    AheadOfAnchor { anchored: u64, found: u64 },
}

#[derive(Debug, Clone)]
pub struct Verification {
    pub records: usize,
    pub before_chain: usize,
    pub signed: usize,
    pub unsigned: usize,
    pub problems: Vec<String>,
    pub incomplete_tail: bool,
    pub newest: TailCheck,
}

impl Verification {
    /// Nothing was altered, removed, reordered or inserted, as far as the
    /// chain and the anchor can tell.
    pub fn intact(&self) -> bool {
        self.problems.is_empty() && matches!(self.newest, TailCheck::Matches | TailCheck::NotAnchored)
    }

    /// A report a person can read in a terminal.
    pub fn summary(&self) -> String {
        let mut out = Vec::new();
        let plural = |n: usize, one: &str, many: &str| if n == 1 { format!("1 {one}") } else { format!("{n} {many}") };
        if self.intact() && self.signed + self.unsigned == 0 && self.before_chain > 0 {
            let which = if self.before_chain == 1 {
                "the only record was".to_string()
            } else {
                format!("all {} records were", self.before_chain)
            };
            out.push(format!(
                "• Nothing to verify yet: {which} written before records were chained. New records are chained from now on."
            ));
        } else if self.intact() {
            out.push(format!("✓ The audit log is intact: {}.", plural(self.records, "record", "records")));
        } else {
            out.push("✗ The audit log has been altered, or cannot be fully checked:".to_string());
            for problem in &self.problems {
                out.push(format!("  - {problem}"));
            }
        }
        match &self.newest {
            TailCheck::Matches => out.push("  The newest record matches the one remembered in the keychain.".into()),
            TailCheck::NotAnchored => out.push(
                "  Note: no newest record is remembered in a keychain, so removal of the newest records cannot be detected.".into(),
            ),
            TailCheck::Missing { expected, found } => out.push(format!(
                "  - The newest {} missing: the keychain remembers record {expected}, the file ends at record {found}.",
                plural((expected - found) as usize, "record is", "records are")
            )),
            TailCheck::Replaced { seq } => out.push(format!("  - Record {seq}, the newest, is not the record that was written.")),
            TailCheck::AheadOfAnchor { anchored, found } => out.push(format!(
                "  - The file continues past record {anchored}, the newest one the keychain remembers, to record {found}. \
                 Those records were written while the keychain was unavailable, or added by hand."
            )),
        }
        if self.signed > 0 {
            out.push(format!("  {} signed with the key in your OS keychain.", plural(self.signed, "record is", "records are")));
        }
        if self.unsigned > 0 {
            out.push(format!(
                "  {} chained but not signed (no keychain was available). Edits are still caught; a forger who can rewrite the whole file is not.",
                plural(self.unsigned, "record is", "records are")
            ));
        }
        if self.before_chain > 0 && self.signed + self.unsigned > 0 {
            out.push(format!("  {} from before records were chained, and cannot be checked.", plural(self.before_chain, "record dates", "records date")));
        }
        if self.incomplete_tail {
            out.push("  The final line is incomplete — an interrupted write. It is ignored.".into());
        }
        out.join("\n")
    }
}

/// What `jky-terminal --verify-audit` (and `jky audit`) prints, and the exit
/// code: 0 intact, 1 altered or uncheckable, 2 the log could not be read.
pub fn check(path: &Path, anchor: Arc<dyn Anchor>) -> (String, i32) {
    let header = format!("Audit log: {}", path.display());
    match AuditLog::with_anchor(path, anchor).verify() {
        Ok(report) => (format!("{header}\n{}", report.summary()), if report.intact() { 0 } else { 1 }),
        Err(e) => (format!("{header}\n✗ {e}"), 2),
    }
}

pub struct AuditLog {
    path: PathBuf,
    anchor: Option<Arc<dyn Anchor>>,
    /// The newest record's sequence number and link, once the file has been
    /// read for them. Kept so an append does not re-read the whole log.
    tail: Mutex<Option<(u64, String)>>,
}

/// The link a chain starts from.
const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const SIGNED: &str = "hmac-sha256";
const UNSIGNED: &str = "sha256";

/// One line of the log, as written from the chain onwards.
#[derive(Debug, Serialize, Deserialize)]
struct Record {
    v: u32,
    seq: u64,
    at: String,
    kind: AuditKind,
    detail: String,
    alg: String,
    link: String,
}

/// What a link covers, in a fixed field order.
#[derive(Serialize)]
struct Canonical<'a> {
    seq: u64,
    at: &'a str,
    kind: AuditKind,
    detail: &'a str,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The link for one record, or `None` when it is signed and there is no key
/// to check it with.
fn link(alg: &str, key: Option<&[u8; 32]>, prev: &str, seq: u64, at: &str, kind: AuditKind, detail: &str) -> Option<String> {
    let body = serde_json::to_string(&Canonical { seq, at, kind, detail }).ok()?;
    let mut message = Vec::with_capacity(prev.len() + 1 + body.len());
    message.extend_from_slice(prev.as_bytes());
    message.push(b'\n');
    message.extend_from_slice(body.as_bytes());
    match alg {
        SIGNED => {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key?).ok()?;
            mac.update(&message);
            Some(hex(&mac.finalize().into_bytes()))
        }
        UNSIGNED => Some(hex(&Sha256::digest(&message))),
        _ => None,
    }
}

impl AuditLog {
    /// A log chained with plain SHA-256: edits are caught, but nothing is
    /// signed and the newest record is not remembered anywhere else.
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf(), anchor: None, tail: Mutex::new(None) }
    }

    /// A log signed with the anchor's key, whose newest record the anchor
    /// remembers.
    pub fn with_anchor(path: impl AsRef<Path>, anchor: Arc<dyn Anchor>) -> Self {
        Self { path: path.as_ref().to_path_buf(), anchor: Some(anchor), tail: Mutex::new(None) }
    }

    fn read_raw(&self) -> Result<String, AuditError> {
        match std::fs::read_to_string(&self.path) {
            Ok(r) => Ok(r),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(AuditError::Read(e.to_string())),
        }
    }

    /// Check every link, and the newest record against the anchor.
    pub fn verify(&self) -> Result<Verification, AuditError> {
        let raw = self.read_raw()?;
        let key = self.anchor.as_ref().and_then(|a| a.key());
        let mut report = Verification {
            records: 0,
            before_chain: 0,
            signed: 0,
            unsigned: 0,
            problems: Vec::new(),
            incomplete_tail: false,
            newest: TailCheck::NotAnchored,
        };
        let lines: Vec<&str> = raw.split('\n').collect();
        // A file that does not end in a newline ends in a line that was
        // being written when the app stopped.
        let unterminated = !raw.is_empty() && !raw.ends_with('\n');
        let (mut prev_seq, mut prev_link, mut chained) = (0u64, GENESIS.to_string(), false);
        let mut missing_key_reported = false;

        for (index, line) in lines.iter().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let last = index == lines.len() - 1;
            if let Ok(record) = serde_json::from_str::<Record>(line) {
                report.records += 1;
                if record.seq != prev_seq + 1 {
                    report.problems.push(format!(
                        "Record {} appears where record {} should be: records were removed, reordered or inserted.",
                        record.seq,
                        prev_seq + 1
                    ));
                }
                match link(&record.alg, key.as_ref(), &prev_link, record.seq, &record.at, record.kind, &record.detail) {
                    Some(expected) if expected == record.link => {}
                    Some(_) => report.problems.push(format!("Record {} was altered: its link does not match.", record.seq)),
                    None if record.alg == SIGNED => {
                        if !missing_key_reported {
                            report.problems.push(
                                "Signed records cannot be checked: the key is not available from the OS keychain.".into(),
                            );
                            missing_key_reported = true;
                        }
                    }
                    None => report.problems.push(format!("Record {} uses an unknown link algorithm.", record.seq)),
                }
                if record.alg == SIGNED {
                    report.signed += 1;
                } else {
                    if report.signed > 0 && key.is_some() {
                        report.problems.push(format!(
                            "Record {} is not signed although earlier records are.",
                            record.seq
                        ));
                    }
                    report.unsigned += 1;
                }
                chained = true;
                prev_seq = record.seq;
                prev_link = record.link;
            } else if serde_json::from_str::<AuditEvent>(line).is_ok() {
                report.records += 1;
                if chained {
                    report.problems.push(format!(
                        "Line {} is an unchained record after the chain began: it was inserted.",
                        index + 1
                    ));
                } else {
                    report.before_chain += 1;
                }
            } else if last && unterminated {
                report.incomplete_tail = true;
            } else {
                report.problems.push(format!("Line {} is not a valid record.", index + 1));
            }
        }

        if let Some(head) = self.anchor.as_ref().and_then(|a| a.head()) {
            report.newest = if prev_seq == head.seq {
                if prev_link == head.link { TailCheck::Matches } else { TailCheck::Replaced { seq: head.seq } }
            } else if prev_seq < head.seq {
                TailCheck::Missing { expected: head.seq, found: prev_seq }
            } else {
                TailCheck::AheadOfAnchor { anchored: head.seq, found: prev_seq }
            };
        }
        Ok(report)
    }

    /// The newest record's sequence number and link, read from the file.
    fn newest_on_disk(&self) -> Result<(u64, String, bool), AuditError> {
        let raw = self.read_raw()?;
        let newline_needed = !raw.is_empty() && !raw.ends_with('\n');
        let newest = raw
            .lines()
            .rev()
            .find_map(|l| serde_json::from_str::<Record>(l).ok())
            .map(|r| (r.seq, r.link))
            .unwrap_or((0, GENESIS.to_string()));
        Ok((newest.0, newest.1, newline_needed))
    }

    pub fn append(&self, event: AuditEvent) -> Result<(), AuditError> {
        let write = |e: std::io::Error| AuditError::Write(e.to_string());
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(write)?;
        }
        // Held across the whole append, so two events from two threads get
        // consecutive numbers and each links to the other's predecessor.
        let mut tail = self.tail.lock().map_err(|e| AuditError::Write(e.to_string()))?;
        let (seq, prev, mut newline) = match tail.take() {
            Some((seq, link)) => (seq, link, false),
            None => self.newest_on_disk()?,
        };

        let key = self.anchor.as_ref().and_then(|a| a.key());
        let alg = if key.is_some() { SIGNED } else { UNSIGNED };
        let seq = seq + 1;
        let link = link(alg, key.as_ref(), &prev, seq, &event.at, event.kind, &event.detail)
            .ok_or_else(|| AuditError::Write("could not compute the record's link".into()))?;
        let record = Record {
            v: RECORD_VERSION,
            seq,
            at: event.at,
            kind: event.kind,
            detail: event.detail,
            alg: alg.to_string(),
            link: link.clone(),
        };
        let line = serde_json::to_string(&record).map_err(|e| AuditError::Write(e.to_string()))?;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&self.path).map_err(write)?;
        // A previous run stopped mid-line: start this record on a line of its
        // own rather than glued to the fragment.
        if std::mem::take(&mut newline) {
            file.write_all(b"\n").map_err(write)?;
        }
        writeln!(file, "{line}").map_err(write)?;
        *tail = Some((seq, link.clone()));
        if let Some(anchor) = &self.anchor {
            anchor.set_head(&Head { seq, link });
        }
        Ok(())
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
            .filter_map(|l| {
                serde_json::from_str::<Record>(l)
                    .ok()
                    .map(|r| AuditEvent { at: r.at, kind: r.kind, detail: r.detail })
                    .or_else(|| serde_json::from_str::<AuditEvent>(l).ok())
            })
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

        // An attempt is its own fact. Without it the log shows a machine that
        // never tried, when what happened is that it tried and was refused.
        let started = serde_json::to_string(&AuditEvent::new(
            AuditKind::AccountConnectStarted,
            "gmail, opening the browser",
        ))
        .unwrap();
        assert!(started.contains("AccountConnectStarted"), "got {started}");
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

#[cfg(test)]
mod chain_tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    /// A keychain stand-in: a fixed key (or none) and a remembered head.
    struct TestAnchor {
        key: Option<[u8; 32]>,
        head: Mutex<Option<Head>>,
    }

    impl Anchor for TestAnchor {
        fn key(&self) -> Option<[u8; 32]> {
            self.key
        }
        fn head(&self) -> Option<Head> {
            self.head.lock().unwrap().clone()
        }
        fn set_head(&self, head: &Head) {
            *self.head.lock().unwrap() = Some(head.clone());
        }
    }

    fn anchored(key: Option<[u8; 32]>) -> (TempDir, Arc<TestAnchor>, AuditLog) {
        let d = TempDir::new().unwrap();
        let anchor = Arc::new(TestAnchor { key, head: Mutex::new(None) });
        let log = AuditLog::with_anchor(d.path().join("audit.jsonl"), anchor.clone());
        (d, anchor, log)
    }

    fn write_five(log: &AuditLog) {
        for i in 1..=5 {
            log.append(AuditEvent::new(AuditKind::CommandRun, &format!("cmd-{i}"))).unwrap();
        }
    }

    fn lines(d: &TempDir) -> Vec<String> {
        std::fs::read_to_string(d.path().join("audit.jsonl")).unwrap().lines().map(String::from).collect()
    }

    fn rewrite(d: &TempDir, lines: &[String]) {
        std::fs::write(d.path().join("audit.jsonl"), lines.join("\n") + "\n").unwrap();
    }

    #[test]
    fn records_carry_a_sequence_and_a_link() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let first: serde_json::Value = serde_json::from_str(&lines(&d)[0]).unwrap();
        assert_eq!(first["seq"], 1);
        assert_eq!(first["v"], RECORD_VERSION);
        assert_eq!(first["link"].as_str().unwrap().len(), 64, "a hex SHA-256");
        assert_eq!(first["alg"], "hmac-sha256");
    }

    #[test]
    fn an_untouched_log_verifies() {
        let (_d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let report = log.verify().unwrap();
        assert!(report.intact(), "{}", report.summary());
        assert_eq!(report.signed, 5);
        assert_eq!(report.newest, TailCheck::Matches);
    }

    #[test]
    fn editing_a_detail_is_caught() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let mut all = lines(&d);
        all[2] = all[2].replace("cmd-3", "nothing-to-see");
        rewrite(&d, &all);
        let report = log.verify().unwrap();
        assert!(!report.intact());
        assert!(report.summary().to_lowercase().contains("record 3 was altered"), "{}", report.summary());
    }

    #[test]
    fn deleting_a_record_in_the_middle_is_caught() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let mut all = lines(&d);
        all.remove(1);
        rewrite(&d, &all);
        assert!(!log.verify().unwrap().intact());
    }

    #[test]
    fn reordering_records_is_caught() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let mut all = lines(&d);
        all.swap(1, 3);
        rewrite(&d, &all);
        assert!(!log.verify().unwrap().intact());
    }

    #[test]
    fn deleting_the_newest_records_is_caught_by_the_anchor() {
        // The one edit a chain alone cannot see: the remaining prefix is
        // still a perfectly valid chain. The keychain remembers the head.
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let mut all = lines(&d);
        all.truncate(3);
        rewrite(&d, &all);
        let report = log.verify().unwrap();
        assert!(!report.intact());
        assert_eq!(report.newest, TailCheck::Missing { expected: 5, found: 3 });
    }

    #[test]
    fn a_forged_record_without_the_key_is_caught() {
        // Somebody who can edit the file but cannot read the keychain can
        // recompute an unkeyed hash, and nothing else.
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let forger = {
            let d2 = TempDir::new().unwrap();
            let unkeyed = AuditLog::new(d2.path().join("audit.jsonl"));
            write_five(&unkeyed);
            (d2, unkeyed)
        };
        rewrite(&d, &lines(&forger.0));
        assert!(!log.verify().unwrap().intact());
    }

    #[test]
    fn the_chain_continues_across_a_restart() {
        let (d, anchor, log) = anchored(Some([7; 32]));
        write_five(&log);
        drop(log);
        let again = AuditLog::with_anchor(d.path().join("audit.jsonl"), anchor);
        again.append(AuditEvent::new(AuditKind::ToolCall, "after restart")).unwrap();
        let report = again.verify().unwrap();
        assert!(report.intact(), "{}", report.summary());
        assert_eq!(report.signed, 6);
    }

    #[test]
    fn without_a_keychain_the_chain_still_catches_edits_and_says_it_is_unsigned() {
        let (d, _a, log) = anchored(None);
        write_five(&log);
        let report = log.verify().unwrap();
        assert!(report.intact());
        assert_eq!((report.signed, report.unsigned), (0, 5));
        assert!(report.summary().contains("not signed"), "{}", report.summary());

        let mut all = lines(&d);
        all[0] = all[0].replace("cmd-1", "cmd-x");
        rewrite(&d, &all);
        assert!(!log.verify().unwrap().intact());
    }

    #[test]
    fn records_from_before_the_chain_are_counted_not_condemned() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        std::fs::write(&path, "{\"at\":\"2026-01-01T00:00:00Z\",\"kind\":\"ToolCall\",\"detail\":\"old\"}\n").unwrap();
        let anchor = Arc::new(TestAnchor { key: Some([7; 32]), head: Mutex::new(None) });
        let log = AuditLog::with_anchor(&path, anchor);
        write_five(&log);
        let report = log.verify().unwrap();
        assert!(report.intact(), "{}", report.summary());
        assert_eq!((report.before_chain, report.signed), (1, 5));
        assert_eq!(log.read_all().unwrap().len(), 6);
    }

    #[test]
    fn a_log_with_only_unchained_records_does_not_claim_to_be_intact() {
        // Nothing was checked, so "intact" would be a claim with nothing
        // behind it.
        let d = TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        std::fs::write(&path, "{\"at\":\"2026-01-01T00:00:00Z\",\"kind\":\"ToolCall\",\"detail\":\"old\"}\n").unwrap();
        let summary = AuditLog::new(&path).verify().unwrap().summary();
        assert!(!summary.contains("intact"), "{summary}");
        assert!(summary.contains("Nothing to verify yet"), "{summary}");
    }

    #[test]
    fn an_unchained_record_inserted_after_the_chain_began_is_caught() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        let mut all = lines(&d);
        all.insert(2, "{\"at\":\"2026-01-01T00:00:00Z\",\"kind\":\"ToolCall\",\"detail\":\"slipped in\"}".into());
        rewrite(&d, &all);
        assert!(!log.verify().unwrap().intact());
    }

    #[test]
    fn an_interrupted_final_write_is_reported_without_condemning_the_rest() {
        let (d, _a, log) = anchored(Some([7; 32]));
        write_five(&log);
        std::fs::OpenOptions::new()
            .append(true)
            .open(d.path().join("audit.jsonl"))
            .unwrap()
            .write_all(b"{\"v\":2,\"seq\":6,\"at\":\"20")
            .unwrap();
        let report = log.verify().unwrap();
        assert!(report.incomplete_tail);
        assert_eq!(report.signed, 5);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
    }
}
