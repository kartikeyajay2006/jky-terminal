use jky_files::{Entry, FileError, Preview, Workspace};
use jky_pty::home_dir;
use jky_settings::SettingsStore;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// One folder the editor has open.
#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    /// The folder as it was configured — `~` and all. This is its identity:
    /// every later call names it exactly as it was handed over.
    pub root: String,
    /// The last part of it, for the tree's heading.
    pub name: String,
    /// Whether it can still be read. A drive can be unplugged.
    pub available: bool,
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

fn display_name(dir: &str) -> String {
    dir.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(dir)
        .to_string()
}

/// Whether a folder could be opened, without opening it.
///
/// Used when switching workspace, to tell a folder that is merely closed
/// from one that is gone. It resolves a path and asks the filesystem; it
/// grants nothing, and a `true` here still has to pass every check in
/// `workspace` before anything is read.
pub(crate) fn folder_exists(dir: &str) -> bool {
    Workspace::new(expand(dir)).is_ok()
}

pub(crate) fn folders_logic(settings: &SettingsStore) -> Result<Vec<Folder>, String> {
    Ok(settings
        .editor_folders()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|root| Folder {
            name: display_name(&root),
            available: Workspace::new(expand(&root)).is_ok(),
            root,
        })
        .collect())
}

/// The workspace for one open folder.
///
/// The root has to be one the person opened, checked against settings on
/// every call. That is the outer half of the boundary: without it, a window
/// could name any folder on the machine and this would happily open it —
/// which is the whole thing the inner half, `Workspace::resolve`, exists
/// downstream of.
///
/// Resolved per call rather than held. A folder that was deleted, renamed, or
/// on a drive that has been unplugged must stop working, and a `Workspace`
/// built once at startup would keep answering for a path that is no longer
/// there.
pub(crate) fn workspace(settings: &SettingsStore, root: &str) -> Result<Workspace, String> {
    let open = settings.editor_folders().map_err(|e| e.to_string())?;
    if !open.iter().any(|f| f == root) {
        return Err(FileError::NoRoot.to_string());
    }
    Workspace::new(expand(root)).map_err(|e| e.to_string())
}

pub(crate) fn open_logic(settings: &SettingsStore, dir: &str) -> Result<Vec<Folder>, String> {
    let trimmed = dir.trim();
    if !trimmed.is_empty() {
        // Checked before it is stored, so a folder that cannot be opened is
        // refused while the person is still looking at the field.
        Workspace::new(expand(trimmed)).map_err(|e| e.to_string())?;
        settings.open_editor_folder(trimmed).map_err(|e| e.to_string())?;
    }
    folders_logic(settings)
}

pub(crate) fn close_logic(settings: &SettingsStore, dir: &str) -> Result<Vec<Folder>, String> {
    settings.close_editor_folder(dir).map_err(|e| e.to_string())?;
    folders_logic(settings)
}

// --- IPC surface ------------------------------------------------------------

/// Which folders the editor has open.
#[tauri::command]
pub fn files_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    folders_logic(state.settings.as_ref())
}

/// Open one more folder.
#[tauri::command]
pub fn files_open_folder(state: State<'_, AppState>, dir: String) -> Result<Vec<Folder>, String> {
    open_logic(state.settings.as_ref(), &dir)
}

/// Close one folder, leaving the others open.
#[tauri::command]
pub fn files_close_folder(state: State<'_, AppState>, dir: String) -> Result<Vec<Folder>, String> {
    close_logic(state.settings.as_ref(), &dir)
}

/// What is in one directory of an open folder. An empty path is its root.
#[tauri::command]
pub fn files_list(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<Vec<Entry>, String> {
    workspace(state.settings.as_ref(), &root)?.list(&path).map_err(|e| e.to_string())
}

/// One file's text.
#[tauri::command]
pub fn files_read(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<String, String> {
    workspace(state.settings.as_ref(), &root)?.read(&path).map_err(|e| e.to_string())
}

/// Write one file, in place.
#[tauri::command]
pub fn files_write(
    state: State<'_, AppState>,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    workspace(state.settings.as_ref(), &root)?.write(&path, &text).map_err(|e| e.to_string())
}

/// What a file is, when it is not one the editor can edit.
///
/// Reads the same bytes `files_read` does, through the same two checks, and
/// differs only in what it does with a file that is not UTF-8: an image comes
/// back as bytes to draw, anything else comes back named and measured. It
/// writes nothing.
#[tauri::command]
pub fn files_preview(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<Preview, String> {
    workspace(state.settings.as_ref(), &root)?.preview(&path).map_err(|e| e.to_string())
}

/// Make a new, empty file, or a new directory.
///
/// Refuses one that is already there rather than truncating it: "new file"
/// and "erase this file" are different requests, and a name typed by accident
/// into the first must never perform the second.
#[tauri::command]
pub fn files_create(
    state: State<'_, AppState>,
    root: String,
    path: String,
    folder: bool,
) -> Result<(), String> {
    let workspace = workspace(state.settings.as_ref(), &root)?;
    if folder {
        workspace.create_dir(&path).map_err(|e| e.to_string())
    } else {
        workspace.create_file(&path).map_err(|e| e.to_string())
    }
}

/// Rename or move, inside one open folder.
///
/// Both ends are resolved and both must land inside it, so a rename is not a
/// way out of the tree — which is the obvious thing to try once reading and
/// writing are both fenced.
#[tauri::command]
pub fn files_rename(
    state: State<'_, AppState>,
    root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    workspace(state.settings.as_ref(), &root)?.rename(&from, &to).map_err(|e| e.to_string())
}

/// Delete one file, or one directory with nothing in it.
#[tauri::command]
pub fn files_delete(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<(), String> {
    workspace(state.settings.as_ref(), &root)?.delete(&path).map_err(|e| e.to_string())
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

    fn path_of(d: &TempDir) -> String {
        d.path().to_string_lossy().to_string()
    }

    #[test]
    fn nothing_is_reachable_until_a_folder_is_opened() {
        // The editor starts able to touch nothing at all.
        let (_c, p, settings) = setup();
        let message = workspace(&settings, &path_of(&p)).unwrap_err();
        assert!(message.contains("no folder is open"), "{message}");
    }

    #[test]
    fn opening_a_folder_makes_its_files_readable() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &path_of(&p)).unwrap();
        assert_eq!(workspace(&settings, &path_of(&p)).unwrap().read("README.md").unwrap(), "hello\n");
    }

    #[test]
    fn several_folders_are_open_at_once_and_each_reads_its_own() {
        let (_c, one, settings) = setup();
        let two = TempDir::new().unwrap();
        std::fs::write(two.path().join("other.md"), "second\n").unwrap();

        open_logic(&settings, &path_of(&one)).unwrap();
        let folders = open_logic(&settings, &path_of(&two)).unwrap();
        assert_eq!(folders.len(), 2);

        assert_eq!(workspace(&settings, &path_of(&one)).unwrap().read("README.md").unwrap(), "hello\n");
        assert_eq!(workspace(&settings, &path_of(&two)).unwrap().read("other.md").unwrap(), "second\n");
    }

    #[test]
    fn one_open_folder_does_not_make_another_reachable() {
        // The outer half of the boundary: a root has to be one the person
        // opened, not merely a path that exists.
        let (_c, one, settings) = setup();
        let secret = TempDir::new().unwrap();
        std::fs::write(secret.path().join("secret"), "s3kr1t\n").unwrap();

        open_logic(&settings, &path_of(&one)).unwrap();
        assert!(workspace(&settings, &path_of(&secret)).is_err());
    }

    #[test]
    fn closing_one_folder_leaves_the_others_readable() {
        let (_c, one, settings) = setup();
        let two = TempDir::new().unwrap();
        std::fs::write(two.path().join("other.md"), "second\n").unwrap();
        open_logic(&settings, &path_of(&one)).unwrap();
        open_logic(&settings, &path_of(&two)).unwrap();

        close_logic(&settings, &path_of(&one)).unwrap();
        assert!(workspace(&settings, &path_of(&one)).is_err());
        assert!(workspace(&settings, &path_of(&two)).is_ok());
    }

    #[test]
    fn a_folder_that_is_not_there_is_refused_before_it_is_stored() {
        let (_c, _p, settings) = setup();
        assert!(open_logic(&settings, "/definitely/not/here").is_err());
        assert!(folders_logic(&settings).unwrap().is_empty());
    }

    #[test]
    fn a_folder_that_has_gone_is_listed_as_unavailable_rather_than_hidden() {
        // Hiding it would look like somebody's project had been forgotten.
        let (_c, p, settings) = setup();
        let path = path_of(&p);
        open_logic(&settings, &path).unwrap();
        drop(p);

        let folders = folders_logic(&settings).unwrap();
        assert_eq!(folders.len(), 1);
        assert!(!folders[0].available);
        assert!(workspace(&settings, &path).is_err());
    }

    #[test]
    fn a_folder_is_named_by_its_last_part() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &path_of(&p)).unwrap();
        let expected = p.path().file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(folders_logic(&settings).unwrap()[0].name, expected);
    }

    #[test]
    fn nothing_outside_an_open_folder_is_reachable() {
        let (_c, p, settings) = setup();
        open_logic(&settings, &path_of(&p)).unwrap();
        let w = workspace(&settings, &path_of(&p)).unwrap();

        assert!(w.read("../../../etc/passwd").is_err());
        assert!(w.read("/etc/passwd").is_err());
        assert!(w.write("../escape.txt", "x").is_err());
    }
}
