use jky_live::{run, source, Run, Source, SOURCES};
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn run_logic(id: &str) -> Result<Run, String> {
    let found = source(id).ok_or_else(|| jky_live::LiveError::Unknown(id.into()).to_string())?;
    run(found).map_err(|e| e.to_string())
}

// --- IPC surface ------------------------------------------------------------

/// Which commands can be kept live.
#[tauri::command]
pub fn live_sources() -> &'static [Source] {
    SOURCES
}

/// Run one of them again.
///
/// The window names an id and never a command line: the program and its
/// arguments are constants in `jky_live`, handed to the OS as a list with no
/// shell between. There is no path from a string in the renderer to a process.
#[tauri::command]
pub fn live_run(_state: State<'_, AppState>, source: String) -> Result<Run, String> {
    run_logic(&source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_source_runs() {
        // `df` is on every machine this builds on, runners included.
        let found = run_logic("df").expect("df runs");
        assert_eq!(found.code, 0);
        assert!(!found.text.is_empty());
    }

    #[test]
    fn anything_that_is_not_one_of_the_three_is_refused() {
        // The whole boundary, stated once more where the IPC surface is: a
        // command line arriving here is not a command line, it is a name that
        // does not match.
        for made_up in ["rm -rf /", "df -h", "sh", "", "DF"] {
            assert!(run_logic(made_up).is_err(), "{made_up}");
        }
    }

    #[test]
    fn the_list_the_window_is_given_is_the_list_that_runs() {
        for s in live_sources() {
            assert!(run_logic(s.id).is_ok() || s.id == "docker-ps", "{}", s.id);
        }
    }
}
