use jky_complete::{complete, Completions, Context};
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

/// How many commands from the history are worth offering as whole lines.
///
/// The most recent few hundred. Reading a hundred thousand of them on every
/// keystroke would make the one feature that has to feel instant the slowest
/// thing in the app.
const HISTORY_DEPTH: usize = 400;

pub(crate) fn suggest_logic(
    history: &jky_history::History,
    line: String,
    cursor: usize,
    cwd: String,
    limit: usize,
) -> Completions {
    // Most recent first, which is the order the engine offers them in.
    let recent: Vec<String> = history
        .all()
        .unwrap_or_default()
        .into_iter()
        .rev()
        .take(HISTORY_DEPTH)
        .map(|e| e.command)
        .collect();

    complete(&Context {
        line,
        cursor,
        cwd,
        // Read here rather than taken from the window: the window has no way
        // to know either, and a completion that trusted it for a path would
        // be a path the renderer chose.
        home: std::env::var("HOME").ok().or_else(|| std::env::var("USERPROFILE").ok()),
        path_var: std::env::var("PATH").ok(),
        history: recent,
        limit,
    })
}

// --- IPC surface ------------------------------------------------------------

/// What could come next on a command line.
///
/// Reads directories, `PATH`, and a repository's refs. It runs nothing: not
/// the command being completed, not `git`, not `--help`. A completion engine
/// that executed anything to find out what to offer would execute it on every
/// keystroke, at a prompt where the person has not decided yet.
#[tauri::command]
pub fn complete_suggest(
    state: State<'_, AppState>,
    line: String,
    cursor: usize,
    cwd: String,
    limit: usize,
) -> Result<Completions, String> {
    Ok(suggest_logic(state.history.as_ref(), line, cursor, cwd, limit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_history::{Entry, History};
    use tempfile::TempDir;

    fn history(dir: &TempDir) -> History {
        History::new(dir.path().join("history.jsonl"))
    }

    #[test]
    fn completes_a_path_in_the_directory_the_shell_reported() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("notes.md"), "").unwrap();
        let cwd = d.path().to_string_lossy().to_string();

        let found = suggest_logic(&history(&d), "cat no".into(), 6, cwd, 0);
        assert_eq!(found.items[0].value, "notes.md");
        assert_eq!(found.word, "no");
    }

    #[test]
    fn offers_a_whole_line_that_was_run_before() {
        let d = TempDir::new().unwrap();
        let h = history(&d);
        h.record(Entry {
            command: "docker run --rm -it node:20 bash".into(),
            cwd: "/".into(),
            code: 0,
            at: 1,
            session: "pane-1".into(),
            host: None,
        })
        .unwrap();

        let found = suggest_logic(&h, "docker r".into(), 8, d.path().to_string_lossy().into(), 0);
        assert!(
            found.items.iter().any(|s| s.value == "docker run --rm -it node:20 bash"),
            "{:?}",
            found.items
        );
    }

    #[test]
    fn an_unreadable_history_costs_the_history_source_and_nothing_else() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("notes.md"), "").unwrap();
        let cwd = d.path().to_string_lossy().to_string();
        // A History pointed at a directory cannot be read as a file.
        let broken = History::new(d.path());

        let found = suggest_logic(&broken, "cat no".into(), 6, cwd, 0);
        assert_eq!(found.items[0].value, "notes.md");
    }

    #[test]
    fn a_cursor_past_the_line_is_clamped_rather_than_panicking() {
        // The window measures in UTF-16 and Rust in bytes, so this has to be
        // safe rather than merely unlikely.
        let d = TempDir::new().unwrap();
        let found = suggest_logic(&history(&d), "ls".into(), 999, "/".into(), 0);
        assert_eq!(found.word, "ls");
    }
}
