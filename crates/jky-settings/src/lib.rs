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
    fn the_active_provider_round_trips() {
        let (_d, s) = store();
        s.set_active_provider("openai").unwrap();
        assert_eq!(s.load().unwrap().active_provider.as_deref(), Some("openai"));
    }
}
