//! Who started a held shell, and which protocol it speaks.
//!
//! A supervisor outlives the app that started it — that is its whole job —
//! so it also outlives *upgrades* of that app. Install a new JKY with a build
//! still running and the new window is talking to a supervisor that is the
//! old binary. Today they speak the same frames. The day they do not, the
//! new window must find out before it connects, not by misreading a frame.
//!
//! So each session's marker is a small record: the protocol its supervisor
//! speaks, the app version that started it, its process id and when it
//! started. A window reads it before joining and refuses, with a reason, a
//! supervisor that speaks a protocol newer than its own. The same record is
//! what `jky sessions` prints when something needs diagnosing.
//!
//! A marker from before records existed holds only the session's name. It
//! reads as protocol 1 — which is exactly what such a supervisor speaks.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::name::marker;

/// The wire protocol this build speaks: the frames in `frame.rs`.
///
/// Raise it when a change to the frames would confuse an older peer — a new
/// kind an older reader would refuse, or a payload laid out differently —
/// and older windows will decline to join rather than misread the stream.
pub const PROTOCOL: u32 = 1;

/// What a marker records about its supervisor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub session: String,
    pub protocol: u32,
    /// The app version that started it; empty when it predates records.
    #[serde(default)]
    pub app: String,
    /// Its process id; 0 when unknown.
    #[serde(default)]
    pub pid: u32,
    /// Seconds since the Unix epoch; 0 when unknown.
    #[serde(default)]
    pub started: u64,
}

impl Record {
    /// The record this process writes for a session it is supervising.
    pub fn current(session: &str) -> Self {
        Self {
            session: session.to_string(),
            protocol: PROTOCOL,
            app: env!("CARGO_PKG_VERSION").to_string(),
            pid: std::process::id(),
            started: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    }

    /// Read a marker's contents.
    ///
    /// A marker that is not a record is one written before records existed,
    /// which held the session's name and nothing else. It is read as what it
    /// is: protocol 1, from an unknown version.
    pub fn parse(session: &str, text: &str) -> Self {
        serde_json::from_str::<Record>(text)
            .ok()
            .filter(|r| r.session == session)
            .unwrap_or_else(|| Record {
                session: session.to_string(),
                protocol: 1,
                app: String::new(),
                pid: 0,
                started: 0,
            })
    }

    pub fn to_text(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.session.clone())
    }

    /// Whether a window of this build can talk to it.
    pub fn compatible(&self) -> bool {
        self.protocol <= PROTOCOL
    }
}

/// The record for one session, if a marker exists.
pub fn record(runtime_dir: &Path, session: &str) -> Option<Record> {
    let path = marker(runtime_dir, session).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    Some(Record::parse(session, &text))
}

/// Every recorded session, for diagnostics.
pub fn records(runtime_dir: &Path) -> Vec<Record> {
    crate::socket::sessions(runtime_dir)
        .into_iter()
        .filter_map(|s| record(runtime_dir, &s))
        .collect()
}

fn age(seconds: u64) -> String {
    match seconds {
        0..=59 => "just now".into(),
        60..=3599 => format!("{}m ago", seconds / 60),
        3600..=86_399 => format!("{}h {}m ago", seconds / 3600, seconds % 3600 / 60),
        _ => format!("{}d {}h ago", seconds / 86_400, seconds % 86_400 / 3600),
    }
}

/// What `jky sessions` prints.
///
/// From the markers, which say what was started — not proof that each is
/// still running. A shell that has since exited is cleared the next time a
/// window looks for it; the footnote says so rather than probing, for the
/// reasons `socket.rs` gives.
pub fn report(records: &[Record], now: u64) -> String {
    if records.is_empty() {
        return "No shells are being held in the background.\n".into();
    }
    let mut out = format!(
        "{} shell{} held in the background\n\n",
        records.len(),
        if records.len() == 1 { "" } else { "s" }
    );
    let width = records.iter().map(|r| r.session.len()).max().unwrap_or(0);
    for r in records {
        let mut line = format!("  {:<width$}", r.session);
        if r.pid != 0 {
            line.push_str(&format!("  pid {:<7}", r.pid));
        }
        if r.started != 0 {
            line.push_str(&format!("  started {:<12}", age(now.saturating_sub(r.started))));
        }
        if r.app.is_empty() {
            line.push_str("  started by an earlier JKY (no details recorded)");
        } else {
            line.push_str(&format!("  JKY {} · protocol {}", r.app, r.protocol));
        }
        if !r.compatible() {
            line.push_str(&format!(
                "  — newer than this JKY (protocol {PROTOCOL}): update to rejoin it"
            ));
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out.push_str(
        "\nListed from what each shell recorded when it started. One that has since\n\
         exited is cleared the next time JKY looks for it.\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_round_trips_through_its_marker_text() {
        let r = Record::current("pane-1");
        assert_eq!(r.protocol, PROTOCOL);
        assert_eq!(r.pid, std::process::id());
        assert!(!r.app.is_empty());
        assert_eq!(Record::parse("pane-1", &r.to_text()), r);
    }

    #[test]
    fn a_marker_from_before_records_reads_as_protocol_one() {
        // Exactly what an older supervisor wrote: its name, nothing else.
        let r = Record::parse("pane-1", "pane-1");
        assert_eq!(r.protocol, 1);
        assert!(r.app.is_empty());
        assert!(r.compatible());
    }

    #[test]
    fn a_record_naming_another_session_is_not_believed() {
        let other = Record::current("pane-2").to_text();
        assert_eq!(Record::parse("pane-1", &other).session, "pane-1");
        assert_eq!(Record::parse("pane-1", &other).pid, 0);
    }

    #[test]
    fn a_newer_protocol_is_not_compatible() {
        let r = Record { protocol: PROTOCOL + 1, ..Record::current("s") };
        assert!(!r.compatible());
    }

    #[test]
    fn the_report_names_each_shell_its_pid_age_and_version() {
        let now = 1_000_000;
        let shells = [
            Record { session: "pane-a".into(), protocol: 1, app: "0.1.0".into(), pid: 4242, started: now - 2 * 3600 - 300 },
            Record { session: "pane-bb".into(), protocol: 1, app: String::new(), pid: 0, started: 0 },
            Record { session: "pane-c".into(), protocol: PROTOCOL + 1, app: "9.0.0".into(), pid: 7, started: now - 30 },
        ];
        let text = report(&shells, now);
        assert!(text.starts_with("3 shells held in the background"), "{text}");
        assert!(text.contains("pane-a   pid 4242"), "{text}");
        assert!(text.contains("started 2h 5m ago"), "{text}");
        assert!(text.contains("JKY 0.1.0 · protocol 1"), "{text}");
        assert!(text.contains("pane-bb  started by an earlier JKY"), "{text}");
        assert!(text.contains("newer than this JKY"), "{text}");
        assert!(text.contains("cleared the next time"), "{text}");
    }

    #[test]
    fn an_empty_report_says_so() {
        assert_eq!(report(&[], 0), "No shells are being held in the background.\n");
    }
}
