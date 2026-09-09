//! What you are working on, saved under a name.
//!
//! A workspace is not a folder and not a window: it is the answer to "put me
//! back where I was on that project" — which folders the editor had open,
//! where terminals start, how many of them, and which machine, if any, it was
//! on. Switching applies all of it at once.
//!
//! Nothing here reaches the filesystem beyond its own file. A workspace names
//! folders; opening one goes through `jky-files`, which checks it the same
//! way it checks a folder opened by hand. A saved workspace is a wish, not a
//! capability — otherwise a file somebody edited would be a way to read any
//! directory on the machine.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("a workspace needs a name")]
    NoName,
    #[error("`{0}` is already the name of a workspace")]
    NameTaken(String),
    #[error("no workspace with that id")]
    NoSuchWorkspace,
    #[error("could not read the workspaces: {0}")]
    Read(String),
    #[error("could not write the workspaces: {0}")]
    Write(String),
    #[error("the workspaces file is not valid JSON: {0}")]
    Parse(String),
}

/// The longest a name may be. Long enough to be descriptive, short enough to
/// fit a list without being cut off — a name that is cut off is not a name.
pub const MAX_NAME: usize = 60;

/// One saved setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    /// Stable across renames, so switching still finds it when it is called
    /// something else.
    pub id: String,
    pub name: String,
    /// Folders for the editor to open. Paths as typed, `~` and all.
    #[serde(default)]
    pub folders: Vec<String>,
    /// Where new terminals start. None means wherever they would anyway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_dir: Option<String>,
    /// How many terminals to open. Zero means leave the terminals alone.
    #[serde(default)]
    pub terminals: u8,
    /// A saved host to open a terminal on, by `jky-remote` id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// A line about what this is for. Shown under the name.
    #[serde(default)]
    pub note: String,
    /// Milliseconds since the epoch. Orders the list by what you last used.
    #[serde(default)]
    pub last_used: i64,
}

/// The most terminals a workspace will open on switching.
///
/// Not a limit of the terminal — a bound on what one click can do. A
/// workspace that said two hundred would spend a minute spawning shells
/// nobody asked for, and the file is hand-editable.
pub const MAX_TERMINALS: u8 = 8;

/// Everything saved, and which one is current.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct Saved {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    /// The one in use, by id. None is a perfectly ordinary state: it means
    /// what is open was arranged by hand rather than restored from a name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
}

pub struct WorkspaceStore {
    path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Everything saved, most recently used first.
    pub fn load(&self) -> Result<Saved, WorkspaceError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
            Err(e) => return Err(WorkspaceError::Read(e.to_string())),
        };

        let mut saved: Saved =
            serde_json::from_str(&raw).map_err(|e| WorkspaceError::Parse(e.to_string()))?;
        saved.workspaces.sort_by(|a, b| b.last_used.cmp(&a.last_used).then(a.name.cmp(&b.name)));
        // An active id naming a workspace that has gone is not active.
        if let Some(active) = &saved.active {
            if !saved.workspaces.iter().any(|w| &w.id == active) {
                saved.active = None;
            }
        }
        Ok(saved)
    }

    fn write(&self, saved: &Saved) -> Result<(), WorkspaceError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| WorkspaceError::Write(e.to_string()))?;
        }
        let text = serde_json::to_string_pretty(saved)
            .map_err(|e| WorkspaceError::Write(e.to_string()))?;
        std::fs::write(&self.path, text).map_err(|e| WorkspaceError::Write(e.to_string()))
    }

    /// Add or replace one.
    ///
    /// Names have to be distinct because a name is how a person tells two
    /// workspaces apart — two called "work" is a list you have to open both
    /// of to read.
    pub fn save(&self, mut workspace: Workspace) -> Result<Saved, WorkspaceError> {
        workspace.name = workspace.name.trim().chars().take(MAX_NAME).collect();
        if workspace.name.is_empty() {
            return Err(WorkspaceError::NoName);
        }
        workspace.terminals = workspace.terminals.min(MAX_TERMINALS);
        workspace.folders = dedupe(&workspace.folders);
        workspace.note = workspace.note.trim().to_string();

        let mut saved = self.load()?;
        if saved
            .workspaces
            .iter()
            .any(|w| w.id != workspace.id && w.name.eq_ignore_ascii_case(&workspace.name))
        {
            return Err(WorkspaceError::NameTaken(workspace.name));
        }

        match saved.workspaces.iter_mut().find(|w| w.id == workspace.id) {
            // Editing is not using: renaming one would otherwise shuffle it
            // to the top of a list ordered by what you last worked on.
            Some(existing) => *existing = Workspace { last_used: existing.last_used, ..workspace },
            None => saved.workspaces.push(workspace),
        }
        self.write(&saved)?;
        self.load()
    }

    pub fn forget(&self, id: &str) -> Result<Saved, WorkspaceError> {
        let mut saved = self.load()?;
        let before = saved.workspaces.len();
        saved.workspaces.retain(|w| w.id != id);
        if saved.workspaces.len() == before {
            return Err(WorkspaceError::NoSuchWorkspace);
        }
        if saved.active.as_deref() == Some(id) {
            saved.active = None;
        }
        self.write(&saved)?;
        self.load()
    }

    pub fn get(&self, id: &str) -> Result<Workspace, WorkspaceError> {
        self.load()?
            .workspaces
            .into_iter()
            .find(|w| w.id == id)
            .ok_or(WorkspaceError::NoSuchWorkspace)
    }

    /// Mark one as the current workspace, and note when.
    pub fn activate(&self, id: &str, at: i64) -> Result<Workspace, WorkspaceError> {
        let mut saved = self.load()?;
        let found = saved
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or(WorkspaceError::NoSuchWorkspace)?;
        found.last_used = at;
        let chosen = found.clone();
        saved.active = Some(id.to_string());
        self.write(&saved)?;
        Ok(chosen)
    }

    /// Stop being in any workspace, without forgetting any of them.
    pub fn deactivate(&self) -> Result<Saved, WorkspaceError> {
        let mut saved = self.load()?;
        saved.active = None;
        self.write(&saved)?;
        self.load()
    }
}

/// Keep the first of each, drop blanks. Order is the person's, so it is kept.
fn dedupe(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !out.iter().any(|kept| kept == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, WorkspaceStore) {
        let d = TempDir::new().unwrap();
        let s = WorkspaceStore::new(d.path().join("workspaces.json"));
        (d, s)
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

    #[test]
    fn a_missing_file_is_no_workspaces_rather_than_an_error() {
        let (_d, s) = store();
        assert_eq!(s.load().unwrap(), Saved::default());
    }

    #[test]
    fn a_saved_workspace_comes_back_whole() {
        let (_d, s) = store();
        let mut w = workspace("w1", "jky-terminal");
        w.folders = vec!["~/Desktop/jky-terminal".into()];
        w.terminal_dir = Some("~/Desktop/jky-terminal".into());
        w.terminals = 2;
        w.note = "the repo".into();
        s.save(w.clone()).unwrap();

        assert_eq!(s.get("w1").unwrap(), w);
    }

    #[test]
    fn saving_the_same_id_replaces_rather_than_duplicates() {
        let (_d, s) = store();
        s.save(workspace("w1", "one")).unwrap();
        let saved = s.save(workspace("w1", "renamed")).unwrap();
        assert_eq!(saved.workspaces.len(), 1);
        assert_eq!(saved.workspaces[0].name, "renamed");
    }

    #[test]
    fn two_workspaces_cannot_share_a_name() {
        // A name is how a person tells two of them apart.
        let (_d, s) = store();
        s.save(workspace("w1", "work")).unwrap();
        assert!(matches!(s.save(workspace("w2", "Work")), Err(WorkspaceError::NameTaken(_))));
    }

    #[test]
    fn a_workspace_may_keep_its_own_name() {
        let (_d, s) = store();
        s.save(workspace("w1", "work")).unwrap();
        assert!(s.save(workspace("w1", "work")).is_ok());
    }

    #[test]
    fn a_workspace_needs_a_name() {
        let (_d, s) = store();
        assert!(matches!(s.save(workspace("w1", "   ")), Err(WorkspaceError::NoName)));
    }

    #[test]
    fn a_name_is_trimmed_and_bounded() {
        // A name that is cut off in the list is not a name.
        let (_d, s) = store();
        let mut w = workspace("w1", &"n".repeat(MAX_NAME * 2));
        w.name = format!("  {}  ", w.name);
        s.save(w).unwrap();
        assert_eq!(s.get("w1").unwrap().name.chars().count(), MAX_NAME);
    }

    #[test]
    fn folders_keep_their_order_and_lose_their_repeats() {
        let (_d, s) = store();
        let mut w = workspace("w1", "one");
        w.folders = vec!["~/b".into(), "~/a".into(), "~/b".into(), "  ".into()];
        s.save(w).unwrap();
        assert_eq!(s.get("w1").unwrap().folders, ["~/b", "~/a"]);
    }

    #[test]
    fn a_hand_edited_file_cannot_ask_for_two_hundred_terminals() {
        // Not a limit of the terminal — a bound on what one click can do.
        let (_d, s) = store();
        let mut w = workspace("w1", "one");
        w.terminals = 200;
        s.save(w).unwrap();
        assert_eq!(s.get("w1").unwrap().terminals, MAX_TERMINALS);
    }

    #[test]
    fn activating_marks_it_current_and_notes_when() {
        let (_d, s) = store();
        s.save(workspace("w1", "one")).unwrap();
        let chosen = s.activate("w1", 9_000).unwrap();

        assert_eq!(chosen.last_used, 9_000);
        assert_eq!(s.load().unwrap().active.as_deref(), Some("w1"));
    }

    #[test]
    fn the_list_is_what_you_last_worked_on_first() {
        let (_d, s) = store();
        s.save(workspace("w1", "first")).unwrap();
        s.save(workspace("w2", "second")).unwrap();
        s.activate("w2", 9_000).unwrap();
        assert_eq!(s.load().unwrap().workspaces[0].id, "w2");
    }

    #[test]
    fn editing_a_workspace_does_not_count_as_using_it() {
        let (_d, s) = store();
        s.save(workspace("w1", "one")).unwrap();
        s.activate("w1", 5_000).unwrap();
        s.save(workspace("w1", "renamed")).unwrap();
        assert_eq!(s.get("w1").unwrap().last_used, 5_000);
    }

    #[test]
    fn workspaces_never_used_are_ordered_by_name_rather_than_arbitrarily() {
        let (_d, s) = store();
        s.save(workspace("w1", "zebra")).unwrap();
        s.save(workspace("w2", "alpha")).unwrap();
        assert_eq!(s.load().unwrap().workspaces[0].name, "alpha");
    }

    #[test]
    fn forgetting_the_active_one_leaves_nothing_active() {
        let (_d, s) = store();
        s.save(workspace("w1", "one")).unwrap();
        s.activate("w1", 1).unwrap();
        let saved = s.forget("w1").unwrap();
        assert_eq!(saved.active, None);
        assert!(saved.workspaces.is_empty());
    }

    #[test]
    fn forgetting_one_that_is_not_there_says_so() {
        let (_d, s) = store();
        assert!(matches!(s.forget("nope"), Err(WorkspaceError::NoSuchWorkspace)));
        assert!(matches!(s.activate("nope", 1), Err(WorkspaceError::NoSuchWorkspace)));
        assert!(matches!(s.get("nope"), Err(WorkspaceError::NoSuchWorkspace)));
    }

    #[test]
    fn leaving_a_workspace_forgets_none_of_them() {
        // Working outside any workspace is an ordinary state, not an error.
        let (_d, s) = store();
        s.save(workspace("w1", "one")).unwrap();
        s.activate("w1", 1).unwrap();
        let saved = s.deactivate().unwrap();
        assert_eq!(saved.active, None);
        assert_eq!(saved.workspaces.len(), 1);
    }

    #[test]
    fn an_active_id_naming_something_deleted_by_hand_is_not_active() {
        let (d, s) = store();
        std::fs::write(
            d.path().join("workspaces.json"),
            r#"{"workspaces": [], "active": "ghost"}"#,
        )
        .unwrap();
        assert_eq!(s.load().unwrap().active, None);
    }

    #[test]
    fn a_file_that_is_not_json_says_so_rather_than_looking_empty() {
        // Losing every workspace somebody had, silently, would be worse than
        // an error they can act on.
        let (d, s) = store();
        std::fs::write(d.path().join("workspaces.json"), "{ not json").unwrap();
        assert!(matches!(s.load(), Err(WorkspaceError::Parse(_))));
    }
}
