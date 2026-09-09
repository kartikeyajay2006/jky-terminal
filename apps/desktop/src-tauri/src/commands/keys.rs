use jky_keys::{Binding, Conflict, Keymap};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// The whole keyboard, in one answer.
///
/// Bindings and collisions together rather than in two calls: a panel that
/// fetched them separately could draw a table that disagrees with the warning
/// above it.
#[derive(Debug, Serialize)]
pub struct Keyboard {
    pub bindings: Vec<Binding>,
    pub conflicts: Vec<Conflict>,
}

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn keyboard_logic(keys: &Keymap) -> Result<Keyboard, String> {
    let bindings = keys.bindings().map_err(|e| e.to_string())?;
    let conflicts = keys.conflicts().map_err(|e| e.to_string())?;
    Ok(Keyboard { bindings, conflicts })
}

pub(crate) fn bind_logic(keys: &Keymap, action: &str, chord: &str) -> Result<Keyboard, String> {
    keys.bind(action, chord).map_err(|e| e.to_string())?;
    keyboard_logic(keys)
}

pub(crate) fn reset_logic(keys: &Keymap, action: &str) -> Result<Keyboard, String> {
    keys.reset(action).map_err(|e| e.to_string())?;
    keyboard_logic(keys)
}

pub(crate) fn reset_all_logic(keys: &Keymap) -> Result<Keyboard, String> {
    keys.reset_all().map_err(|e| e.to_string())?;
    keyboard_logic(keys)
}

// --- IPC surface ------------------------------------------------------------

#[tauri::command]
pub fn keys_list(state: State<'_, AppState>) -> Result<Keyboard, String> {
    keyboard_logic(state.keys.as_ref())
}

#[tauri::command]
pub fn keys_bind(
    state: State<'_, AppState>,
    action: String,
    chord: String,
) -> Result<Keyboard, String> {
    bind_logic(state.keys.as_ref(), &action, &chord)
}

#[tauri::command]
pub fn keys_reset(state: State<'_, AppState>, action: String) -> Result<Keyboard, String> {
    reset_logic(state.keys.as_ref(), &action)
}

#[tauri::command]
pub fn keys_reset_all(state: State<'_, AppState>) -> Result<Keyboard, String> {
    reset_all_logic(state.keys.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn keymap() -> (TempDir, Keymap) {
        let d = TempDir::new().unwrap();
        let k = Keymap::new(d.path().join("keymap.json"));
        (d, k)
    }

    fn chord_of(board: &Keyboard, action: &str) -> String {
        board.bindings.iter().find(|b| b.action == action).unwrap().chord.clone()
    }

    #[test]
    fn lists_every_action_on_a_first_run() {
        let (_d, k) = keymap();
        let board = keyboard_logic(&k).unwrap();
        assert_eq!(board.bindings.len(), jky_keys::ACTIONS.len());
        assert!(board.conflicts.is_empty());
        assert!(board.bindings.iter().all(|b| !b.custom));
    }

    #[test]
    fn a_rebind_comes_back_in_the_same_answer() {
        // So the panel never has to guess what it now looks like.
        let (_d, k) = keymap();
        let board = bind_logic(&k, "pane-split-right", "Ctrl+Alt+2").unwrap();
        assert_eq!(chord_of(&board, "pane-split-right"), "Ctrl+Alt+2");
    }

    #[test]
    fn a_refused_rebind_says_which_shortcut_is_in_the_way() {
        let (_d, k) = keymap();
        let message = bind_logic(&k, "pane-split-right", "Ctrl+T").unwrap_err();
        assert!(message.contains("Ctrl+T"), "{message}");
        assert!(message.contains("New terminal tab"), "{message}");
    }

    #[test]
    fn a_refused_rebind_changes_nothing() {
        let (_d, k) = keymap();
        let _ = bind_logic(&k, "pane-split-right", "Ctrl+T");
        assert_eq!(chord_of(&keyboard_logic(&k).unwrap(), "pane-split-right"), "Ctrl+Shift+D");
    }

    #[test]
    fn an_unmodified_key_is_refused_with_the_reason() {
        let (_d, k) = keymap();
        let message = bind_logic(&k, "tab-new", "N").unwrap_err();
        assert!(message.contains("shell"), "{message}");
    }

    #[test]
    fn resetting_one_leaves_the_others() {
        let (_d, k) = keymap();
        bind_logic(&k, "tab-new", "Ctrl+Alt+N").unwrap();
        bind_logic(&k, "tab-close", "Ctrl+Alt+Q").unwrap();

        let board = reset_logic(&k, "tab-new").unwrap();
        assert_eq!(chord_of(&board, "tab-new"), "Ctrl+T");
        assert_eq!(chord_of(&board, "tab-close"), "Ctrl+Alt+Q");
    }

    #[test]
    fn resetting_everything_clears_every_change() {
        let (_d, k) = keymap();
        bind_logic(&k, "tab-new", "Ctrl+Alt+N").unwrap();
        let board = reset_all_logic(&k).unwrap();
        assert!(board.bindings.iter().all(|b| !b.custom));
    }
}
