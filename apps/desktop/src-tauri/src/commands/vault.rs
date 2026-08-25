use jky_secrets::{ProviderId, Secret, SecretStore};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize, PartialEq)]
pub struct ProviderStatus {
    pub id: String,
    pub display_name: String,
    pub connected: bool,
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
) -> Result<Vec<ProviderStatus>, String> {
    ProviderId::all()
        .iter()
        .map(|id| {
            Ok(ProviderStatus {
                id: id.as_key().to_string(),
                display_name: id.display_name().to_string(),
                connected: store.has(id.as_key()).map_err(|e| e.to_string())?,
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
    list_providers_logic(state.secrets.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_secrets::MemoryStore;

    fn valid_key() -> String {
        format!("sk-ant-api03-{}", "x".repeat(40))
    }

    #[test]
    fn storing_a_valid_key_marks_the_provider_connected() {
        let store = MemoryStore::new();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();

        let statuses = list_providers_logic(&store).unwrap();
        let anthropic = statuses.iter().find(|s| s.id == "anthropic").unwrap();
        assert!(anthropic.connected);
        assert_eq!(anthropic.display_name, "Anthropic");
    }

    #[test]
    fn a_malformed_key_is_rejected_and_nothing_is_stored() {
        let store = MemoryStore::new();
        let result = set_secret_logic(&store, "anthropic", "not-a-key".to_string());

        assert!(result.is_err());
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let store = MemoryStore::new();
        assert!(set_secret_logic(&store, "skynet", valid_key()).is_err());
    }

    #[test]
    fn errors_returned_to_the_frontend_never_contain_key_material() {
        let store = MemoryStore::new();
        let leaky = format!("sk-wrong-LEAKCANARY{}", "x".repeat(40));
        let err = set_secret_logic(&store, "anthropic", leaky).unwrap_err();
        assert!(
            !err.contains("LEAKCANARY"),
            "IPC error string echoed key material to the frontend: {err}"
        );
    }

    #[test]
    fn deleting_a_provider_disconnects_it() {
        let store = MemoryStore::new();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();
        delete_secret_logic(&store, "anthropic").unwrap();
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn list_providers_reports_every_known_provider_even_when_unset() {
        let store = MemoryStore::new();
        let statuses = list_providers_logic(&store).unwrap();
        assert_eq!(statuses.len(), 1);
        assert!(!statuses[0].connected);
    }
}
