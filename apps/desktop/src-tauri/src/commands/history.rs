use jky_history::{Entry, History, Hit, Query};
use jky_settings::Privacy;
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

/// The cutoff, in milliseconds since the epoch, for a retention window.
pub(crate) fn cutoff(privacy: &Privacy, now: i64) -> Option<i64> {
    (privacy.history_days > 0).then(|| now - i64::from(privacy.history_days) * 86_400_000)
}

pub(crate) fn record_logic(history: &History, privacy: &Privacy, entry: Entry) -> Result<(), String> {
    // Off means off: decided here, whatever the window sends.
    if !privacy.keep_history {
        return Ok(());
    }
    match history.record(entry) {
        Ok(()) => Ok(()),
        // Pressing Enter at an empty prompt is not a failure anyone needs to
        // hear about. The window sends every completion the shell reports,
        // including that one.
        Err(jky_history::HistoryError::Empty) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn search_logic(
    history: &History,
    privacy: &Privacy,
    query: &Query,
    now: i64,
) -> Result<Vec<Hit>, String> {
    // Retention is applied before every search, so nothing older than the
    // window is ever shown — and the disk is pruned as a side effect of the
    // one moment someone looks.
    if let Some(cutoff) = cutoff(privacy, now) {
        history.prune_older_than(cutoff).map_err(|e| e.to_string())?;
    }
    history.search(query, now).map_err(|e| e.to_string())
}

// --- IPC surface ------------------------------------------------------------

/// Add one finished command.
///
/// Every field comes from the shell's own completion report rather than from
/// anything the window guessed: the command as it was run, the directory it
/// ran in, and the status it returned.
#[tauri::command]
pub fn history_record(
    state: State<'_, AppState>,
    command: String,
    cwd: String,
    code: i32,
    at: i64,
    session: String,
    host: Option<String>,
) -> Result<(), String> {
    let privacy = state.settings.privacy().unwrap_or_default();
    record_logic(state.history.as_ref(), &privacy, Entry { command, cwd, code, at, session, host })
}

#[tauri::command]
pub fn history_search(
    state: State<'_, AppState>,
    text: String,
    session: Option<String>,
    cwd: Option<String>,
    failed_only: bool,
    limit: usize,
    now: i64,
) -> Result<Vec<Hit>, String> {
    let query = Query { text, session, cwd, failed_only, limit };
    let privacy = state.settings.privacy().unwrap_or_default();
    search_logic(state.history.as_ref(), &privacy, &query, now)
}

/// Forget every run of one command.
#[tauri::command]
pub fn history_forget(state: State<'_, AppState>, command: String) -> Result<usize, String> {
    state.history.forget(&command).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.history.clear().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;
    const KEEP: Privacy = Privacy { keep_history: true, history_days: 0, keep_scrollback: true };

    fn history() -> (TempDir, History) {
        let d = TempDir::new().unwrap();
        let h = History::new(d.path().join("history.jsonl"));
        (d, h)
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
    fn a_recorded_command_is_searchable() {
        let (_d, h) = history();
        record_logic(&h, &KEEP, entry("docker ps")).unwrap();

        let hits =
            search_logic(&h, &KEEP, &Query { text: "dkrps".into(), ..Default::default() }, NOW).unwrap();
        assert_eq!(hits[0].entry.command, "docker ps");
    }

    #[test]
    fn an_empty_command_is_ignored_rather_than_reported() {
        // The window sends every completion the shell reports, and pressing
        // Enter at an empty prompt is one of them.
        let (_d, h) = history();
        record_logic(&h, &KEEP, entry("  ")).unwrap();
        assert!(h.all().unwrap().is_empty());
    }

    #[test]
    fn searching_an_empty_history_finds_nothing_rather_than_failing() {
        let (_d, h) = history();
        assert!(search_logic(&h, &KEEP, &Query::default(), NOW).unwrap().is_empty());
    }

    #[test]
    fn nothing_is_recorded_while_history_is_off() {
        // Enforced here, not in the window: a setting that is off stays off
        // whatever the renderer sends.
        let (_d, h) = history();
        let off = Privacy { keep_history: false, ..KEEP };
        record_logic(&h, &off, entry("ssh prod")).unwrap();
        assert!(h.all().unwrap().is_empty());
    }

    #[test]
    fn search_never_shows_what_is_older_than_the_retention_window() {
        let (_d, h) = history();
        let mut old = entry("old command");
        old.at = NOW - 40 * DAY;
        record_logic(&h, &KEEP, old).unwrap();
        record_logic(&h, &KEEP, entry("new command")).unwrap();

        let month = Privacy { history_days: 30, ..KEEP };
        let hits = search_logic(&h, &month, &Query::default(), NOW).unwrap();
        let found: Vec<&str> = hits.iter().map(|hit| hit.entry.command.as_str()).collect();
        assert_eq!(found, ["new command"]);
        assert_eq!(h.all().unwrap().len(), 1, "the old entry was not pruned from disk");
    }
}
