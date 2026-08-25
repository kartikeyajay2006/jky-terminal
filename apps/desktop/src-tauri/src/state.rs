use std::sync::Arc;

use jky_secrets::{KeyringStore, SecretStore};

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
}

impl AppState {
    pub fn new() -> Self {
        Self { secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)) }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
