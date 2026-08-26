use jky_secrets::ProviderId;
use jky_settings::SettingsStore;
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

pub(crate) fn set_terminal_start_dir_logic(
    store: &SettingsStore,
    dir: &str,
) -> Result<(), String> {
    store.set_terminal_start_dir(dir).map_err(|e| e.to_string())
}

// --- IPC surface ------------------------------------------------------------

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
    fn a_terminal_start_directory_persists() {
        let (_d, s) = store();
        set_terminal_start_dir_logic(&s, "~/projects").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/projects"));
    }

    #[test]
    fn clearing_the_start_directory_returns_new_terminals_to_home() {
        let (_d, s) = store();
        set_terminal_start_dir_logic(&s, "~/projects").unwrap();
        set_terminal_start_dir_logic(&s, "").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap(), None);
    }

    #[test]
    fn the_active_provider_persists() {
        let (_d, s) = store();
        set_active_provider_logic(&s, "google").unwrap();
        assert_eq!(s.load().unwrap().active_provider.as_deref(), Some("google"));
    }
}
