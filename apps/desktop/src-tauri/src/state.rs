use std::path::{Path, PathBuf};
use std::sync::Arc;

use jky_pty::PtyRegistry;
use jky_secrets::{KeyringStore, SecretStore};
use jky_settings::SettingsStore;

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    pub settings: Arc<SettingsStore>,
    pub ptys: Arc<PtyRegistry>,
    /// Kept so the pty layer can place its shell launchers under it.
    pub config_dir: PathBuf,
}

impl AppState {
    /// `config_dir` is the OS-appropriate per-user application config directory,
    /// resolved by Tauri at startup. Taking it as an argument rather than
    /// discovering it here keeps this constructible in tests.
    pub fn new(config_dir: &Path) -> Self {
        Self {
            secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)),
            settings: Arc::new(SettingsStore::new(config_dir.join("settings.json"))),
            ptys: Arc::new(PtyRegistry::new()),
            config_dir: config_dir.to_path_buf(),
        }
    }
}
