use jky_history::{Entry, History, Hit, Query};
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn record_logic(history: &History, entry: Entry) -> Result<(), String> {
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
    query: &Query,
    now: i64,
) -> Result<Vec<Hit>, String> {
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
    record_logic(state.history.as_ref(), Entry { command, cwd, code, at, session, host })
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
    search_logic(state.history.as_ref(), &query, now)
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
        record_logic(&h, entry("docker ps")).unwrap();

        let hits =
            search_logic(&h, &Query { text: "dkrps".into(), ..Default::default() }, NOW).unwrap();
        assert_eq!(hits[0].entry.command, "docker ps");
    }

    #[test]
    fn an_empty_command_is_ignored_rather_than_reported() {
        // The window sends every completion the shell reports, and pressing
        // Enter at an empty prompt is one of them.
        let (_d, h) = history();
        record_logic(&h, entry("  ")).unwrap();
        assert!(h.all().unwrap().is_empty());
    }

    #[test]
    fn searching_an_empty_history_finds_nothing_rather_than_failing() {
        let (_d, h) = history();
        assert!(search_logic(&h, &Query::default(), NOW).unwrap().is_empty());
    }
}
