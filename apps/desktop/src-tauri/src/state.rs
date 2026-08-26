use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use jky_audit::AuditLog;
use jky_pty::PtyRegistry;
use jky_secrets::{KeyringStore, SecretStore};
use jky_settings::SettingsStore;

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

/// A tool call the model asked for, held until the user decides.
///
/// The call id is the map key, so it is not repeated here.
#[derive(Debug, Clone)]
pub struct PendingTool {
    pub name: String,
    pub command: String,
}

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    pub settings: Arc<SettingsStore>,
    pub ptys: Arc<PtyRegistry>,
    /// Kept so the pty layer can place its shell launchers under it.
    pub config_dir: PathBuf,
    pub audit: Arc<AuditLog>,
    /// Tool calls the model asked for, held until the user approves or
    /// declines. Nothing in here has run.
    pub pending_tools: Arc<Mutex<HashMap<String, PendingTool>>>,
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
            audit: Arc::new(AuditLog::new(config_dir.join("audit.jsonl"))),
            pending_tools: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
