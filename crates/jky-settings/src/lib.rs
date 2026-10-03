//! Non-secret user preferences.
//!
//! Deliberately separate from `jky-secrets`. Anything in here is written to a
//! plain JSON file in the app config directory, so a value that must stay
//! confidential does not belong in this crate — it belongs in the keychain.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("could not read settings: {0}")]
    Read(String),
    #[error("could not write settings: {0}")]
    Write(String),
    #[error("settings file is not valid JSON: {0}")]
    Parse(String),
    /// Written by a newer build, or impossible to upgrade. The message says which.
    #[error("{0}")]
    Document(String),
}

impl From<jky_persist::PersistError> for SettingsError {
    fn from(e: jky_persist::PersistError) -> Self {
        use jky_persist::PersistError as P;
        match e {
            P::Read { .. } => SettingsError::Read(e.to_string()),
            P::Write { .. } => SettingsError::Write(e.to_string()),
            P::Parse { .. } => SettingsError::Parse(e.to_string()),
            P::Newer { .. } | P::Migrate { .. } => SettingsError::Document(e.to_string()),
        }
    }
}

/// `settings.json` over time.
///
/// Schema 1 is the first numbered one; its migration from the unnumbered
/// file is the identity, because the shape did not change — the number is
/// what is new. The `workspace_dir` → `editor_folders` fold predates it and
/// stays in `load`, where it has always been.
pub const SCHEMA: jky_persist::Schema = jky_persist::Schema { current: 1, migrations: &[Ok] };

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    /// Model id chosen per provider key, e.g. "anthropic" -> "claude-opus-5".
    /// Absent means "use the provider's default".
    #[serde(default)]
    pub selected_models: BTreeMap<String, String>,

    /// The provider the assistant currently talks to.
    #[serde(default)]
    pub active_provider: Option<String>,

    /// Where new terminals open. None means the user's home directory.
    /// May contain a leading `~`, which is expanded when the pty is spawned.
    #[serde(default)]
    pub terminal_start_dir: Option<String>,

    /// The folders the editor may read and write inside.
    ///
    /// These are the only settings in the app that widen what the window can
    /// reach, so opening one is a deliberate act by the person rather than a
    /// default: an empty list means the editor has nothing open and can touch
    /// nothing. Several may be open at once, and nothing outside any of them
    /// is reachable.
    #[serde(default)]
    pub editor_folders: Vec<String>,

    /// What `editor_folders` used to be, when only one could be open.
    ///
    /// Read on load and folded into the list, then never written again. A
    /// field kept only to migrate is worth more than a release that silently
    /// closes the folder somebody had open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_dir: Option<String>,

    /// The GitHub OAuth app the device flow runs against.
    ///
    /// A client id, not a secret: the device flow has no client secret, and
    /// this one is public by design. It lives in settings rather than the
    /// keychain for exactly that reason — putting a public identifier behind
    /// the keychain would say it was confidential when it is not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_client_id: Option<String>,

    /// The Google OAuth client this app signs in to Gmail against.
    ///
    /// Public for the same reason the GitHub one is, and for a stricter one:
    /// this is an installed-app client, so Google issues it with no secret at
    /// all and the flow relies on PKCE instead. Keeping it in settings rather
    /// than the keychain keeps the keychain meaning "confidential".
    ///
    /// Unlike GitHub there is no default to fall back on. A Google client is
    /// tied to a project and a consent screen belonging to whoever created it,
    /// so shipping one would mean every install of this app appearing in one
    /// stranger's audit log.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_client_id: Option<String>,

    /// What the app keeps about what you do. See [`Privacy`].
    #[serde(default)]
    pub privacy: Privacy,

    /// The shortcut that summons JKY from anywhere, in canonical form —
    /// `Super+J`, `Ctrl+Alt+Space`. Chosen once, by the installer or in
    /// Settings → Keyboard; `None` means no global shortcut at all. Checked
    /// by `jky_keys::summon` before it is ever stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summon_shortcut: Option<String>,
}

/// What the app keeps about what you do.
///
/// Enforced in Rust, in the commands that write history and scrollback, so a
/// setting turned off stays off whatever the window asks for.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Privacy {
    /// Record each finished command in `history.jsonl`.
    #[serde(default = "yes")]
    pub keep_history: bool,
    /// Forget history older than this many days. 0 keeps it for ever.
    #[serde(default)]
    pub history_days: u32,
    /// Save each pane's scrollback so a restart can restore it.
    #[serde(default = "yes")]
    pub keep_scrollback: bool,
}

fn yes() -> bool {
    true
}

/// Unlike most settings, the default is not all-zeroes: a file from before
/// these existed must mean "as it always was", never "stopped recording".
impl Default for Privacy {
    fn default() -> Self {
        Self { keep_history: true, history_days: 0, keep_scrollback: true }
    }
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Reads settings, treating a missing file as empty defaults. A first run
    /// is not an error.
    pub fn load(&self) -> Result<Settings, SettingsError> {
        match jky_persist::read_document(&self.path, &SCHEMA)? {
            Some(value) => serde_json::from_value(value).map_err(|e| SettingsError::Parse(e.to_string())),
            None => Ok(Settings::default()),
        }
    }

    /// Writes settings, creating the parent directory if needed.
    ///
    /// Atomic and flushed (see `jky-persist`), so an interrupted write cannot
    /// leave a truncated file that fails to parse on next launch.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        Ok(jky_persist::write_document(&self.path, &SCHEMA, settings)?)
    }

    pub fn set_selected_model(&self, provider: &str, model: &str) -> Result<(), SettingsError> {
        let mut s = self.load()?;
        s.selected_models.insert(provider.to_string(), model.to_string());
        self.save(&s)
    }

    pub fn selected_model(&self, provider: &str) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.selected_models.get(provider).cloned())
    }

    pub fn set_active_provider(&self, provider: &str) -> Result<(), SettingsError> {
        let mut s = self.load()?;
        s.active_provider = Some(provider.to_string());
        self.save(&s)
    }

    /// Set where new terminals open. An empty or whitespace-only value clears
    /// the preference, which returns new terminals to the home directory.
    pub fn set_terminal_start_dir(&self, dir: &str) -> Result<(), SettingsError> {
        let mut s = self.load()?;
        let trimmed = dir.trim();
        s.terminal_start_dir = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        self.save(&s)
    }

    /// Open one more folder for the editor.
    ///
    /// Opening one that is already open is not an error and does not add it
    /// twice — it is what happens when somebody reopens a project they
    /// already had.
    pub fn open_editor_folder(&self, dir: &str) -> Result<Vec<String>, SettingsError> {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            return self.editor_folders();
        }
        let mut s = self.load()?;
        let mut folders = folders_of(&s);
        if !folders.iter().any(|f| f == trimmed) {
            folders.push(trimmed.to_string());
        }
        s.editor_folders = folders.clone();
        s.workspace_dir = None;
        self.save(&s)?;
        Ok(folders)
    }

    /// Close one folder. Closing one that is not open changes nothing.
    pub fn close_editor_folder(&self, dir: &str) -> Result<Vec<String>, SettingsError> {
        let mut s = self.load()?;
        let mut folders = folders_of(&s);
        folders.retain(|f| f != dir.trim());
        s.editor_folders = folders.clone();
        s.workspace_dir = None;
        self.save(&s)?;
        Ok(folders)
    }

    /// Replace the whole list, which is what activating a workspace does.
    pub fn set_editor_folders(&self, folders: &[String]) -> Result<Vec<String>, SettingsError> {
        let mut s = self.load()?;
        let mut kept: Vec<String> = Vec::new();
        for folder in folders {
            let trimmed = folder.trim();
            if !trimmed.is_empty() && !kept.iter().any(|f| f == trimmed) {
                kept.push(trimmed.to_string());
            }
        }
        s.editor_folders = kept.clone();
        s.workspace_dir = None;
        self.save(&s)?;
        Ok(kept)
    }

    /// Store the GitHub OAuth client id, or clear it when given nothing.
    ///
    /// Trimmed, because pasting from a browser brings whitespace with it and
    /// a trailing newline would make every device-flow request fail with a
    /// message that named the wrong problem.
    pub fn set_github_client_id(&self, id: &str) -> Result<(), SettingsError> {
        let mut settings = self.load()?;
        let trimmed = id.trim();
        settings.github_client_id = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        self.save(&settings)
    }

    pub fn github_client_id(&self) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.github_client_id)
    }

    /// Same trimming as the GitHub id, for the same reason: this one is
    /// copied out of the Google Cloud console, and what comes with it is a
    /// trailing newline.
    pub fn set_google_client_id(&self, id: &str) -> Result<(), SettingsError> {
        let mut settings = self.load()?;
        let trimmed = id.trim();
        settings.google_client_id = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        self.save(&settings)
    }

    pub fn google_client_id(&self) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.google_client_id)
    }

    pub fn terminal_start_dir(&self) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.terminal_start_dir)
    }

    pub fn privacy(&self) -> Result<Privacy, SettingsError> {
        Ok(self.load()?.privacy)
    }

    pub fn set_privacy(&self, privacy: &Privacy) -> Result<(), SettingsError> {
        let mut s = self.load()?;
        s.privacy = *privacy;
        self.save(&s)
    }

    pub fn summon_shortcut(&self) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.summon_shortcut)
    }

    /// Store the summon shortcut — already in canonical form — or clear it.
    pub fn set_summon_shortcut(&self, shortcut: Option<&str>) -> Result<(), SettingsError> {
        let mut s = self.load()?;
        s.summon_shortcut = shortcut.map(str::to_string);
        self.save(&s)
    }

    /// Every folder the editor has open, oldest first.
    pub fn editor_folders(&self) -> Result<Vec<String>, SettingsError> {
        Ok(folders_of(&self.load()?))
    }
}

/// The open folders, taking the pre-migration single folder into account.
fn folders_of(s: &Settings) -> Vec<String> {
    let mut folders = s.editor_folders.clone();
    if let Some(old) = s.workspace_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        if !folders.iter().any(|f| f == old) {
            folders.insert(0, old.to_string());
        }
    }
    folders
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_summon_shortcut_is_kept_and_cleared_without_touching_anything_else() {
        let dir = tempfile::TempDir::new().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        store.set_active_provider("openai").unwrap();
        assert_eq!(store.summon_shortcut().unwrap(), None);
        store.set_summon_shortcut(Some("Super+J")).unwrap();
        assert_eq!(store.summon_shortcut().unwrap().as_deref(), Some("Super+J"));
        assert_eq!(store.load().unwrap().active_provider.as_deref(), Some("openai"));
        store.set_summon_shortcut(None).unwrap();
        assert_eq!(store.summon_shortcut().unwrap(), None);
        // Absent rather than `null`, so an older build reads the file as it always did.
        assert!(!std::fs::read_to_string(dir.path().join("settings.json")).unwrap().contains("summon"));
    }
    use tempfile::TempDir;

    fn store() -> (TempDir, SettingsStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        (dir, SettingsStore::new(path))
    }

    #[test]
    fn a_missing_file_loads_as_empty_defaults_rather_than_erroring() {
        let (_d, s) = store();
        assert_eq!(s.load().unwrap(), Settings::default());
    }

    #[test]
    fn a_selected_model_round_trips() {
        let (_d, s) = store();
        s.set_selected_model("anthropic", "claude-opus-5").unwrap();
        assert_eq!(s.selected_model("anthropic").unwrap().as_deref(), Some("claude-opus-5"));
    }

    #[test]
    fn selecting_a_model_for_one_provider_leaves_the_others_untouched() {
        let (_d, s) = store();
        s.set_selected_model("anthropic", "claude-opus-5").unwrap();
        s.set_selected_model("openai", "gpt-4o").unwrap();
        assert_eq!(s.selected_model("anthropic").unwrap().as_deref(), Some("claude-opus-5"));
        assert_eq!(s.selected_model("openai").unwrap().as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn an_unset_provider_reports_no_selection() {
        let (_d, s) = store();
        assert_eq!(s.selected_model("groq").unwrap(), None);
    }

    #[test]
    fn selecting_a_model_twice_overwrites_rather_than_duplicating() {
        let (_d, s) = store();
        s.set_selected_model("anthropic", "claude-sonnet-5").unwrap();
        s.set_selected_model("anthropic", "claude-opus-5").unwrap();
        assert_eq!(s.load().unwrap().selected_models.len(), 1);
    }

    #[test]
    fn the_parent_directory_is_created_on_first_write() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("deep/deeper/settings.json");
        let s = SettingsStore::new(&nested);
        s.set_selected_model("anthropic", "claude-sonnet-5").unwrap();
        assert!(nested.is_file());
    }

    #[test]
    fn no_temporary_file_is_left_behind_after_a_successful_write() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        SettingsStore::new(&path).set_selected_model("anthropic", "claude-opus-5").unwrap();
        assert!(!path.with_extension("json.tmp").exists(), "temp file leaked");
    }

    #[test]
    fn a_corrupt_settings_file_reports_a_parse_error_rather_than_panicking() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(matches!(SettingsStore::new(&path).load(), Err(SettingsError::Parse(_))));
    }

    #[test]
    fn saving_repeatedly_overwrites_an_existing_file() {
        // save() writes to a temp file and renames it into place. Rename-over-
        // existing is the operation whose semantics differ most between
        // platforms, so this exercises it on every OS the CI matrix runs.
        // A failure here means settings silently stop persisting after the
        // first write on that platform.
        let (_d, s) = store();
        for model in ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"] {
            s.set_selected_model("anthropic", model).unwrap();
            assert_eq!(s.selected_model("anthropic").unwrap().as_deref(), Some(model));
        }
    }

    #[test]
    fn settings_survive_a_new_store_instance_over_the_same_path() {
        // Proves the value reached disk rather than living in process memory.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");
        SettingsStore::new(&path).set_selected_model("openai", "gpt-4o").unwrap();
        assert_eq!(
            SettingsStore::new(&path).selected_model("openai").unwrap().as_deref(),
            Some("gpt-4o")
        );
    }

    #[test]
    fn the_terminal_start_directory_round_trips() {
        let (_d, s) = store();
        s.set_terminal_start_dir("~/projects").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/projects"));
    }

    #[test]
    fn clearing_the_start_directory_returns_to_the_default() {
        let (_d, s) = store();
        s.set_terminal_start_dir("~/projects").unwrap();
        s.set_terminal_start_dir("   ").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap(), None);
    }

    #[test]
    fn the_start_directory_is_trimmed_before_storing() {
        // A path pasted from a file manager often carries trailing whitespace.
        let (_d, s) = store();
        s.set_terminal_start_dir("  ~/projects  ").unwrap();
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/projects"));
    }

    #[test]
    fn setting_the_start_directory_leaves_model_choices_alone() {
        let (_d, s) = store();
        s.set_selected_model("anthropic", "claude-opus-5").unwrap();
        s.set_terminal_start_dir("~/projects").unwrap();
        assert_eq!(s.selected_model("anthropic").unwrap().as_deref(), Some("claude-opus-5"));
    }

    #[test]
    fn the_active_provider_round_trips() {
        let (_d, s) = store();
        s.set_active_provider("openai").unwrap();
        assert_eq!(s.load().unwrap().active_provider.as_deref(), Some("openai"));
    }
}

#[cfg(test)]
mod github_client_id_tests {
    use super::*;

    fn store() -> (tempfile::TempDir, SettingsStore) {
        let dir = tempfile::TempDir::new().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        (dir, store)
    }

    #[test]
    fn nothing_is_stored_to_begin_with() {
        let (_dir, store) = store();
        assert_eq!(store.github_client_id().unwrap(), None);
    }

    #[test]
    fn keeps_the_id_it_was_given() {
        let (_dir, store) = store();
        store.set_github_client_id("Iv23liABCDEF").unwrap();
        assert_eq!(store.github_client_id().unwrap().as_deref(), Some("Iv23liABCDEF"));
    }

    // Pasting from a browser brings whitespace along, and a trailing newline
    // would fail every request with a message naming the wrong problem.
    #[test]
    fn trims_what_was_pasted() {
        let (_dir, store) = store();
        store.set_github_client_id("  Iv23liABCDEF\n").unwrap();
        assert_eq!(store.github_client_id().unwrap().as_deref(), Some("Iv23liABCDEF"));
    }

    #[test]
    fn clearing_it_removes_it_rather_than_storing_an_empty_string() {
        let (_dir, store) = store();
        store.set_github_client_id("Iv23liABCDEF").unwrap();
        store.set_github_client_id("   ").unwrap();
        assert_eq!(store.github_client_id().unwrap(), None);
    }

    #[test]
    fn setting_it_leaves_the_other_preferences_alone() {
        let (_dir, store) = store();
        store.set_terminal_start_dir("/tmp").unwrap();
        store.set_github_client_id("Iv23liABCDEF").unwrap();
        assert_eq!(store.terminal_start_dir().unwrap().as_deref(), Some("/tmp"));
    }
}

#[cfg(test)]
mod google_client_id_tests {
    use super::*;

    fn store() -> (tempfile::TempDir, SettingsStore) {
        let dir = tempfile::TempDir::new().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        (dir, store)
    }

    #[test]
    fn nothing_is_stored_to_begin_with() {
        let (_dir, store) = store();
        assert_eq!(store.google_client_id().unwrap(), None);
    }

    #[test]
    fn keeps_the_id_it_was_given() {
        let (_dir, store) = store();
        store.set_google_client_id("123-abc.apps.googleusercontent.com").unwrap();
        assert_eq!(
            store.google_client_id().unwrap().as_deref(),
            Some("123-abc.apps.googleusercontent.com")
        );
    }

    #[test]
    fn trims_what_was_pasted() {
        let (_dir, store) = store();
        store.set_google_client_id("  123-abc.apps.googleusercontent.com\n").unwrap();
        assert_eq!(
            store.google_client_id().unwrap().as_deref(),
            Some("123-abc.apps.googleusercontent.com")
        );
    }

    #[test]
    fn clearing_it_removes_it_rather_than_storing_an_empty_string() {
        let (_dir, store) = store();
        store.set_google_client_id("123-abc.apps.googleusercontent.com").unwrap();
        store.set_google_client_id("   ").unwrap();
        assert_eq!(store.google_client_id().unwrap(), None);
    }

    // Two accounts in one settings file: connecting one must not disconnect
    // the other.
    #[test]
    fn setting_it_leaves_the_github_id_alone() {
        let (_dir, store) = store();
        store.set_github_client_id("Iv23liABCDEF").unwrap();
        store.set_google_client_id("123-abc.apps.googleusercontent.com").unwrap();
        assert_eq!(store.github_client_id().unwrap().as_deref(), Some("Iv23liABCDEF"));
    }
}

#[cfg(test)]
mod editor_folder_tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, SettingsStore) {
        let dir = TempDir::new().unwrap();
        let s = SettingsStore::new(dir.path().join("settings.json"));
        (dir, s)
    }

    #[test]
    fn nothing_is_open_until_somebody_opens_something() {
        // These are the settings that widen what the window can reach, so an
        // empty list is the starting point rather than a default folder.
        let (_d, s) = store();
        assert_eq!(s.editor_folders().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn folders_open_and_stay_open() {
        let (_d, s) = store();
        s.open_editor_folder("~/one").unwrap();
        s.open_editor_folder("~/two").unwrap();
        assert_eq!(s.editor_folders().unwrap(), ["~/one", "~/two"]);
    }

    #[test]
    fn opening_one_that_is_already_open_does_not_add_it_twice() {
        // Which is what happens when somebody reopens a project they had.
        let (_d, s) = store();
        s.open_editor_folder("~/one").unwrap();
        s.open_editor_folder("~/one").unwrap();
        assert_eq!(s.editor_folders().unwrap(), ["~/one"]);
    }

    #[test]
    fn closing_one_leaves_the_others() {
        let (_d, s) = store();
        s.open_editor_folder("~/one").unwrap();
        s.open_editor_folder("~/two").unwrap();
        s.close_editor_folder("~/one").unwrap();
        assert_eq!(s.editor_folders().unwrap(), ["~/two"]);
    }

    #[test]
    fn closing_one_that_is_not_open_changes_nothing() {
        let (_d, s) = store();
        s.open_editor_folder("~/one").unwrap();
        assert_eq!(s.close_editor_folder("~/nope").unwrap(), ["~/one"]);
    }

    #[test]
    fn setting_the_whole_list_replaces_it_and_drops_repeats() {
        // What activating a workspace does.
        let (_d, s) = store();
        s.open_editor_folder("~/old").unwrap();
        let set = s
            .set_editor_folders(&["~/a".into(), "~/b".into(), "~/a".into(), "  ".into()])
            .unwrap();
        assert_eq!(set, ["~/a", "~/b"]);
        assert_eq!(s.editor_folders().unwrap(), ["~/a", "~/b"]);
    }

    #[test]
    fn a_folder_saved_before_several_were_possible_still_opens() {
        // A release that silently closed the folder somebody had open would
        // be a release that lost their work for them.
        let (d, s) = store();
        std::fs::write(
            d.path().join("settings.json"),
            r#"{"workspace_dir": "~/legacy"}"#,
        )
        .unwrap();

        assert_eq!(s.editor_folders().unwrap(), ["~/legacy"]);
    }

    #[test]
    fn the_migrated_folder_is_written_into_the_list_and_not_kept_twice() {
        let (d, s) = store();
        std::fs::write(d.path().join("settings.json"), r#"{"workspace_dir": "~/legacy"}"#).unwrap();

        s.open_editor_folder("~/new").unwrap();
        assert_eq!(s.editor_folders().unwrap(), ["~/legacy", "~/new"]);
        assert_eq!(s.load().unwrap().workspace_dir, None);
    }

    #[test]
    fn privacy_defaults_keep_history_and_scrollback_for_ever() {
        // A file from before these settings existed — or no file at all —
        // must mean "as it always was", never "silently stopped recording".
        let (d, s) = store();
        assert_eq!(s.privacy().unwrap(), Privacy { keep_history: true, history_days: 0, keep_scrollback: true });
        std::fs::write(d.path().join("settings.json"), r#"{"active_provider":"anthropic"}"#).unwrap();
        assert_eq!(s.privacy().unwrap(), Privacy::default());
    }

    #[test]
    fn privacy_round_trips_and_leaves_other_settings_alone() {
        let (_d, s) = store();
        s.set_active_provider("openai").unwrap();
        let wanted = Privacy { keep_history: false, history_days: 30, keep_scrollback: false };
        s.set_privacy(&wanted).unwrap();
        assert_eq!(s.privacy().unwrap(), wanted);
        assert_eq!(s.load().unwrap().active_provider.as_deref(), Some("openai"));
    }

    #[test]
    fn settings_are_written_with_a_schema_number() {
        let (d, s) = store();
        s.set_active_provider("anthropic").unwrap();
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(d.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(raw["schema"], SCHEMA.current);
    }

    #[test]
    fn settings_from_a_newer_build_are_refused_and_never_overwritten() {
        // An older build that read this would drop the fields it does not
        // know on its next save. Refusing is the only safe answer.
        let (d, s) = store();
        let path = d.path().join("settings.json");
        let newer = r#"{"schema": 999, "active_provider": "anthropic", "from_the_future": 1}"#;
        std::fs::write(&path, newer).unwrap();

        let err = s.set_active_provider("openai").unwrap_err();
        assert!(err.to_string().contains("newer JKY Terminal"), "{err}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
    }

    #[test]
    fn an_empty_folder_is_ignored_rather_than_opened() {
        let (_d, s) = store();
        assert_eq!(s.open_editor_folder("   ").unwrap(), Vec::<String>::new());
    }
}
