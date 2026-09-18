//! Git worktrees, without ever turning a UI field into a shell command.
//!
//! A worktree is a real checkout, so this is deliberately a small wrapper
//! around the user's installed Git rather than an imitation of Git metadata.
//! Every command is an argument vector; branch names and paths are never
//! interpolated into a shell string.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub locked: bool,
    pub dirty: bool,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("could not start Git: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() { "Git could not complete that operation".into() } else { message })
}

fn parse_list(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut current: Option<Worktree> = None;
    for line in text.lines() {
        if line.is_empty() {
            if let Some(entry) = current.take() { out.push(entry); }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() { out.push(entry); }
            current = Some(Worktree { path: path.to_string(), branch: None, head: String::new(), locked: false, dirty: false });
        } else if let Some(entry) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") { entry.head = head.to_string(); }
            if let Some(branch) = line.strip_prefix("branch refs/heads/") { entry.branch = Some(branch.to_string()); }
            if line == "locked" || line.starts_with("locked ") { entry.locked = true; }
        }
    }
    if let Some(entry) = current { out.push(entry); }
    out
}

fn list(root: &Path) -> Result<Vec<Worktree>, String> {
    let mut entries = parse_list(&git(root, &["worktree", "list", "--porcelain"])?);
    // One cheap porcelain query per checkout. It is intentionally not a
    // watcher: refresh is explicit, and a hidden panel must not wake every
    // repository just to animate a badge.
    for entry in &mut entries {
        entry.dirty = !git(Path::new(&entry.path), &["status", "--porcelain"])?
            .trim()
            .is_empty();
    }
    Ok(entries)
}

fn safe_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("worktree folder names must be one simple folder name".into());
    }
    Ok(name)
}

fn check_branch(root: &Path, branch: &str) -> Result<(), String> {
    let branch = branch.trim();
    if branch.is_empty() { return Err("a branch name is required".into()); }
    git(root, &["check-ref-format", "--branch", branch]).map(|_| ())
}

fn create(root: &Path, name: &str, branch: &str, base: &str) -> Result<Worktree, String> {
    let name = safe_name(name)?;
    check_branch(root, branch)?;
    let base = if base.trim().is_empty() { "HEAD" } else { base.trim() };
    let parent = root.parent().ok_or("the project root has no parent directory")?;
    let target = parent.join(name);
    if target.exists() { return Err(format!("{} already exists", target.display())); }
    let target_text = target.to_string_lossy().to_string();
    git(root, &["worktree", "add", "-b", branch.trim(), &target_text, base])?;
    list(root)?
        .into_iter()
        .find(|entry| Path::new(&entry.path) == target)
        .ok_or_else(|| "Git created the worktree but did not report it".to_string())
}

fn remove(root: &Path, path: &str, force: bool) -> Result<(), String> {
    let target = PathBuf::from(path);
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = target.canonicalize().map_err(|e| e.to_string())?;
    if target == root { return Err("the main checkout cannot be removed as a worktree".into()); }
    let known = list(&root)?.into_iter().any(|entry| Path::new(&entry.path) == target);
    if !known { return Err("that folder is not a worktree of this project".into()); }
    let target_text = target.to_string_lossy().to_string();
    let mut args = vec!["worktree", "remove"];
    if force { args.push("--force"); }
    args.push(&target_text);
    git(&root, &args).map(|_| ())
}

fn opened_root(state: &AppState, named: &str) -> Result<PathBuf, String> {
    crate::commands::files::workspace(state.settings.as_ref(), named)
        .map(|workspace| workspace.root().to_path_buf())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn worktree_list(state: State<'_, AppState>, root: String) -> Result<Vec<Worktree>, String> {
    list(&opened_root(&state, &root)?)
}

#[tauri::command]
pub fn worktree_create(
    state: State<'_, AppState>, root: String, name: String, branch: String, base: String,
) -> Result<Worktree, String> {
    create(&opened_root(&state, &root)?, &name, &branch, &base)
}

#[tauri::command]
pub fn worktree_remove(
    state: State<'_, AppState>, root: String, path: String, force: bool,
) -> Result<(), String> {
    remove(&opened_root(&state, &root)?, &path, force)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_without_guessing_detached_branches() {
        let entries = parse_list("worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /feature\nHEAD def\nlocked waiting\n");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[1].branch, None);
        assert!(entries[1].locked);
    }

    #[test]
    fn folder_name_cannot_escape_the_project_parent() {
        for bad in ["", ".", "..", "../elsewhere", "one/two"] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
        assert_eq!(safe_name("issue-142").unwrap(), "issue-142");
    }
}
