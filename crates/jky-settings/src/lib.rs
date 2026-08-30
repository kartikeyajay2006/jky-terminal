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
}

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

    /// The GitHub OAuth app the device flow runs against.
    ///
    /// A client id, not a secret: the device flow has no client secret, and
    /// this one is public by design. It lives in settings rather than the
    /// keychain for exactly that reason — putting a public identifier behind
    /// the keychain would say it was confidential when it is not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_client_id: Option<String>,
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
        match std::fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|e| SettingsError::Parse(e.to_string())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(SettingsError::Read(e.to_string())),
        }
    }

    /// Writes settings, creating the parent directory if needed.
    ///
    /// Writes to a temporary file and renames it into place, so an interrupted
    /// write cannot leave a truncated file that fails to parse on next launch.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| SettingsError::Write(e.to_string()))?;
        }
        let body = serde_json::to_string_pretty(settings)
            .map_err(|e| SettingsError::Write(e.to_string()))?;

        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, body).map_err(|e| SettingsError::Write(e.to_string()))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| SettingsError::Write(e.to_string()))
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

    pub fn terminal_start_dir(&self) -> Result<Option<String>, SettingsError> {
        Ok(self.load()?.terminal_start_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
