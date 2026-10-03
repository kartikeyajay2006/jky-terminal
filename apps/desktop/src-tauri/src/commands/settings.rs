use std::path::Path;

use jky_memory::Memory;
use jky_pty::{expand_tilde, home_dir};
use jky_secrets::ProviderId;
use jky_settings::{Privacy, SettingsStore};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn set_selected_model_logic(
    store: &SettingsStore,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    let id = ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    if model.trim().is_empty() {
        return Err("model id cannot be empty".to_string());
    }
    store
        .set_selected_model(id.as_key(), model.trim())
        .map_err(|e| e.to_string())
}

pub(crate) fn set_active_provider_logic(
    store: &SettingsStore,
    provider: &str,
) -> Result<(), String> {
    let id = ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    store.set_active_provider(id.as_key()).map_err(|e| e.to_string())
}

/// The project folder: where new terminals start, and the only folder the
/// assistant's file tools may read.
///
/// Refused when it does not exist. Stored anyway, it would do nothing —
/// terminals would fall back to home and the assistant would refuse its
/// tools — and both would happen silently.
pub(crate) fn set_terminal_start_dir_logic(
    store: &SettingsStore,
    dir: &str,
) -> Result<(), String> {
    let wanted = dir.trim();
    if !wanted.is_empty() && !expand_tilde(wanted, home_dir().as_deref()).is_dir() {
        return Err(format!("{wanted} does not exist, or is not a folder"));
    }
    store.set_terminal_start_dir(wanted).map_err(|e| e.to_string())
}

/// What the Privacy panel shows.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PrivacyView {
    pub keep_history: bool,
    pub history_days: u32,
    pub keep_scrollback: bool,
    pub project_dir: Option<String>,
}

pub(crate) fn privacy_logic(store: &SettingsStore) -> Result<PrivacyView, String> {
    let privacy = store.privacy().map_err(|e| e.to_string())?;
    Ok(PrivacyView {
        keep_history: privacy.keep_history,
        history_days: privacy.history_days,
        keep_scrollback: privacy.keep_scrollback,
        project_dir: store.terminal_start_dir().map_err(|e| e.to_string())?,
    })
}

/// The longest retention window worth offering: ten years.
const MAX_HISTORY_DAYS: u32 = 3_650;

/// Save the privacy settings and apply them at once: turning scrollback off
/// deletes what was saved, and a retention window prunes history now rather
/// than at the next search.
pub(crate) fn set_privacy_logic(
    store: &SettingsStore,
    history: &Memory,
    config_dir: &Path,
    privacy: &Privacy,
    now: i64,
) -> Result<(), String> {
    if privacy.history_days > MAX_HISTORY_DAYS {
        return Err(format!("history can be kept for at most {MAX_HISTORY_DAYS} days"));
    }
    store.set_privacy(privacy).map_err(|e| e.to_string())?;
    if !privacy.keep_scrollback {
        jky_store::scrollback::prune(config_dir, &[]).map_err(|e| e.to_string())?;
    }
    if let Some(cutoff) = super::history::cutoff(privacy, now) {
        history.prune_older_than(cutoff).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- IPC surface ------------------------------------------------------------

/// The summon shortcut, and whether this running JKY holds it.
#[tauri::command]
pub fn settings_summon(state: State<'_, AppState>) -> crate::summon::SummonView {
    state.summon.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Choose the summon shortcut — or `none` — and hold it at once.
///
/// Checked by the same rules the installers apply, stored in settings, and
/// registered in place of the old one. Stored even when this desktop will
/// not let JKY hold it, because the installer's OS-level binding, or the next
/// session, may; the reply says which.
#[tauri::command]
pub fn settings_set_summon(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<crate::summon::SummonView, String> {
    let wanted = crate::summon::parse_request(&shortcut)?;
    let mut current = state.summon.lock().unwrap_or_else(|p| p.into_inner());
    let held = current.shortcut.clone().filter(|_| current.active);
    let view = crate::summon::register(&app, held.as_deref(), wanted.as_deref());
    state.settings.set_summon_shortcut(wanted.as_deref()).map_err(|e| e.to_string())?;
    // The desktop's own binding, where the installer made one, follows.
    crate::summon::sync_desktop(wanted.as_deref());
    *current = view.clone();
    Ok(view)
}

#[tauri::command]
pub fn settings_set_selected_model(
    state: State<'_, AppState>,
    provider: String,
    model: String,
) -> Result<(), String> {
    set_selected_model_logic(state.settings.as_ref(), &provider, &model)
}

#[tauri::command]
pub fn settings_set_active_provider(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    set_active_provider_logic(state.settings.as_ref(), &provider)
}

/// What is kept about what you do, and the project folder.
#[tauri::command]
pub fn settings_privacy(state: State<'_, AppState>) -> Result<PrivacyView, String> {
    privacy_logic(state.settings.as_ref())
}

#[tauri::command]
pub fn settings_set_privacy(
    state: State<'_, AppState>,
    keep_history: bool,
    history_days: u32,
    keep_scrollback: bool,
    now: i64,
) -> Result<(), String> {
    let privacy = Privacy { keep_history, history_days, keep_scrollback };
    set_privacy_logic(state.settings.as_ref(), state.memory.as_ref(), &state.config_dir, &privacy, now)
}

#[tauri::command]
pub fn settings_set_terminal_start_dir(
    state: State<'_, AppState>,
    dir: String,
) -> Result<(), String> {
    set_terminal_start_dir_logic(state.settings.as_ref(), &dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, SettingsStore) {
        let d = TempDir::new().unwrap();
        let s = SettingsStore::new(d.path().join("settings.json"));
        (d, s)
    }

    #[test]
    fn selecting_a_model_persists_it() {
        let (_d, s) = store();
        set_selected_model_logic(&s, "anthropic", "claude-opus-5").unwrap();
        assert_eq!(s.selected_model("anthropic").unwrap().as_deref(), Some("claude-opus-5"));
    }

    #[test]
    fn a_custom_model_id_is_accepted_so_new_releases_are_usable() {
        // Provider catalogues go stale the moment a vendor ships something new.
        // The UI must not block a model just because this build predates it.
        let (_d, s) = store();
        set_selected_model_logic(&s, "openai", "gpt-6-turbo-unreleased").unwrap();
        assert_eq!(
            s.selected_model("openai").unwrap().as_deref(),
            Some("gpt-6-turbo-unreleased")
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed_from_a_model_id() {
        let (_d, s) = store();
        set_selected_model_logic(&s, "groq", "  llama-3.1-8b-instant  ").unwrap();
        assert_eq!(
            s.selected_model("groq").unwrap().as_deref(),
            Some("llama-3.1-8b-instant")
        );
    }

    #[test]
    fn an_empty_model_id_is_rejected() {
        let (_d, s) = store();
        assert!(set_selected_model_logic(&s, "anthropic", "   ").is_err());
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let (_d, s) = store();
        assert!(set_selected_model_logic(&s, "skynet", "gpt-4o").is_err());
    }

    #[test]
    fn a_project_folder_persists() {
        let (d, s) = store();
        let folder = d.path().join("projects");
        std::fs::create_dir(&folder).unwrap();
        set_terminal_start_dir_logic(&s, &folder.to_string_lossy()).unwrap();
        assert_eq!(s.terminal_start_dir().unwrap(), Some(folder.to_string_lossy().into_owned()));
    }

    #[test]
    fn a_project_folder_that_does_not_exist_is_refused_rather_than_stored() {
        // Stored, it would do nothing: new terminals fall back to home, and
        // the assistant's tools refuse — both silently.
        let (d, s) = store();
        let err = set_terminal_start_dir_logic(&s, &d.path().join("nope").to_string_lossy()).unwrap_err();
        assert!(err.contains("does not exist"), "{err}");
        assert_eq!(s.terminal_start_dir().unwrap(), None);
    }

    #[test]
    fn clearing_the_start_directory_returns_new_terminals_to_home() {
        let (d, s) = store();
        set_terminal_start_dir_logic(&s, &d.path().to_string_lossy()).unwrap();
        set_terminal_start_dir_logic(&s, "").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap(), None);
    }

    #[test]
    fn privacy_is_reported_with_the_project_folder() {
        let (d, s) = store();
        set_terminal_start_dir_logic(&s, &d.path().to_string_lossy()).unwrap();
        let view = privacy_logic(&s).unwrap();
        assert!(view.keep_history && view.keep_scrollback);
        assert_eq!(view.project_dir, Some(d.path().to_string_lossy().into_owned()));
    }

    #[test]
    fn turning_scrollback_off_deletes_what_was_saved() {
        let (d, s) = store();
        let history = Memory::in_memory().unwrap();
        jky_store::scrollback::save(d.path(), "tab-1", "saved output").unwrap();
        let off = Privacy { keep_scrollback: false, ..Privacy::default() };
        set_privacy_logic(&s, &history, d.path(), &off, 0).unwrap();
        assert_eq!(jky_store::scrollback::load(d.path(), "tab-1").unwrap(), "");
        assert!(!s.privacy().unwrap().keep_scrollback);
    }

    #[test]
    fn setting_a_retention_window_prunes_history_at_once() {
        let (d, s) = store();
        let history = Memory::in_memory().unwrap();
        let now = 1_800_000_000_000_i64;
        for (cmd, age_days) in [("ancient", 400), ("recent", 2)] {
            history
                .record(jky_memory::Run {
                    command: cmd.into(),
                    cwd: "/".into(),
                    at: now - age_days * 86_400_000,
                    session: "p".into(),
                    ..Default::default()
                })
                .unwrap();
        }
        let year = Privacy { history_days: 365, ..Privacy::default() };
        set_privacy_logic(&s, &history, d.path(), &year, now).unwrap();
        let left: Vec<String> = history.all().unwrap().into_iter().map(|r| r.command).collect();
        assert_eq!(left, ["recent"]);
    }

    #[test]
    fn an_absurd_retention_window_is_refused() {
        let (d, s) = store();
        let history = Memory::in_memory().unwrap();
        let silly = Privacy { history_days: 100_000, ..Privacy::default() };
        assert!(set_privacy_logic(&s, &history, d.path(), &silly, 0).is_err());
    }

    #[test]
    fn the_active_provider_persists() {
        let (_d, s) = store();
        set_active_provider_logic(&s, "google").unwrap();
        assert_eq!(s.load().unwrap().active_provider.as_deref(), Some("google"));
    }
}
