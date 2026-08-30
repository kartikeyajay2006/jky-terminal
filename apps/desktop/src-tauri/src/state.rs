use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use jky_audit::AuditLog;
use jky_pty::PtyRegistry;
use jky_secrets::{KeyringStore, SecretStore};
use jky_settings::SettingsStore;
use jky_store::Store;

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

/// A tool call the model asked for, held until the user decides.
///
/// The call id is the map key, so it is not repeated here.
#[derive(Debug, Clone)]
pub struct PendingTool {
    pub name: String,
    pub command: String,
}

/// One user turn in flight.
///
/// Held across the gap where a gated tool waits for a decision: without it,
/// approving a command would have nothing to send the result back to.
pub struct TurnState {
    pub provider: String,
    pub messages: Vec<jky_ai::Message>,
    /// Blocks the assistant produced this round.
    pub assistant_blocks: Vec<jky_ai::ContentBlock>,
    /// Results gathered so far this round.
    pub results: Vec<jky_ai::ContentBlock>,
    /// Gated calls not yet approved or declined, by call id.
    pub awaiting: HashMap<String, PendingTool>,
    pub round: usize,
}

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    pub settings: Arc<SettingsStore>,
    /// The dashboard's notes, todos, events and reminders.
    pub store: Arc<Store>,
    pub ptys: Arc<PtyRegistry>,
    /// Kept so the pty layer can place its shell launchers under it.
    pub config_dir: PathBuf,
    pub audit: Arc<AuditLog>,
    /// The turn currently in flight, if any. One at a time in v0.1.
    pub turn: Arc<Mutex<Option<TurnState>>>,
    /// Set when the user asks to stop. Checked between stream chunks and
    /// between rounds, so a long answer stops rather than being hidden.
    pub cancelled: Arc<AtomicBool>,
    /// One client for every app that fetches, so connections are pooled
    /// rather than a fresh TLS handshake being paid on each panel refresh.
    pub http: reqwest::Client,
}

impl AppState {
    /// `config_dir` is the OS-appropriate per-user application config directory,
    /// resolved by Tauri at startup. Taking it as an argument rather than
    /// discovering it here keeps this constructible in tests.
    pub fn new(config_dir: &Path) -> Self {
        Self {
            secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)),
            settings: Arc::new(SettingsStore::new(config_dir.join("settings.json"))),
            store: Arc::new(Store::new(config_dir)),
            ptys: Arc::new(PtyRegistry::new()),
            config_dir: config_dir.to_path_buf(),
            audit: Arc::new(AuditLog::new(config_dir.join("audit.jsonl"))),
            turn: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
            http: reqwest::Client::new(),
        }
    }
}
