use jky_settings::SettingsStore;
use jky_workspace::{Saved, Workspace, WorkspaceStore};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// What switching to a workspace actually did.
///
/// Handed back rather than left for the window to infer, because part of it
/// happens in Rust — the folders and the start directory are settings — and
/// part of it happens in the window, which opens the terminals. The window
/// needs to know what to do, and the person needs to be told what changed.
#[derive(Debug, Serialize)]
pub struct Applied {
    pub workspace: Workspace,
    /// The folders now open in the editor. Ones that could not be read are
    /// listed too — see `files_folders`, which marks them unavailable rather
    /// than hiding them.
    pub folders: Vec<String>,
    /// Folders the workspace named that no longer exist. Reported, not
    /// dropped: a folder on a drive that is not plugged in is a folder that
    /// comes back, and quietly editing somebody's workspace to remove it
    /// would lose the setup they saved.
    pub missing: Vec<String>,
    /// Where new terminals will start, once this workspace is on.
    ///
    /// None when the workspace named none. Reported so the window can say it,
    /// because a start directory that silently did nothing is the failure
    /// this field exists to make impossible: `resolve_start_dir` falls back to
    /// home when a configured directory is not there, which is right for
    /// spawning and useless as feedback.
    pub terminal_dir: Option<String>,
    /// Set when the workspace named a start directory that is not there.
    pub terminal_dir_missing: bool,
}

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn save_logic(
    store: &WorkspaceStore,
    workspace: Workspace,
) -> Result<Saved, String> {
    store.save(workspace).map_err(|e| e.to_string())
}

pub(crate) fn forget_logic(store: &WorkspaceStore, id: &str) -> Result<Saved, String> {
    store.forget(id).map_err(|e| e.to_string())
}

/// Switch to a workspace: open what it names, close what it does not.
///
/// The folder list is replaced rather than added to. A workspace is "put me
/// back where I was", and a switch that left the last project's folders open
/// beside this one's would make the second switch worse than the first.
pub(crate) fn activate_logic(
    store: &WorkspaceStore,
    settings: &SettingsStore,
    id: &str,
    at: i64,
    exists: impl Fn(&str) -> bool,
) -> Result<Applied, String> {
    let workspace = store.activate(id, at).map_err(|e| e.to_string())?;

    let (found, missing): (Vec<String>, Vec<String>) =
        workspace.folders.iter().cloned().partition(|f| exists(f));

    let folders = settings.set_editor_folders(&found).map_err(|e| e.to_string())?;

    // The start directory is checked the same way a folder is, and for the
    // same reason: `resolve_start_dir` falls back to home when a configured
    // directory is not there, so a wrong one would leave every terminal
    // opening in the wrong place with nothing on screen saying why.
    let wanted = workspace.terminal_dir.as_deref().map(str::trim).filter(|d| !d.is_empty());
    let terminal_dir_missing = wanted.is_some_and(|dir| !exists(dir));

    if let Some(dir) = wanted {
        if !terminal_dir_missing {
            // A failure here costs the start directory and not the switch:
            // the folders are already open and undoing them would be worse.
            let _ = settings.set_terminal_start_dir(dir);
        }
    }

    Ok(Applied {
        terminal_dir: wanted.filter(|_| !terminal_dir_missing).map(str::to_string),
        terminal_dir_missing,
        workspace,
        folders,
        missing,
    })
}

// --- IPC surface ------------------------------------------------------------

#[tauri::command]
pub fn workspace_list(state: State<'_, AppState>) -> Result<Saved, String> {
    state.workspaces.load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_save(
    state: State<'_, AppState>,
    workspace: Workspace,
) -> Result<Saved, String> {
    save_logic(state.workspaces.as_ref(), workspace)
}

#[tauri::command]
pub fn workspace_forget(state: State<'_, AppState>, id: String) -> Result<Saved, String> {
    forget_logic(state.workspaces.as_ref(), &id)
}

/// Switch to a workspace.
#[tauri::command]
pub fn workspace_activate(
    state: State<'_, AppState>,
    id: String,
    at: i64,
) -> Result<Applied, String> {
    activate_logic(
        state.workspaces.as_ref(),
        state.settings.as_ref(),
        &id,
        at,
        crate::commands::files::folder_exists,
    )
}

/// Leave the current workspace without forgetting any of them.
///
/// Deliberately does not close the folders. Leaving a workspace is saying
/// "what is open is mine now", not "throw it away".
#[tauri::command]
pub fn workspace_leave(state: State<'_, AppState>) -> Result<Saved, String> {
    state.workspaces.deactivate().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, WorkspaceStore, SettingsStore) {
        let d = TempDir::new().unwrap();
        let w = WorkspaceStore::new(d.path().join("workspaces.json"));
        let s = SettingsStore::new(d.path().join("settings.json"));
        (d, w, s)
    }

    fn workspace(id: &str, name: &str) -> Workspace {
        Workspace {
            id: id.into(),
            name: name.into(),
            folders: vec![],
            terminal_dir: None,
            terminals: 0,
            host: None,
            note: String::new(),
            last_used: 0,
        }
    }

    const ALL_THERE: fn(&str) -> bool = |_| true;

    #[test]
    fn switching_opens_the_folders_the_workspace_names() {
        let (_d, w, s) = setup();
        let mut project = workspace("w1", "one");
        project.folders = vec!["~/a".into(), "~/b".into()];
        save_logic(&w, project).unwrap();

        let applied = activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(applied.folders, ["~/a", "~/b"]);
        assert_eq!(s.editor_folders().unwrap(), ["~/a", "~/b"]);
    }

    #[test]
    fn switching_closes_what_the_last_workspace_had_open() {
        // A workspace is "put me back where I was", so a switch that left the
        // last project's folders open would make the next one worse still.
        let (_d, w, s) = setup();
        s.open_editor_folder("~/leftover").unwrap();

        let mut project = workspace("w1", "one");
        project.folders = vec!["~/a".into()];
        save_logic(&w, project).unwrap();

        activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(s.editor_folders().unwrap(), ["~/a"]);
    }

    #[test]
    fn a_folder_that_is_not_there_is_reported_and_not_deleted() {
        // A drive that is unplugged is a folder that comes back, and quietly
        // editing somebody's workspace would lose the setup they saved.
        let (_d, w, s) = setup();
        let mut project = workspace("w1", "one");
        project.folders = vec!["~/here".into(), "~/gone".into()];
        save_logic(&w, project).unwrap();

        let applied = activate_logic(&w, &s, "w1", 1, |f| f == "~/here").unwrap();
        assert_eq!(applied.folders, ["~/here"]);
        assert_eq!(applied.missing, ["~/gone"]);
        // Still in the workspace, ready for the drive to come back.
        assert_eq!(w.get("w1").unwrap().folders, ["~/here", "~/gone"]);
    }

    #[test]
    fn a_start_directory_that_is_not_there_is_reported_rather_than_applied() {
        // `resolve_start_dir` falls back to home for a directory that is not
        // there, so applying a wrong one would open every terminal in the
        // wrong place with nothing saying why.
        let (_d, w, s) = setup();
        s.set_terminal_start_dir("~/mine").unwrap();

        let mut project = workspace("w1", "one");
        project.terminal_dir = Some("~/gone".into());
        save_logic(&w, project).unwrap();

        let applied = activate_logic(&w, &s, "w1", 1, |f| f != "~/gone").unwrap();
        assert!(applied.terminal_dir_missing);
        assert_eq!(applied.terminal_dir, None);
        // Untouched, rather than pointed somewhere that does not exist.
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/mine"));
        // And still in the workspace, ready for the drive to come back.
        assert_eq!(w.get("w1").unwrap().terminal_dir.as_deref(), Some("~/gone"));
    }

    #[test]
    fn switching_says_where_terminals_will_start() {
        let (_d, w, s) = setup();
        let mut project = workspace("w1", "one");
        project.terminal_dir = Some("~/Desktop/thing".into());
        save_logic(&w, project).unwrap();

        let applied = activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(applied.terminal_dir.as_deref(), Some("~/Desktop/thing"));
        assert!(!applied.terminal_dir_missing);
    }

    #[test]
    fn a_blank_start_directory_is_no_start_directory() {
        let (_d, w, s) = setup();
        let mut project = workspace("w1", "one");
        project.terminal_dir = Some("   ".into());
        save_logic(&w, project).unwrap();

        let applied = activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(applied.terminal_dir, None);
        assert!(!applied.terminal_dir_missing);
    }

    #[test]
    fn switching_sets_where_terminals_start() {
        let (_d, w, s) = setup();
        let mut project = workspace("w1", "one");
        project.terminal_dir = Some("~/Desktop/thing".into());
        save_logic(&w, project).unwrap();

        activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/Desktop/thing"));
    }

    #[test]
    fn a_workspace_with_no_start_directory_leaves_the_one_that_is_set() {
        let (_d, w, s) = setup();
        s.set_terminal_start_dir("~/mine").unwrap();
        save_logic(&w, workspace("w1", "one")).unwrap();

        activate_logic(&w, &s, "w1", 1, ALL_THERE).unwrap();
        assert_eq!(s.terminal_start_dir().unwrap().as_deref(), Some("~/mine"));
    }

    #[test]
    fn switching_marks_it_active() {
        let (_d, w, s) = setup();
        save_logic(&w, workspace("w1", "one")).unwrap();
        activate_logic(&w, &s, "w1", 7_000, ALL_THERE).unwrap();

        let saved = w.load().unwrap();
        assert_eq!(saved.active.as_deref(), Some("w1"));
        assert_eq!(saved.workspaces[0].last_used, 7_000);
    }

    #[test]
    fn switching_to_one_that_is_not_there_changes_nothing() {
        let (_d, w, s) = setup();
        s.open_editor_folder("~/mine").unwrap();
        assert!(activate_logic(&w, &s, "ghost", 1, ALL_THERE).is_err());
        assert_eq!(s.editor_folders().unwrap(), ["~/mine"]);
    }

    #[test]
    fn a_refused_name_does_not_reach_the_file() {
        let (_d, w, _s) = setup();
        save_logic(&w, workspace("w1", "one")).unwrap();
        assert!(save_logic(&w, workspace("w2", "One")).is_err());
        assert_eq!(w.load().unwrap().workspaces.len(), 1);
    }
}
