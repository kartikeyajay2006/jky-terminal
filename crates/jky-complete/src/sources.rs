//! Where completions come from.
//!
//! Each source answers one question and declines everything else. A source
//! that guessed — offering a file where a branch belongs — would produce a
//! completion accepted with Tab by someone who has already stopped reading,
//! which is worse than offering nothing.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Where a suggestion came from, so the panel can say.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Directory,
    File,
    Executable,
    Flag,
    Branch,
    Script,
    History,
}

/// One thing that could come next.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Suggestion {
    /// The text that replaces the word being typed.
    pub value: String,
    /// What to show. Usually the value; a path shows only its last part.
    pub display: String,
    pub kind: Kind,
    /// A word or two of context. Empty when there is nothing worth saying.
    pub detail: String,
    /// Byte offset this suggestion replaces from.
    ///
    /// Almost always the word being typed. A whole command line recalled
    /// from history replaces the whole command instead — `docker r`
    /// completed to `docker run …` must not become `docker docker run …`.
    pub from: usize,
}

impl Suggestion {
    fn new(value: impl Into<String>, kind: Kind) -> Self {
        let value = value.into();
        Suggestion { display: value.clone(), value, kind, detail: String::new(), from: 0 }
    }

    fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = detail.into();
        self
    }

    fn showing(mut self, display: impl Into<String>) -> Self {
        self.display = display.into();
        self
    }
}

/// How many of anything is worth collecting before ranking cuts it down.
///
/// A directory with forty thousand files in it is a real thing, and reading
/// all of it to show ten would make Tab feel broken in exactly the place a
/// completion is most useful.
const SCAN_CAP: usize = 2_000;

/// Expand a leading `~` against the home directory.
fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    match (path.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ if path == "~" => home.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("~")),
        _ => PathBuf::from(path),
    }
}

/// Paths matching the word being typed.
///
/// The word is split at its last separator: everything before is a directory
/// to read, everything after is the prefix to match. That is what makes
/// `src/comp` work — completing a path means listing somewhere other than
/// where you are.
pub fn paths(word: &str, cwd: &Path, home: Option<&Path>) -> Vec<Suggestion> {
    let (dir_part, prefix) = match word.rfind('/') {
        Some(at) => (&word[..=at], &word[at + 1..]),
        None => ("", word),
    };

    let base = if dir_part.is_empty() {
        cwd.to_path_buf()
    } else {
        let expanded = expand_home(dir_part, home);
        if expanded.is_absolute() {
            expanded
        } else {
            cwd.join(expanded)
        }
    };

    let Ok(entries) = std::fs::read_dir(&base) else { return Vec::new() };

    let mut out = Vec::new();
    for entry in entries.take(SCAN_CAP).flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // A dotfile is offered only when a dot was typed. Otherwise every
        // completion in a home directory is drowned in `.cache` and friends.
        if name.starts_with('.') && !prefix.starts_with('.') {
            continue;
        }
        if !name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        // A directory keeps its trailing slash, so Tab twice walks down a
        // tree instead of stopping at each level.
        let value = format!("{dir_part}{name}{}", if is_dir { "/" } else { "" });
        out.push(
            Suggestion::new(value, if is_dir { Kind::Directory } else { Kind::File })
                .showing(format!("{name}{}", if is_dir { "/" } else { "" })),
        );
    }
    out
}

/// Programs on the PATH whose name starts with the word.
///
/// Read fresh rather than cached: something installed while the app was open
/// should be completable without restarting it, and this is only paid when
/// the cursor is on the first word.
pub fn executables(word: &str, path_var: Option<&str>) -> Vec<Suggestion> {
    let Some(path_var) = path_var else { return Vec::new() };
    if word.is_empty() {
        // Every program on the machine is thousands of rows and answers no
        // question. A completion needs something to complete.
        return Vec::new();
    }

    let lowered = word.to_lowercase();
    let mut seen = BTreeSet::new();

    for dir in std::env::split_paths(path_var) {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.take(SCAN_CAP).flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().starts_with(&lowered) {
                seen.insert(name);
            }
        }
        if seen.len() > SCAN_CAP {
            break;
        }
    }

    seen.into_iter().map(|name| Suggestion::new(name, Kind::Executable)).collect()
}

/// Local git branches, when the working directory is in a repository.
///
/// Read from `.git/refs/heads` and `packed-refs` rather than by running git.
/// Spawning a process on every keystroke is what makes a completion feel
/// slow, and this is two file reads that are almost always in the page cache.
pub fn git_branches(cwd: &Path) -> Vec<Suggestion> {
    let Some(git_dir) = find_git_dir(cwd) else { return Vec::new() };

    let mut names = BTreeSet::new();
    collect_refs(&git_dir.join("refs/heads"), &git_dir.join("refs/heads"), &mut names);

    // Branches that have been packed away have no file of their own.
    if let Ok(packed) = std::fs::read_to_string(git_dir.join("packed-refs")) {
        for line in packed.lines() {
            if let Some(name) = line.split_whitespace().nth(1).and_then(|r| r.strip_prefix("refs/heads/")) {
                names.insert(name.to_string());
            }
        }
    }

    names.into_iter().map(|name| Suggestion::new(name, Kind::Branch)).collect()
}

/// Walk up looking for `.git`, the way git itself does.
fn find_git_dir(from: &Path) -> Option<PathBuf> {
    let mut here = Some(from);
    while let Some(dir) = here {
        let candidate = dir.join(".git");
        if candidate.is_dir() {
            return Some(candidate);
        }
        // A worktree's `.git` is a file pointing elsewhere. Not followed:
        // resolving it means parsing a path out of a file and trusting it,
        // and offering no branches is better than offering the wrong repo's.
        here = dir.parent();
    }
    None
}

fn collect_refs(root: &Path, dir: &Path, out: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.take(SCAN_CAP).flatten() {
        let path = entry.path();
        if path.is_dir() {
            // `feature/thing` is a directory and a file, not a branch name
            // with a slash in it, so the tree has to be walked.
            collect_refs(root, &path, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            out.insert(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Scripts declared in a `package.json` beside the working directory.
pub fn npm_scripts(cwd: &Path) -> Vec<Suggestion> {
    let Ok(raw) = std::fs::read_to_string(cwd.join("package.json")) else { return Vec::new() };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else { return Vec::new() };
    let Some(scripts) = parsed.get("scripts").and_then(|s| s.as_object()) else {
        return Vec::new();
    };

    scripts
        .iter()
        .map(|(name, body)| {
            Suggestion::new(name.clone(), Kind::Script)
                .with_detail(body.as_str().unwrap_or("").chars().take(60).collect::<String>())
        })
        .collect()
}

/// Whether a program exists, used to decline rather than to run anything.
pub fn on_path(program: &str, path_var: Option<&str>) -> bool {
    let Some(path_var) = path_var else { return false };
    std::env::split_paths(path_var).any(|dir| {
        let direct = dir.join(program);
        direct.is_file() || direct.with_extension("exe").is_file()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn values(found: &[Suggestion]) -> Vec<&str> {
        let mut v: Vec<&str> = found.iter().map(|s| s.value.as_str()).collect();
        v.sort_unstable();
        v
    }

    fn tree() -> TempDir {
        let d = TempDir::new().unwrap();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::create_dir(d.path().join("scripts")).unwrap();
        std::fs::write(d.path().join("README.md"), "").unwrap();
        std::fs::write(d.path().join("readme.txt"), "").unwrap();
        std::fs::write(d.path().join(".hidden"), "").unwrap();
        std::fs::write(d.path().join("src/main.rs"), "").unwrap();
        d
    }

    #[test]
    fn lists_what_is_here() {
        let d = tree();
        assert_eq!(values(&paths("", d.path(), None)), ["README.md", "readme.txt", "scripts/", "src/"]);
    }

    #[test]
    fn a_directory_keeps_its_slash_so_tab_walks_down() {
        let d = tree();
        let found = paths("sr", d.path(), None);
        assert_eq!(values(&found), ["src/"]);
        assert_eq!(found[0].kind, Kind::Directory);
    }

    #[test]
    fn completes_inside_another_directory() {
        // What makes `src/ma` work at all.
        let d = tree();
        assert_eq!(values(&paths("src/ma", d.path(), None)), ["src/main.rs"]);
    }

    #[test]
    fn shows_the_last_part_but_replaces_the_whole_path() {
        let d = tree();
        let found = paths("src/ma", d.path(), None);
        assert_eq!(found[0].display, "main.rs");
        assert_eq!(found[0].value, "src/main.rs");
    }

    #[test]
    fn hides_dotfiles_until_a_dot_is_typed() {
        // Or every completion in a home directory drowns in .cache.
        let d = tree();
        assert!(!values(&paths("", d.path(), None)).contains(&".hidden"));
        assert_eq!(values(&paths(".h", d.path(), None)), [".hidden"]);
    }

    #[test]
    fn matches_without_regard_to_case() {
        let d = tree();
        assert_eq!(values(&paths("re", d.path(), None)), ["README.md", "readme.txt"]);
    }

    #[test]
    fn expands_a_leading_tilde() {
        let d = tree();
        let found = paths("~/sr", Path::new("/nowhere"), Some(d.path()));
        assert_eq!(values(&found), ["~/src/"]);
    }

    #[test]
    fn a_directory_that_cannot_be_read_offers_nothing_rather_than_failing() {
        assert_eq!(paths("", Path::new("/definitely/not/here"), None), vec![]);
    }

    #[test]
    fn finds_a_program_on_the_path() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("jkytest-tool"), "").unwrap();
        let path_var = d.path().to_string_lossy().to_string();

        assert_eq!(values(&executables("jkytest", Some(&path_var))), ["jkytest-tool"]);
        assert!(on_path("jkytest-tool", Some(&path_var)));
    }

    #[test]
    fn offers_no_programs_for_an_empty_word() {
        // Every program on the machine is thousands of rows and answers no
        // question.
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("thing"), "").unwrap();
        let path_var = d.path().to_string_lossy().to_string();
        assert_eq!(executables("", Some(&path_var)), vec![]);
    }

    #[test]
    fn no_path_variable_means_no_programs_rather_than_a_guess() {
        assert_eq!(executables("ls", None), vec![]);
        assert!(!on_path("ls", None));
    }

    #[test]
    fn reads_branches_without_running_git() {
        // Spawning a process per keystroke is what makes completion feel slow.
        let d = TempDir::new().unwrap();
        let heads = d.path().join(".git/refs/heads");
        std::fs::create_dir_all(heads.join("feature")).unwrap();
        std::fs::write(heads.join("main"), "abc\n").unwrap();
        std::fs::write(heads.join("feature/splits"), "def\n").unwrap();

        assert_eq!(values(&git_branches(d.path())), ["feature/splits", "main"]);
    }

    #[test]
    fn finds_branches_that_have_been_packed_away() {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join(".git/refs/heads")).unwrap();
        std::fs::write(
            d.path().join(".git/packed-refs"),
            "# pack-refs with: peeled fully-peeled sorted\nabc refs/heads/packed\ndef refs/tags/v1\n",
        )
        .unwrap();

        assert_eq!(values(&git_branches(d.path())), ["packed"]);
    }

    #[test]
    fn finds_the_repository_from_a_subdirectory() {
        let d = TempDir::new().unwrap();
        std::fs::create_dir_all(d.path().join(".git/refs/heads")).unwrap();
        std::fs::write(d.path().join(".git/refs/heads/main"), "abc\n").unwrap();
        let deep = d.path().join("a/b/c");
        std::fs::create_dir_all(&deep).unwrap();

        assert_eq!(values(&git_branches(&deep)), ["main"]);
    }

    #[test]
    fn offers_no_branches_outside_a_repository() {
        let d = TempDir::new().unwrap();
        assert_eq!(git_branches(d.path()), vec![]);
    }

    #[test]
    fn reads_npm_scripts_with_what_they_run() {
        let d = TempDir::new().unwrap();
        std::fs::write(
            d.path().join("package.json"),
            r#"{"scripts": {"dev": "vite", "verify": "pnpm test"}}"#,
        )
        .unwrap();

        let found = npm_scripts(d.path());
        assert_eq!(values(&found), ["dev", "verify"]);
        assert_eq!(found.iter().find(|s| s.value == "dev").unwrap().detail, "vite");
    }

    #[test]
    fn a_broken_package_json_offers_nothing_rather_than_failing() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("package.json"), "{ not json").unwrap();
        assert_eq!(npm_scripts(d.path()), vec![]);
    }

    #[test]
    fn no_package_json_offers_nothing() {
        let d = TempDir::new().unwrap();
        assert_eq!(npm_scripts(d.path()), vec![]);
    }
}
