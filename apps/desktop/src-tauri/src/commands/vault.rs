use jky_secrets::{ProviderId, Secret, SecretStore};
use jky_settings::SettingsStore;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize, PartialEq)]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    pub note: String,
}

/// Everything the settings UI needs about one provider, in a single payload.
///
/// Note what is absent: the key itself. `connected` says whether one is stored,
/// and that is the most the frontend is ever told.
#[derive(Debug, Serialize, PartialEq)]
pub struct ProviderStatus {
    pub id: String,
    pub display_name: String,
    pub tagline: String,
    pub console_url: String,
    pub requires_key: bool,
    /// Accepted key prefixes, so the UI can show the expected shape.
    /// Empty means the provider publishes no stable prefix.
    pub key_prefixes: Vec<String>,
    pub connected: bool,
    pub models: Vec<ModelOption>,
    pub default_model: String,
    /// The user's explicit choice, if they have made one.
    pub selected_model: Option<String>,
}

fn resolve(provider: &str) -> Result<ProviderId, String> {
    ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))
}

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn set_secret_logic(
    store: &dyn SecretStore,
    provider: &str,
    value: String,
) -> Result<(), String> {
    let id = resolve(provider)?;
    id.validate(&value).map_err(|e| e.to_string())?;
    store
        .set(id.as_key(), Secret::new(value))
        .map_err(|e| e.to_string())
}

pub(crate) fn has_secret_logic(store: &dyn SecretStore, provider: &str) -> Result<bool, String> {
    let id = resolve(provider)?;
    store.has(id.as_key()).map_err(|e| e.to_string())
}

pub(crate) fn delete_secret_logic(store: &dyn SecretStore, provider: &str) -> Result<(), String> {
    let id = resolve(provider)?;
    store.delete(id.as_key()).map_err(|e| e.to_string())
}

pub(crate) fn list_providers_logic(
    store: &dyn SecretStore,
    settings: &SettingsStore,
) -> Result<Vec<ProviderStatus>, String> {
    ProviderId::all()
        .iter()
        .map(|id| {
            Ok(ProviderStatus {
                id: id.as_key().to_string(),
                display_name: id.display_name().to_string(),
                tagline: id.tagline().to_string(),
                console_url: id.console_url().to_string(),
                requires_key: id.requires_key(),
                key_prefixes: id.key_prefixes().iter().map(|p| p.to_string()).collect(),
                // Strictly "a key is stored". A local runtime has none and
                // reports false; `requires_key` is what tells the UI that this
                // is expected rather than unconfigured. Keeping the data
                // literal means the UI decides presentation, not the backend.
                connected: store.has(id.as_key()).map_err(|e| e.to_string())?,
                models: id
                    .models()
                    .iter()
                    .map(|m| ModelOption {
                        id: m.id.to_string(),
                        label: m.label.to_string(),
                        note: m.note.to_string(),
                    })
                    .collect(),
                default_model: id.default_model().to_string(),
                selected_model: settings
                    .selected_model(id.as_key())
                    .map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

// --- IPC surface ------------------------------------------------------------
//
// SECURITY: there is deliberately no command that returns a stored secret.
// Do not add one. `apps/desktop/src-tauri/tests/security.rs` fails the build
// if a getter-shaped command appears here.

#[tauri::command]
pub fn vault_set_secret(
    state: State<'_, AppState>,
    provider: String,
    value: String,
) -> Result<(), String> {
    set_secret_logic(state.secrets.as_ref(), &provider, value)
}

#[tauri::command]
pub fn vault_has_secret(state: State<'_, AppState>, provider: String) -> Result<bool, String> {
    has_secret_logic(state.secrets.as_ref(), &provider)
}

#[tauri::command]
pub fn vault_delete_secret(state: State<'_, AppState>, provider: String) -> Result<(), String> {
    delete_secret_logic(state.secrets.as_ref(), &provider)
}

#[tauri::command]
pub fn vault_list_providers(state: State<'_, AppState>) -> Result<Vec<ProviderStatus>, String> {
    list_providers_logic(state.secrets.as_ref(), state.settings.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_secrets::MemoryStore;
    use tempfile::TempDir;

    fn fixtures() -> (TempDir, MemoryStore, SettingsStore) {
        let d = TempDir::new().unwrap();
        let settings = SettingsStore::new(d.path().join("settings.json"));
        (d, MemoryStore::new(), settings)
    }

    fn valid_key() -> String {
        format!("sk-ant-api03-{}", "x".repeat(40))
    }

    #[test]
    fn storing_a_valid_key_marks_the_provider_connected() {
        let (_d, store, settings) = fixtures();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();

        let statuses = list_providers_logic(&store, &settings).unwrap();
        let anthropic = statuses.iter().find(|s| s.id == "anthropic").unwrap();
        assert!(anthropic.connected);
        assert_eq!(anthropic.display_name, "Anthropic");
    }

    #[test]
    fn a_malformed_key_is_rejected_and_nothing_is_stored() {
        let (_d, store, _s) = fixtures();
        let result = set_secret_logic(&store, "anthropic", "not-a-key".to_string());

        assert!(result.is_err());
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let (_d, store, _s) = fixtures();
        assert!(set_secret_logic(&store, "skynet", valid_key()).is_err());
    }

    #[test]
    fn errors_returned_to_the_frontend_never_contain_key_material() {
        let (_d, store, _s) = fixtures();
        let leaky = format!("sk-wrong-LEAKCANARY{}", "x".repeat(40));
        let err = set_secret_logic(&store, "anthropic", leaky).unwrap_err();
        assert!(
            !err.contains("LEAKCANARY"),
            "IPC error string echoed key material to the frontend: {err}"
        );
    }

    #[test]
    fn deleting_a_provider_disconnects_it() {
        let (_d, store, _s) = fixtures();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();
        delete_secret_logic(&store, "anthropic").unwrap();
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn every_provider_is_listed_even_when_none_are_configured() {
        let (_d, store, settings) = fixtures();
        let statuses = list_providers_logic(&store, &settings).unwrap();
        assert_eq!(statuses.len(), ProviderId::all().len());
        assert!(statuses.len() >= 9, "expected the full provider catalogue");
    }

    #[test]
    fn connecting_one_provider_leaves_the_others_disconnected() {
        let (_d, store, settings) = fixtures();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();

        let statuses = list_providers_logic(&store, &settings).unwrap();
        assert!(statuses.iter().find(|s| s.id == "anthropic").unwrap().connected);
        assert!(!statuses.iter().find(|s| s.id == "openai").unwrap().connected);
    }

    #[test]
    fn a_local_provider_needs_no_key_and_holds_none() {
        let (_d, store, settings) = fixtures();
        let statuses = list_providers_logic(&store, &settings).unwrap();
        let ollama = statuses.iter().find(|s| s.id == "ollama").unwrap();
        assert!(!ollama.requires_key, "a local runtime needs no credential");
        assert!(!ollama.connected, "and therefore stores no key");
    }

    #[test]
    fn each_provider_carries_its_own_models_and_a_default_drawn_from_them() {
        let (_d, store, settings) = fixtures();
        for s in list_providers_logic(&store, &settings).unwrap() {
            assert!(!s.models.is_empty(), "{} has no models", s.id);
            assert!(
                s.models.iter().any(|m| m.id == s.default_model),
                "{} default model is not in its own list",
                s.id
            );
        }
    }

    #[test]
    fn a_selected_model_is_reported_back_and_others_stay_unset() {
        let (_d, store, settings) = fixtures();
        settings.set_selected_model("anthropic", "claude-opus-5").unwrap();

        let statuses = list_providers_logic(&store, &settings).unwrap();
        assert_eq!(
            statuses.iter().find(|s| s.id == "anthropic").unwrap().selected_model.as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(
            statuses.iter().find(|s| s.id == "openai").unwrap().selected_model,
            None
        );
    }

    #[test]
    fn no_provider_status_ever_carries_the_key_itself() {
        let (_d, store, settings) = fixtures();
        // The canary sits in the key's body, past the prefix. The payload
        // legitimately carries prefixes like "sk-ant-" so the UI can show the
        // expected shape, so asserting on the prefix would be a false positive.
        // What must never appear is anything unique to the stored value.
        let key = format!("sk-ant-api03-CANARY{}", "x".repeat(40));
        set_secret_logic(&store, "anthropic", key).unwrap();

        let json = serde_json::to_string(&list_providers_logic(&store, &settings).unwrap()).unwrap();
        assert!(
            !json.contains("CANARY"),
            "the provider list payload leaked key material to the frontend"
        );
        assert!(
            !json.contains("api03"),
            "the provider list payload leaked key material to the frontend"
        );
    }

    #[test]
    fn the_payload_carries_key_prefixes_so_the_ui_can_show_the_expected_shape() {
        let (_d, store, settings) = fixtures();
        let statuses = list_providers_logic(&store, &settings).unwrap();
        let anthropic = statuses.iter().find(|s| s.id == "anthropic").unwrap();
        assert_eq!(anthropic.key_prefixes, vec!["sk-ant-".to_string()]);

        // A provider with no published prefix reports an empty list rather
        // than a made-up one.
        let mistral = statuses.iter().find(|s| s.id == "mistral").unwrap();
        assert!(mistral.key_prefixes.is_empty());
    }
}
