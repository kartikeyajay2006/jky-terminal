use std::collections::HashMap;
use std::sync::RwLock;

use crate::{Secret, SecretError, SecretStore};

/// In-process secret storage.
///
/// Used by unit tests and by the browser development build, where no OS
/// keychain exists. Values live only in memory and vanish on exit — that is
/// the point. Never select this implementation in a release desktop build.
#[derive(Default)]
pub struct MemoryStore {
    inner: RwLock<HashMap<String, String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_err(e: impl std::fmt::Display) -> SecretError {
        SecretError::Backend(format!("lock poisoned: {e}"))
    }
}

impl SecretStore for MemoryStore {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError> {
        let mut guard = self.inner.write().map_err(Self::lock_err)?;
        guard.insert(key.to_string(), value.expose().clone());
        Ok(())
    }

    fn get(&self, key: &str) -> Result<Secret<String>, SecretError> {
        let guard = self.inner.read().map_err(Self::lock_err)?;
        guard
            .get(key)
            .map(|v| Secret::new(v.clone()))
            .ok_or_else(|| SecretError::NotFound(key.to_string()))
    }

    fn has(&self, key: &str) -> Result<bool, SecretError> {
        let guard = self.inner.read().map_err(Self::lock_err)?;
        Ok(guard.contains_key(key))
    }

    fn delete(&self, key: &str) -> Result<(), SecretError> {
        let mut guard = self.inner.write().map_err(Self::lock_err)?;
        guard.remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Secret, SecretError, SecretStore};

    #[test]
    fn set_then_get_round_trips() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        assert_eq!(store.get("anthropic").unwrap().expose(), "value-1");
    }

    #[test]
    fn has_reports_presence_without_revealing_value() {
        let store = MemoryStore::new();
        assert!(!store.has("anthropic").unwrap());
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        assert!(store.has("anthropic").unwrap());
    }

    #[test]
    fn get_missing_key_returns_not_found() {
        let store = MemoryStore::new();
        assert!(matches!(store.get("nope"), Err(SecretError::NotFound(_))));
    }

    #[test]
    fn set_overwrites_an_existing_value() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("old".to_string())).unwrap();
        store.set("anthropic", Secret::new("new".to_string())).unwrap();
        assert_eq!(store.get("anthropic").unwrap().expose(), "new");
    }

    #[test]
    fn delete_removes_the_value() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        store.delete("anthropic").unwrap();
        assert!(!store.has("anthropic").unwrap());
    }

    #[test]
    fn delete_is_idempotent() {
        let store = MemoryStore::new();
        assert!(store.delete("never-existed").is_ok());
    }

    #[test]
    fn error_messages_name_the_entry_but_never_its_value() {
        // Store errors get logged and shown to users, so they may say which
        // entry failed and must never carry what that entry contained.
        assert_eq!(
            SecretError::NotFound("anthropic".into()).to_string(),
            "no secret stored for 'anthropic'"
        );
        assert_eq!(
            SecretError::InvalidFormat("anthropic".into()).to_string(),
            "invalid key format for provider 'anthropic'"
        );
    }
}
