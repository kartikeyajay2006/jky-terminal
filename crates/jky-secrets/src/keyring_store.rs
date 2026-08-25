use keyring::Entry;

use crate::{Secret, SecretError, SecretStore};

/// Secret storage backed by the operating system's own credential store:
/// Secret Service / GNOME Keyring on Linux, Keychain on macOS, Credential
/// Manager on Windows. The OS owns the encryption and the unlock policy.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self { service: service.to_string() }
    }

    fn entry(&self, key: &str) -> Result<Entry, SecretError> {
        Entry::new(&self.service, key).map_err(|e| SecretError::Backend(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError> {
        self.entry(key)?
            .set_password(value.expose())
            .map_err(|e| SecretError::Backend(e.to_string()))
    }

    fn get(&self, key: &str) -> Result<Secret<String>, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Secret::new(v)),
            Err(keyring::Error::NoEntry) => Err(SecretError::NotFound(key.to_string())),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }

    fn has(&self, key: &str) -> Result<bool, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }

    fn delete(&self, key: &str) -> Result<(), SecretError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Secret, SecretStore};

    const TEST_SERVICE: &str = "dev.jky.terminal.test";

    #[test]
    #[ignore = "touches the real OS keychain; run locally with --ignored"]
    fn round_trips_through_the_os_keychain() {
        let store = KeyringStore::new(TEST_SERVICE);
        let key = "test-round-trip";
        let _ = store.delete(key);

        store.set(key, Secret::new("value-1".to_string())).unwrap();
        assert!(store.has(key).unwrap());
        assert_eq!(store.get(key).unwrap().expose(), "value-1");

        store.delete(key).unwrap();
        assert!(!store.has(key).unwrap());
    }

    #[test]
    #[ignore = "touches the real OS keychain; run locally with --ignored"]
    fn has_returns_false_for_an_absent_entry_rather_than_erroring() {
        let store = KeyringStore::new(TEST_SERVICE);
        assert!(!store.has("definitely-not-present").unwrap());
    }
}
