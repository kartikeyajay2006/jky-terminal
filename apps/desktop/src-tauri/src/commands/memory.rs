//! Work Memory, for the window: search every run and what it printed, and
//! pin, annotate or forget one.
//!
//! Thin, like every command here — the store and its rules are `jky-memory`.
//! What is decided here is only the privacy settings' part: retention is
//! applied before every search, so nothing older than the window is shown.

use jky_memory::{Found, Memory, MemoryQuery};
use jky_settings::Privacy;
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn search_logic(
    memory: &Memory,
    privacy: &Privacy,
    query: &MemoryQuery,
    now: i64,
) -> Result<Vec<Found>, String> {
    if let Some(cutoff) = super::history::cutoff(privacy, now) {
        memory.prune_older_than(cutoff).map_err(|e| e.to_string())?;
    }
    memory.search(query).map_err(|e| e.to_string())
}

// --- IPC surface ------------------------------------------------------------

/// Runs matching words in their command, output, note or folder.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn memory_search(
    state: State<'_, AppState>,
    text: String,
    failed_only: bool,
    pinned_only: bool,
    cwd: Option<String>,
    session: Option<String>,
    limit: usize,
    now: i64,
) -> Result<Vec<Found>, String> {
    let privacy = state.settings.privacy().unwrap_or_default();
    let query = MemoryQuery { text, failed_only, pinned_only, cwd, session, limit };
    search_logic(state.memory.as_ref(), &privacy, &query, now)
}

/// Pin a run — it comes first, and retention spares it — or unpin it.
#[tauri::command]
pub fn memory_pin(state: State<'_, AppState>, id: i64, pinned: bool) -> Result<(), String> {
    state.memory.pin(id, pinned).map_err(|e| e.to_string())
}

/// Leave a note on a run. Redacted and bounded in `jky-memory`.
#[tauri::command]
pub fn memory_note(state: State<'_, AppState>, id: i64, note: String) -> Result<(), String> {
    state.memory.note(id, &note).map_err(|e| e.to_string())
}

/// Forget one run — the row being looked at, not every run of its command.
#[tauri::command]
pub fn memory_forget(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.memory.forget(id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_memory::Run;

    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;
    const KEEP: Privacy = Privacy { keep_history: true, history_days: 0, keep_scrollback: true };

    #[test]
    fn a_word_in_the_output_finds_the_run() {
        let m = Memory::in_memory().unwrap();
        m.record(Run { command: "cargo build".into(), at: NOW, output: Some("error: linker not found".into()), ..Default::default() })
            .unwrap();
        let found =
            search_logic(&m, &KEEP, &MemoryQuery { text: "linker".into(), ..Default::default() }, NOW).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].run.command, "cargo build");
    }

    #[test]
    fn nothing_older_than_the_retention_window_is_shown_unless_pinned() {
        let m = Memory::in_memory().unwrap();
        let old = m.record(Run { command: "old".into(), at: NOW - 40 * DAY, ..Default::default() }).unwrap().unwrap();
        m.record(Run { command: "older".into(), at: NOW - 50 * DAY, ..Default::default() }).unwrap();
        m.pin(old, true).unwrap();
        let month = Privacy { history_days: 30, ..KEEP };
        let found = search_logic(&m, &month, &MemoryQuery::default(), NOW).unwrap();
        let commands: Vec<&str> = found.iter().map(|f| f.run.command.as_str()).collect();
        assert_eq!(commands, ["old"], "a pinned run is kept; an unpinned old one is not");
    }
}
