//! Keeping what a terminal had on screen, across a restart.
//!
//! Three commands, and the reason each is safe is the same: the renderer
//! chooses a key, never a path. The key is validated against a narrow shape
//! in `jky_store::scrollback`, the directory is decided here, and the cap is
//! applied by the store — so the widest thing the window can do is save a
//! quarter of a megabyte of its own output under a name like `tab-3`.

use std::path::Path;

use jky_settings::Privacy;
use jky_store::scrollback;
use tauri::State;

use crate::state::AppState;

/// What a terminal had on screen last time, or "" if it is new.
#[tauri::command]
pub fn scrollback_load(state: State<'_, AppState>, key: String) -> Result<String, String> {
    scrollback::load(&state.config_dir, &key).map_err(|e| e.to_string())
}

/// Keep the tail of what a terminal has on screen.
#[tauri::command]
pub fn scrollback_save(
    state: State<'_, AppState>,
    key: String,
    text: String,
) -> Result<(), String> {
    let privacy = state.settings.privacy().unwrap_or_default();
    save_logic(&state.config_dir, &privacy, &key, &text)
}

/// Save — or, while keeping scrollback is off, make sure nothing is kept.
pub(crate) fn save_logic(config_dir: &Path, privacy: &Privacy, key: &str, text: &str) -> Result<(), String> {
    if !privacy.keep_scrollback {
        return scrollback::forget(config_dir, key).map_err(|e| e.to_string());
    }
    scrollback::save(config_dir, key, text).map_err(|e| e.to_string())
}

/// Forget one terminal. Closing a tab is the user removing it.
#[tauri::command]
pub fn scrollback_forget(state: State<'_, AppState>, key: String) -> Result<(), String> {
    scrollback::forget(&state.config_dir, &key).map_err(|e| e.to_string())
}

/// Drop every saved terminal that is not in `keys`.
///
/// Called at startup with the tabs that actually came back, so a tab closed
/// while the app was not running does not leave its output on disk for ever.
#[tauri::command]
pub fn scrollback_prune(state: State<'_, AppState>, keys: Vec<String>) -> Result<(), String> {
    scrollback::prune(&state.config_dir, &keys).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use jky_store::scrollback;

    #[test]
    fn the_key_shape_is_narrow_enough_to_be_a_path_component() {
        // The whole reason these commands can take a name from the window: a
        // key that would have to be escaped is refused instead.
        assert!(scrollback::is_safe_key("tab-1"));
        for bad in ["../etc", "a/b", "a\\b", "", "a.txt"] {
            assert!(!scrollback::is_safe_key(bad), "accepted {bad}");
        }
    }

    #[test]
    fn the_cap_is_the_stores_and_not_repeated_here() {
        // Repeating it would let the two drift, and the store is where the
        // reasoning about why it exists lives.
        assert_eq!(jky_store::SCROLLBACK_MAX_BYTES, scrollback::MAX_BYTES);
    }

    #[test]
    fn scrollback_is_not_kept_while_keeping_it_is_off_and_the_old_copy_goes() {
        let d = tempfile::TempDir::new().unwrap();
        let keep = jky_settings::Privacy::default();
        super::save_logic(d.path(), &keep, "tab-1", "before").unwrap();
        assert_eq!(scrollback::load(d.path(), "tab-1").unwrap(), "before");

        let off = jky_settings::Privacy { keep_scrollback: false, ..keep };
        super::save_logic(d.path(), &off, "tab-1", "after").unwrap();
        assert_eq!(scrollback::load(d.path(), "tab-1").unwrap(), "", "kept while off, or the old copy survived");
    }
}
