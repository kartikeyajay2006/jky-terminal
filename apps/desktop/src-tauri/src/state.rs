use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use jky_audit::{AuditLog, KeychainAnchor};
use jky_memory::Memory;
use jky_keys::Keymap;
use jky_remote::HostStore;
use jky_workspace::WorkspaceStore;
use jky_pty::PtyRegistry;
use jky_secrets::{KeyringStore, SecretStore};
use jky_settings::SettingsStore;
use jky_system::Sampler;
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

/// A device-flow sign-in waiting for the person to approve it.
///
/// The device code lives here rather than in the window, because it is the
/// credential that redeems the token: a compromised frontend holding it could
/// complete the exchange on its own. The window gets the short user code and
/// the address to type it at, which are useless without this.
#[derive(Debug, Clone)]
pub struct PendingDevice {
    pub client_id: String,
    pub device_code: String,
    /// How often GitHub permits polling; it may raise this mid-flow.
    pub interval_s: u64,
}

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    pub settings: Arc<SettingsStore>,
    /// What every shortcut is bound to. Beside `settings` rather than in it:
    /// a keymap is a table people hand-edit, and burying it inside a file of
    /// unrelated preferences would make that harder than it needs to be.
    pub keys: Arc<Keymap>,
    /// Work Memory: every command that has run, with its output tail,
    /// duration and git state, in SQLite. Shell history, completion and the
    /// History panel all read it. Retention and the on/off switch are the
    /// privacy settings', applied in the commands that write.
    pub memory: Arc<Memory>,
    /// The machines you have saved. Not the keychain: a hostname and an
    /// account name are not secrets, and the things that are never come near
    /// this app — connecting runs the `ssh` this machine already has.
    pub hosts: Arc<HostStore>,
    /// What you are working on, saved under a name. Not a capability: a
    /// workspace names folders, and opening one goes through the same checks
    /// as opening one by hand.
    pub workspaces: Arc<WorkspaceStore>,
    /// The dashboard's notes, todos, events and reminders.
    pub store: Arc<Store>,
    pub ptys: Arc<PtyRegistry>,
    /// Terminals whose shell is held by a supervisor and outlives the window.
    /// Beside `ptys` rather than in it: those are the window's own children,
    /// these are connections to processes that are not.
    pub held: Arc<jky_detach::Clients>,
    /// Kept so the pty layer can place its shell launchers under it.
    pub config_dir: PathBuf,
    pub audit: Arc<AuditLog>,
    /// The turn currently in flight, if any. One at a time in v0.1.
    pub turn: Arc<Mutex<Option<TurnState>>>,
    /// Serializes an entire AI interaction, including the period while it is
    /// waiting for an approval. A single cancellation flag is safe only when
    /// there can be one owner at a time.
    pub ai_active: Arc<Mutex<bool>>,
    /// Set when the user asks to stop. Checked between stream chunks and
    /// between rounds, so a long answer stops rather than being hidden.
    pub cancelled: Arc<AtomicBool>,
    /// One client for every app that fetches, so connections are pooled
    /// rather than a fresh TLS handshake being paid on each panel refresh.
    /// Its timeouts are set in `jky_apps::net`, beside the retry policy, so
    /// there is one place that decides how long anything waits.
    pub http: reqwest::Client,
    /// Reads processor, memory, disk and network for the status bar.
    ///
    /// One for the app, kept alive between calls: two of those four are
    /// differences between successive moments, so a sampler built fresh per
    /// call would report zero for ever.
    pub sampler: Arc<Mutex<Sampler>>,
    /// The GitHub sign-in in flight, if any. One at a time: starting another
    /// abandons the first rather than leaving two waiting.
    pub github_flow: Arc<Mutex<Option<PendingDevice>>>,
}

impl AppState {
    /// `config_dir` is the OS-appropriate per-user application config directory,
    /// resolved by Tauri at startup. Taking it as an argument rather than
    /// discovering it here keeps this constructible in tests.
    pub fn new(config_dir: &Path) -> Self {
        // Before anything is written into it. A failure here is reported and
        // not fatal: a terminal that will not open over a permission bit
        // would be worse than one that says so.
        if let Err(e) = private_config_dir(config_dir) {
            eprintln!("jky: could not make {} private: {e}", config_dir.display());
        }
        Self {
            secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)),
            settings: Arc::new(SettingsStore::new(config_dir.join("settings.json"))),
            keys: Arc::new(Keymap::new(config_dir.join("keymap.json"))),
            memory: Arc::new(open_memory(config_dir)),
            hosts: Arc::new(HostStore::new(config_dir.join("hosts.json"))),
            workspaces: Arc::new(WorkspaceStore::new(config_dir.join("workspaces.json"))),
            store: Arc::new(Store::new(config_dir)),
            ptys: Arc::new(PtyRegistry::new()),
            held: Arc::new(jky_detach::Clients::new()),
            config_dir: config_dir.to_path_buf(),
            // Signed with a key from the OS keychain, which also remembers the
            // newest record — so `jky audit` can tell an edited, shortened or
            // deleted log from an intact one. See `jky-audit`.
            audit: Arc::new(AuditLog::with_anchor(
                config_dir.join("audit.jsonl"),
                Arc::new(KeychainAnchor::new(Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)))),
            )),
            turn: Arc::new(Mutex::new(None)),
            ai_active: Arc::new(Mutex::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
            http: jky_apps::net::client(),
            sampler: Arc::new(Mutex::new(Sampler::new())),
            github_flow: Arc::new(Mutex::new(None)),
        }
    }
}

/// Make the config folder reachable by its owner only.
///
/// It holds every command run and the tail of its output, saved scrollback,
/// notes, the audit log and more. A home directory that others can read —
/// the default on some Linux systems — must not make any of that readable
/// through here, so the folder itself is tightened on every start rather than
/// trusting how it was first made. On Windows `%APPDATA%` is already the
/// user's own.
pub(crate) fn private_config_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Open Work Memory, bringing an older `history.jsonl` across the first time.
///
/// A database that cannot be opened — one written by a newer JKY, or a
/// damaged file — is left exactly as it is, and this session keeps its
/// history in memory instead: losing what is typed today is better than
/// changing a file this build does not understand, and far better than not
/// opening at all.
fn open_memory(config_dir: &Path) -> Memory {
    let memory = match Memory::open(config_dir.join("memory.sqlite3")) {
        Ok(memory) => memory,
        Err(e) => {
            eprintln!("jky: work memory unavailable, keeping this session's history in memory only: {e}");
            return Memory::in_memory().expect("an in-memory database always opens");
        }
    };
    if let Err(e) = memory.import_history(&config_dir.join("history.jsonl")) {
        eprintln!("jky: the old history file could not be imported yet, and was left in place: {e}");
    }
    memory
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn the_config_folder_is_made_owner_only() {
        // It holds every command run and its output, scrollback, notes and
        // the audit log. A home directory readable by others must not make
        // any of that readable through this folder.
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::TempDir::new().unwrap();
        let config = home.path().join("dev.jky.terminal");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o755)).unwrap();

        private_config_dir(&config).unwrap();
        assert_eq!(std::fs::metadata(&config).unwrap().permissions().mode() & 0o777, 0o700);

        // And one that does not exist yet is created that way.
        let fresh = home.path().join("new");
        private_config_dir(&fresh).unwrap();
        assert_eq!(std::fs::metadata(&fresh).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[test]
    fn the_old_history_comes_across_on_first_start_and_its_file_goes() {
        let dir = tempfile::TempDir::new().unwrap();
        let old = jky_history::History::new(dir.path().join("history.jsonl"));
        old.record(jky_history::Entry {
            command: "make release".into(),
            cwd: "/w".into(),
            code: 0,
            at: 1,
            session: "p".into(),
            host: None,
        })
        .unwrap();

        let memory = open_memory(dir.path());
        assert_eq!(memory.recent_commands(5).unwrap(), ["make release"]);
        assert!(!dir.path().join("history.jsonl").exists());
        assert!(dir.path().join("memory.sqlite3").exists());
    }

    #[test]
    fn a_database_from_a_newer_jky_is_left_untouched() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("memory.sqlite3");
        // What a newer build would leave: a schema this one does not know.
        drop(Memory::open(&path).unwrap());
        rusqlite::Connection::open(&path).unwrap().pragma_update(None, "user_version", 99).unwrap();
        let before = std::fs::read(&path).unwrap();

        // The session still gets a working history, kept in memory.
        let memory = open_memory(dir.path());
        memory.record(jky_memory::Run { command: "ls".into(), at: 1, ..Default::default() }).unwrap();
        assert_eq!(memory.recent_commands(1).unwrap(), ["ls"]);
        assert_eq!(std::fs::read(&path).unwrap(), before, "a newer database was changed");
    }
}
