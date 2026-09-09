use std::io::Write;
use std::path::{Path, PathBuf};

use crate::entry::{Entry, Hit};
use crate::search::{search, Query};

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("could not read the history: {0}")]
    Read(String),
    #[error("could not write to the history: {0}")]
    Write(String),
    #[error("a command cannot be empty")]
    Empty,
}

/// How many commands are kept.
///
/// A cap, unlike the dashboard's collections, and for a narrower reason than
/// scrollback's: this is small — a hundred thousand commands is a few
/// megabytes — but it is read in full on every search, and an unbounded file
/// would eventually make the search box stutter on a machine that has been
/// running the app for years.
pub const MAX_ENTRIES: usize = 100_000;

/// How many are dropped when the cap is reached.
///
/// A block rather than one at a time: rewriting a hundred-thousand-line file
/// to remove a single entry, on every command, would make the terminal slower
/// the longer it had been used.
const TRIM_TO: usize = 90_000;

/// Longest command recorded.
///
/// Something pasted a megabyte long is not a command anyone will search for,
/// and storing it would put the whole megabyte in front of every future
/// search. Truncated rather than refused: knowing that something enormous ran
/// is worth more than a gap.
pub const MAX_COMMAND: usize = 4096;

/// Every command that has run, on disk.
///
/// One JSON object per line. Appending is the common case by a wide margin —
/// once per command — and a line-delimited file appends without reading or
/// rewriting anything.
pub struct History {
    path: PathBuf,
}

impl History {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Read every entry, skipping any line that is not one.
    ///
    /// A single corrupt line — a half-written record from a machine that lost
    /// power mid-append — must not cost someone their whole history.
    pub fn all(&self) -> Result<Vec<Entry>, HistoryError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(HistoryError::Read(e.to_string())),
        };

        Ok(raw.lines().filter_map(|line| serde_json::from_str::<Entry>(line).ok()).collect())
    }

    /// Add one command.
    ///
    /// Blank commands are refused rather than stored: pressing Enter at an
    /// empty prompt is not a thing anyone searches for, and a history full of
    /// them is a history that has to be scrolled past.
    pub fn record(&self, mut entry: Entry) -> Result<(), HistoryError> {
        entry.command = entry.command.trim().to_string();
        if entry.command.is_empty() {
            return Err(HistoryError::Empty);
        }
        if entry.command.chars().count() > MAX_COMMAND {
            entry.command = entry.command.chars().take(MAX_COMMAND).collect();
        }

        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| HistoryError::Write(e.to_string()))?;
        }

        let line = serde_json::to_string(&entry).map_err(|e| HistoryError::Write(e.to_string()))?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| HistoryError::Write(e.to_string()))?;
        writeln!(file, "{line}").map_err(|e| HistoryError::Write(e.to_string()))?;

        self.trim_if_needed()
    }

    fn trim_if_needed(&self) -> Result<(), HistoryError> {
        let entries = self.all()?;
        if entries.len() <= MAX_ENTRIES {
            return Ok(());
        }
        let kept = &entries[entries.len() - TRIM_TO..];
        self.rewrite(kept)
    }

    fn rewrite(&self, entries: &[Entry]) -> Result<(), HistoryError> {
        let mut out = String::new();
        for entry in entries {
            let line =
                serde_json::to_string(entry).map_err(|e| HistoryError::Write(e.to_string()))?;
            out.push_str(&line);
            out.push('\n');
        }
        // Through a neighbouring file, so an interrupted rewrite leaves the
        // old history intact rather than half of it.
        let temp = self.path.with_extension("jsonl.tmp");
        std::fs::write(&temp, out).map_err(|e| HistoryError::Write(e.to_string()))?;
        std::fs::rename(&temp, &self.path).map_err(|e| HistoryError::Write(e.to_string()))
    }

    pub fn search(&self, query: &Query, now: i64) -> Result<Vec<Hit>, HistoryError> {
        Ok(search(&self.all()?, query, now))
    }

    /// Forget every occurrence of one command.
    ///
    /// By command rather than by row: someone removing a line with a password
    /// in it means every time they ran it, not the one they happen to be
    /// looking at.
    pub fn forget(&self, command: &str) -> Result<usize, HistoryError> {
        let entries = self.all()?;
        let kept: Vec<Entry> = entries.iter().filter(|e| e.command != command).cloned().collect();
        let removed = entries.len() - kept.len();
        if removed > 0 {
            self.rewrite(&kept)?;
        }
        Ok(removed)
    }

    /// Forget everything.
    pub fn clear(&self) -> Result<(), HistoryError> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(HistoryError::Write(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const NOW: i64 = 1_800_000_000_000;

    fn history() -> (TempDir, History) {
        let dir = TempDir::new().unwrap();
        let h = History::new(dir.path().join("history.jsonl"));
        (dir, h)
    }

    fn entry(command: &str) -> Entry {
        Entry {
            command: command.into(),
            cwd: "/home/k".into(),
            code: 0,
            at: NOW,
            session: "pane-1".into(),
            host: None,
        }
    }

    #[test]
    fn a_missing_file_is_an_empty_history_not_an_error() {
        let (_d, h) = history();
        assert_eq!(h.all().unwrap(), vec![]);
        assert_eq!(h.search(&Query::default(), NOW).unwrap(), vec![]);
    }

    #[test]
    fn what_is_recorded_comes_back() {
        let (_d, h) = history();
        h.record(entry("git status")).unwrap();
        assert_eq!(h.all().unwrap().len(), 1);
        assert_eq!(h.all().unwrap()[0].command, "git status");
    }

    #[test]
    fn keeps_every_run_of_the_same_command() {
        // The count is what makes ranking by frequency possible.
        let (_d, h) = history();
        h.record(entry("ls")).unwrap();
        h.record(entry("ls")).unwrap();
        assert_eq!(h.all().unwrap().len(), 2);
        assert_eq!(h.search(&Query::default(), NOW).unwrap()[0].count, 2);
    }

    #[test]
    fn refuses_an_empty_command() {
        let (_d, h) = history();
        assert!(matches!(h.record(entry("   ")), Err(HistoryError::Empty)));
        assert_eq!(h.all().unwrap(), vec![]);
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let (_d, h) = history();
        h.record(entry("  git status  ")).unwrap();
        assert_eq!(h.all().unwrap()[0].command, "git status");
    }

    #[test]
    fn truncates_something_enormous_rather_than_losing_it() {
        let (_d, h) = history();
        h.record(entry(&"x".repeat(MAX_COMMAND * 2))).unwrap();
        assert_eq!(h.all().unwrap()[0].command.chars().count(), MAX_COMMAND);
    }

    #[test]
    fn one_corrupt_line_does_not_cost_the_whole_history() {
        // A half-written record from a machine that lost power mid-append.
        let (d, h) = history();
        h.record(entry("first")).unwrap();
        let path = d.path().join("history.jsonl");
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str("{\"command\": \"half-writ\n");
        std::fs::write(&path, raw).unwrap();
        h.record(entry("second")).unwrap();

        let all = h.all().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].command, "second");
    }

    #[test]
    fn forgetting_removes_every_run_of_it() {
        // Someone removing a line with a password in it means every time they
        // ran it, not the one they are looking at.
        let (_d, h) = history();
        h.record(entry("curl -H 'Authorization: Bearer sekrit'")).unwrap();
        h.record(entry("ls")).unwrap();
        h.record(entry("curl -H 'Authorization: Bearer sekrit'")).unwrap();

        assert_eq!(h.forget("curl -H 'Authorization: Bearer sekrit'").unwrap(), 2);
        assert_eq!(h.all().unwrap().len(), 1);
        assert_eq!(h.all().unwrap()[0].command, "ls");
    }

    #[test]
    fn forgetting_something_that_is_not_there_changes_nothing() {
        let (_d, h) = history();
        h.record(entry("ls")).unwrap();
        assert_eq!(h.forget("never ran").unwrap(), 0);
        assert_eq!(h.all().unwrap().len(), 1);
    }

    #[test]
    fn clearing_empties_it_and_clearing_again_is_fine() {
        let (_d, h) = history();
        h.record(entry("ls")).unwrap();
        h.clear().unwrap();
        assert_eq!(h.all().unwrap(), vec![]);
        h.clear().unwrap();
    }

    #[test]
    fn the_history_stays_bounded() {
        // Small, but read in full on every search — an unbounded file would
        // make the search box stutter on a machine that has run for years.
        let (_d, h) = history();
        let path = h.path.clone();

        let mut raw = String::new();
        for i in 0..MAX_ENTRIES + 10 {
            let mut e = entry(&format!("cmd{i}"));
            e.at = NOW + i as i64;
            raw.push_str(&serde_json::to_string(&e).unwrap());
            raw.push('\n');
        }
        std::fs::write(&path, raw).unwrap();

        h.record(entry("the one that tips it")).unwrap();
        let all = h.all().unwrap();
        assert!(all.len() <= MAX_ENTRIES, "{} entries", all.len());
        // The newest survive, including the one just added.
        assert_eq!(all.last().unwrap().command, "the one that tips it");
    }

    #[test]
    fn a_remote_command_is_marked_with_where_it_ran() {
        // A history that showed `rm -rf` run here and run on production
        // identically would be one you could not re-run anything from.
        let (_d, h) = history();
        let mut remote = entry("rm -rf /var/tmp/cache");
        remote.host = Some("prod-01".into());
        h.record(remote).unwrap();

        assert_eq!(h.all().unwrap()[0].host.as_deref(), Some("prod-01"));
    }
}
