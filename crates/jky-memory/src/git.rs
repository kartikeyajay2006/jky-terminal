//! Which branch and commit a folder was on, read from the repository's files.
//!
//! Recorded with every run, because "the deploy that ran on `release`" and
//! "what was checked out when the tests last passed" are exactly what people
//! search for later. It is read straight from `.git` rather than by running
//! `git`: this happens once per command, and starting a process for every
//! command anyone runs would be a cost paid all day for an answer two file
//! reads give.
//!
//! What it understands: a `.git` directory, a `.git` file pointing elsewhere
//! (worktrees and submodules), `HEAD` naming a branch or holding a commit
//! (detached), loose refs, `packed-refs`, and a worktree's `commondir`. What
//! it does not — reftable, an unusual `GIT_DIR` — yields nothing rather than
//! a guess.

use std::path::{Path, PathBuf};

/// How far up from a folder to look for a repository.
const DEPTH: usize = 64;

/// `(branch, abbreviated commit)` for the checkout containing `dir`, if any.
pub fn git_state(dir: &Path) -> (Option<String>, Option<String>) {
    let Some(git_dir) = find_git_dir(dir) else { return (None, None) };
    let Ok(head) = std::fs::read_to_string(git_dir.join("HEAD")) else { return (None, None) };
    let head = head.trim();

    // A worktree keeps its own HEAD but shares refs with the main repository.
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|c| absolute(&git_dir, c.trim()))
        .unwrap_or_else(|| git_dir.clone());

    if let Some(reference) = head.strip_prefix("ref: ") {
        if !safe_ref(reference) {
            return (None, None);
        }
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference).to_string();
        let rev = resolve(&git_dir, &common, reference).map(|sha| abbreviate(&sha));
        (Some(branch), rev)
    } else if is_sha(head) {
        (None, Some(abbreviate(head)))
    } else {
        (None, None)
    }
}

fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut dir = start;
    for _ in 0..DEPTH {
        let dot_git = dir.join(".git");
        if let Ok(meta) = std::fs::symlink_metadata(&dot_git) {
            if meta.is_dir() {
                return Some(dot_git);
            }
            if meta.is_file() {
                // `gitdir: <path>`, relative to the folder holding the file.
                let text = std::fs::read_to_string(&dot_git).ok()?;
                let target = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
                return Some(absolute(dir, target));
            }
        }
        dir = dir.parent()?;
    }
    None
}

fn absolute(base: &Path, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    }
}

/// The commit a ref names: a loose ref file first, then `packed-refs`.
fn resolve(git_dir: &Path, common: &Path, reference: &str) -> Option<String> {
    for base in [git_dir, common] {
        if let Ok(text) = std::fs::read_to_string(base.join(reference)) {
            let sha = text.trim();
            if is_sha(sha) {
                return Some(sha.to_string());
            }
        }
    }
    let packed = std::fs::read_to_string(common.join("packed-refs")).ok()?;
    packed.lines().find_map(|line| {
        let (sha, name) = line.split_once(' ')?;
        (name.trim() == reference && is_sha(sha)).then(|| sha.to_string())
    })
}

/// A reference may only be a path inside the repository's `refs/`.
fn safe_ref(reference: &str) -> bool {
    reference.starts_with("refs/")
        && !reference.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        && !reference.contains(['\\', '\0'])
}

fn is_sha(text: &str) -> bool {
    (text.len() == 40 || text.len() == 64) && text.chars().all(|c| c.is_ascii_hexdigit())
}

fn abbreviate(sha: &str) -> String {
    sha.chars().take(7).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const SHA: &str = "2b20c307380672ded807e8e89789651d3a0ecb30";
    const OTHER: &str = "efb089b0000000000000000000000000000000ff";

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".git/refs/heads")).unwrap();
        dir
    }

    #[test]
    fn a_branch_and_its_commit_are_read_from_loose_refs() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(dir.path().join(".git/refs/heads/main"), format!("{SHA}\n")).unwrap();
        assert_eq!(git_state(dir.path()), (Some("main".into()), Some("2b20c30".into())));
    }

    #[test]
    fn a_folder_deep_inside_the_checkout_finds_it() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(dir.path().join(".git/refs/heads/main"), SHA).unwrap();
        let deep = dir.path().join("crates/api/src");
        fs::create_dir_all(&deep).unwrap();
        assert_eq!(git_state(&deep).0.as_deref(), Some("main"));
    }

    #[test]
    fn a_branch_with_a_slash_and_a_packed_ref_is_found() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/feat/memory\n").unwrap();
        fs::write(
            dir.path().join(".git/packed-refs"),
            format!("# pack-refs with: peeled fully-peeled sorted\n{OTHER} refs/heads/main\n{SHA} refs/heads/feat/memory\n"),
        )
        .unwrap();
        assert_eq!(git_state(dir.path()), (Some("feat/memory".into()), Some("2b20c30".into())));
    }

    #[test]
    fn a_detached_head_has_a_commit_and_no_branch() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), format!("{SHA}\n")).unwrap();
        assert_eq!(git_state(dir.path()), (None, Some("2b20c30".into())));
    }

    #[test]
    fn a_new_branch_with_no_commit_yet_has_a_name_and_no_commit() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(git_state(dir.path()), (Some("main".into()), None));
    }

    #[test]
    fn a_worktree_reads_its_own_head_and_the_shared_refs() {
        let main = repo();
        fs::write(main.path().join(".git/refs/heads/review"), SHA).unwrap();
        let wt_git = main.path().join(".git/worktrees/review");
        fs::create_dir_all(&wt_git).unwrap();
        fs::write(wt_git.join("HEAD"), "ref: refs/heads/review\n").unwrap();
        fs::write(wt_git.join("commondir"), "../..\n").unwrap();

        let worktree = tempfile::TempDir::new().unwrap();
        fs::write(worktree.path().join(".git"), format!("gitdir: {}\n", wt_git.display())).unwrap();
        assert_eq!(git_state(worktree.path()), (Some("review".into()), Some("2b20c30".into())));
    }

    #[test]
    fn a_folder_outside_any_repository_has_neither() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(git_state(dir.path()), (None, None));
    }

    #[test]
    fn a_head_pointing_outside_the_repository_is_not_followed() {
        let dir = repo();
        fs::write(dir.path().join(".git/HEAD"), "ref: ../../../etc/passwd\n").unwrap();
        assert_eq!(git_state(dir.path()), (None, None));
    }
}
