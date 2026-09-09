use jky_files::{Entry, FileError, Workspace};
use jky_pty::home_dir;
use jky_settings::SettingsStore;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// What the editor is allowed to see, and where.
#[derive(Debug, Serialize)]
pub struct WorkspaceInfo {
    /// The folder, as it will be shown. Absent means nothing is open.
    pub root: Option<String>,
}

// --- logic, unit-testable without Tauri -------------------------------------

/// Expand a leading `~`, the way the terminal's start directory already is.
fn expand(dir: &str) -> std::path::PathBuf {
    match (dir.strip_prefix("~/"), home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ if dir == "~" => home_dir().unwrap_or_else(|| std::path::PathBuf::from(dir)),
        _ => std::path::PathBuf::from(dir),
    }
}

/// The workspace, when one is open and still exists.
///
/// Resolved on every call rather than held. A folder that was deleted, or
/// renamed, or on a drive that has been unplugged must stop working — and a
/// `Workspace` built once at startup would keep answering for a path that is
/// no longer there.
pub(crate) fn workspace(settings: &SettingsStore) -> Result<Workspace, String> {
    let configured = settings.workspace_dir().map_err(|e| e.to_string())?;
    let dir = configured.ok_or_else(|| FileError::NoRoot.to_string())?;
    Workspace::new(expand(&dir)).map_err(|e| e.to_string())
}

pub(crate) fn open_logic(settings: &SettingsStore, dir: &str) -> Result<WorkspaceInfo, String> {
    // Checked before it is stored, so a folder that cannot be opened is
    // refused while the person is still looking at the field.
    if !dir.trim().is_empty() {
        Workspace::new(expand(dir.trim())).map_err(|e| e.to_string())?;
    }
    settings.set_workspace_dir(dir).map_err(|e| e.to_string())?;
    Ok(WorkspaceInfo { root: settings.workspace_dir().map_err(|e| e.to_string())? })
}

// --- IPC surface ------------------------------------------------------------

/// Which folder the editor has open, if any.
#[tauri::command]
pub fn files_workspace(state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    Ok(WorkspaceInfo {
        root: state.settings.workspace_dir().map_err(|e| e.to_string())?,
    })
}

/// Open a folder, or close the one that is open.
#[tauri::command]
pub fn files_open_workspace(
    state: State<'_, AppState>,
    dir: String,
) -> Result<WorkspaceInfo, String> {
    open_logic(state.settings.as_ref(), &dir)
}

/// What is in one directory of the open folder. An empty path is its root.
#[tauri::command]
pub fn files_list(state: State<'_, AppState>, path: String) -> Result<Vec<Entry>, String> {
    workspace(state.settings.as_ref())?.list(&path).map_err(|e| e.to_string())
}

/// One file's text.
#[tauri::command]
pub fn files_read(state: State<'_, AppState>, path: String) -> Result<String, String> {
    workspace(state.settings.as_ref())?.read(&path).map_err(|e| e.to_string())
}

/// Write one file, in place.
#[tauri::command]
pub fn files_write(
    state: State<'_, AppState>,
    path: String,
    text: String,
) -> Result<(), String> {
    workspace(state.settings.as_ref())?.write(&path, &text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, TempDir, SettingsStore) {
        let config = TempDir::new().unwrap();
        let project = TempDir::new().unwrap();
        std::fs::write(project.path().join("README.md"), "hello\n").unwrap();
        let settings = SettingsStore::new(config.path().join("settings.json"));
        (config, project, settings)
    }

    #[test]
    fn nothing_is_reachable_until_a_folder_is_opened() {
        // The editor starts able to touch nothing at all.
        let (_c, _p, settings) = setup();
        let message = workspace(&settings).unwrap_err();
        assert!(message.contains("no folder is open"), "{message}");
    }

    #[test]
    fn opening_a_folder_makes_its_files_readable() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &p.path().to_string_lossy()).unwrap();
        assert_eq!(workspace(&settings).unwrap().read("README.md").unwrap(), "hello\n");
    }

    #[test]
    fn a_folder_that_is_not_there_is_refused_before_it_is_stored() {
        // Refused while the person is still looking at the field.
        let (_c, _p, settings) = setup();
        assert!(open_logic(&settings, "/definitely/not/here").is_err());
        assert_eq!(settings.workspace_dir().unwrap(), None);
    }

    #[test]
    fn closing_the_folder_takes_the_reach_away_again() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &p.path().to_string_lossy()).unwrap();
        open_logic(&settings, "").unwrap();
        assert!(workspace(&settings).is_err());
    }

    #[test]
    fn a_folder_that_has_gone_stops_working_rather_than_answering_for_a_ghost() {
        // Resolved per call for exactly this: a Workspace built once at
        // startup would keep answering for a path that is no longer there.
        let (_c, p, settings) = setup();
        let path = p.path().to_string_lossy().to_string();
        open_logic(&settings, &path).unwrap();
        drop(p);
        assert!(workspace(&settings).is_err());
    }

    #[test]
    fn nothing_outside_the_open_folder_is_reachable() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &p.path().to_string_lossy()).unwrap();
        let w = workspace(&settings).unwrap();

        assert!(w.read("../../../etc/passwd").is_err());
        assert!(w.read("/etc/passwd").is_err());
        assert!(w.write("../escape.txt", "x").is_err());
    }
}
