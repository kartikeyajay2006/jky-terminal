use std::path::Path;

use crate::sandbox::resolve_within;

/// The most tool output sent back in one result.
///
/// A whole repository pasted into the context window costs money and crowds
/// out the conversation. Truncation is announced rather than silent, so the
/// model knows it is reasoning about a fragment.
pub const MAX_TOOL_OUTPUT: usize = 24_000;
/// Limits apply to the work as well as the returned answer. Without them a
/// small final answer could still require reading an entire monorepo.
const MAX_SEARCH_FILES: usize = 5_000;
const MAX_SEARCH_FILE_BYTES: u64 = 1_024 * 1_024;
const MAX_SEARCH_BYTES: u64 = 16 * 1_024 * 1_024;
const MAX_SEARCH_DEPTH: usize = 32;
const MAX_LIST_ENTRIES: usize = 1_000;

/// Directories no one means to search.
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".next", ".venv", "__pycache__",
];

pub struct ToolOutcome {
    pub text: String,
    pub is_error: bool,
}

impl ToolOutcome {
    fn ok(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_error: false }
    }
    fn err(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_error: true }
    }
}

fn truncate(mut text: String) -> String {
    if text.len() > MAX_TOOL_OUTPUT {
        text.truncate(MAX_TOOL_OUTPUT);
        text.push_str("\n… output truncated at the size limit.");
    }
    text
}

fn arg<'a>(input: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    input.get(key)?.as_str().filter(|s| !s.trim().is_empty())
}

pub fn execute_read_tool(root: &Path, name: &str, input: &serde_json::Value) -> ToolOutcome {
    match name {
        "read_file" => read_file(root, input),
        "list_dir" => list_dir(root, input),
        "git_status" => git_status(root),
        "search_codebase" => search_codebase(root, input),
        other => ToolOutcome::err(format!("'{other}' is not a tool this terminal provides")),
    }
}

fn read_file(root: &Path, input: &serde_json::Value) -> ToolOutcome {
    let Some(requested) = arg(input, "path") else {
        return ToolOutcome::err("read_file needs a 'path' argument");
    };
    let path = match resolve_within(root, requested) {
        Ok(p) => p,
        Err(e) => return ToolOutcome::err(e.to_string()),
    };
    if path.is_dir() {
        return ToolOutcome::err(format!("'{requested}' is a directory; use list_dir"));
    }
    match std::fs::read(&path) {
        // Reported rather than lossily converted: mojibake looks like content.
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => ToolOutcome::ok(truncate(text)),
            Err(_) => ToolOutcome::err(format!("'{requested}' is not UTF-8 text")),
        },
        Err(e) => ToolOutcome::err(format!("could not read '{requested}': {e}")),
    }
}

fn list_dir(root: &Path, input: &serde_json::Value) -> ToolOutcome {
    let requested = arg(input, "path").unwrap_or(".");
    let path = match resolve_within(root, requested) {
        Ok(p) => p,
        Err(e) => return ToolOutcome::err(e.to_string()),
    };

    let Ok(entries) = std::fs::read_dir(&path) else {
        return ToolOutcome::err(format!("could not list '{requested}'"));
    };

    let mut names = Vec::new();
    let mut limited = false;
    for entry in entries.flatten() {
        if names.len() == MAX_LIST_ENTRIES {
            limited = true;
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
            // A trailing slash so the model can tell a directory from a file
            // without a second call.
            names.push(if entry.path().is_dir() { format!("{name}/") } else { name });
    }
    names.sort();

    if names.is_empty() {
        return ToolOutcome::ok(format!("'{requested}' is empty"));
    }
    let mut result = names.join("\n");
    if limited {
        result.push_str("\n… directory listing truncated at 1,000 entries.");
    }
    ToolOutcome::ok(truncate(result))
}

fn git_status(root: &Path) -> ToolOutcome {
    match std::process::Command::new("git")
        .args(["status", "--short", "--branch"])
        .current_dir(root)
        .output()
    {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            ToolOutcome::ok(truncate(if text.trim().is_empty() {
                "the working tree is clean".to_string()
            } else {
                text
            }))
        }
        Ok(out) => ToolOutcome::err(format!(
            "git status failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Err(_) => ToolOutcome::err("git is not available on this machine"),
    }
}

fn search_codebase(root: &Path, input: &serde_json::Value) -> ToolOutcome {
    let Some(query) = arg(input, "query") else {
        return ToolOutcome::err("search_codebase needs a 'query' argument");
    };

    if query.len() > 2_048 {
        return ToolOutcome::err("search query is too long");
    }
    let Ok(root) = root.canonicalize() else {
        return ToolOutcome::err("could not resolve the project root");
    };
    let mut hits = Vec::new();
    let mut budget = SearchBudget::default();
    walk(&root, &root, 0, &mut |file| {
        if budget.files >= MAX_SEARCH_FILES || budget.bytes >= MAX_SEARCH_BYTES {
            return false;
        }
        let Ok(meta) = std::fs::metadata(file) else { return true };
        if !meta.is_file() || meta.len() > MAX_SEARCH_FILE_BYTES {
            return true;
        }
        budget.files += 1;
        budget.bytes += meta.len();
        let Ok(text) = std::fs::read_to_string(file) else {
            return true; // binary or unreadable; not an error, just not a match
        };
        for (i, line) in text.lines().enumerate() {
            if line.contains(query) {
                let rel = file.strip_prefix(&root).unwrap_or(file);
                hits.push(format!("{}:{}: {}", rel.display(), i + 1, line.trim()));
            }
        }
        true
    });

    if hits.is_empty() {
        return ToolOutcome::ok(format!("no matches for '{query}'"));
    }
    let mut result = hits.join("\n");
    if budget.files >= MAX_SEARCH_FILES || budget.bytes >= MAX_SEARCH_BYTES {
        result.push_str("\n… search stopped at its resource limit.");
    }
    ToolOutcome::ok(truncate(result))
}

/// Depth-first over the project, skipping directories nobody means to search.
#[derive(Default)]
struct SearchBudget { files: usize, bytes: u64 }

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    visit: &mut impl FnMut(&Path) -> bool,
) -> bool {
    if depth > MAX_SEARCH_DEPTH {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return true;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        // file_type does not follow links. Never recurse through a symlink,
        // and canonicalise actual entries before using them as defence in
        // depth against a directory being swapped while a search is running.
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() { continue; }
        let Ok(real) = path.canonicalize() else { continue };
        if !real.starts_with(root) { continue; }
        if kind.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            if !walk(root, &real, depth + 1, visit) { return false; }
        } else if kind.is_file() && !visit(&real) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn project() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {\n    println!(\"hi\");\n}").unwrap();
        fs::write(dir.path().join("README.md"), "# JKY\nA terminal.").unwrap();
        dir
    }

    fn run(dir: &TempDir, name: &str, input: serde_json::Value) -> ToolOutcome {
        execute_read_tool(dir.path(), name, &input)
    }

    #[test]
    fn read_file_returns_the_contents() {
        let dir = project();
        let out = run(&dir, "read_file", serde_json::json!({"path": "src/main.rs"}));
        assert!(!out.is_error);
        assert!(out.text.contains("println!"));
    }

    #[test]
    fn read_file_refuses_a_path_outside_the_project() {
        // A file that genuinely exists outside the project, so the refusal is
        // about containment rather than about the path being missing. On
        // Windows /etc/passwd does not exist and would pass for the wrong
        // reason.
        let dir = project();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("id_rsa");
        fs::write(&secret, "PRIVATE KEY").unwrap();

        let out = run(
            &dir,
            "read_file",
            serde_json::json!({"path": secret.to_string_lossy()}),
        );
        assert!(out.is_error);
        assert!(
            out.text.to_lowercase().contains("outside the project"),
            "wrong refusal reason: {}",
            out.text
        );
        assert!(!out.text.contains("PRIVATE KEY"), "the file was read anyway");
    }

    #[test]
    fn read_file_reports_a_missing_file_without_pretending_it_is_empty() {
        let dir = project();
        let out = run(&dir, "read_file", serde_json::json!({"path": "src/nope.rs"}));
        assert!(out.is_error);
        assert!(out.text.contains("does not exist"));
    }

    #[test]
    fn read_file_truncates_a_file_larger_than_the_limit_and_says_so() {
        // Silently truncating leaves the model reasoning about a file it
        // thinks it has all of.
        let dir = project();
        fs::write(dir.path().join("big.txt"), "x".repeat(MAX_TOOL_OUTPUT * 2)).unwrap();

        let out = run(&dir, "read_file", serde_json::json!({"path": "big.txt"}));
        assert!(!out.is_error);
        assert!(out.text.len() <= MAX_TOOL_OUTPUT + 200);
        assert!(out.text.contains("truncated"));
    }

    #[test]
    fn read_file_rejects_a_binary_file_rather_than_returning_mojibake() {
        let dir = project();
        fs::write(dir.path().join("blob.bin"), [0u8, 159, 146, 150]).unwrap();

        let out = run(&dir, "read_file", serde_json::json!({"path": "blob.bin"}));
        assert!(out.is_error);
        assert!(out.text.to_lowercase().contains("not utf-8"));
    }

    #[test]
    fn list_dir_lists_entries() {
        let dir = project();
        let out = run(&dir, "list_dir", serde_json::json!({"path": "."}));
        assert!(!out.is_error);
        assert!(out.text.contains("README.md"));
        assert!(out.text.contains("src"));
    }

    #[test]
    fn list_dir_marks_directories_so_the_model_can_tell_them_apart() {
        let dir = project();
        let out = run(&dir, "list_dir", serde_json::json!({"path": "."}));
        assert!(out.text.contains("src/"), "directories should be marked: {}", out.text);
    }

    #[test]
    fn list_dir_refuses_a_path_outside_the_project() {
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s").unwrap();

        let out = run(
            &dir,
            "list_dir",
            serde_json::json!({"path": outside.path().to_string_lossy()}),
        );
        assert!(out.is_error);
        assert!(!out.text.contains("secret"), "the directory was listed anyway");
    }

    #[test]
    fn search_codebase_reports_file_and_line() {
        let dir = project();
        let out = run(&dir, "search_codebase", serde_json::json!({"query": "println"}));
        assert!(!out.is_error);
        assert!(out.text.contains("main.rs"));
        assert!(out.text.contains(":2"), "line number missing: {}", out.text);
    }

    #[test]
    fn search_codebase_says_so_when_there_are_no_matches() {
        // An empty string reads as a broken tool rather than an answer.
        let dir = project();
        let out = run(&dir, "search_codebase", serde_json::json!({"query": "zzzznotpresent"}));
        assert!(!out.is_error);
        assert!(out.text.to_lowercase().contains("no match"));
    }

    #[test]
    fn search_codebase_skips_directories_nobody_wants_searched() {
        let dir = project();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("node_modules/pkg/index.js"), "println").unwrap();

        let out = run(&dir, "search_codebase", serde_json::json!({"query": "println"}));
        assert!(!out.text.contains("node_modules"), "searched node_modules: {}", out.text);
    }

    #[test]
    #[cfg(unix)]
    fn search_codebase_never_follows_a_symlink_outside_the_project() {
        use std::os::unix::fs::symlink;
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.txt"), "SYMLINK-SECRET").unwrap();
        symlink(outside.path(), dir.path().join("outside")).unwrap();

        let out = run(&dir, "search_codebase", serde_json::json!({"query": "SYMLINK-SECRET"}));
        assert!(out.text.starts_with("no matches"), "search escaped: {}", out.text);
    }

    #[test]
    fn an_unknown_tool_is_an_error_rather_than_silence() {
        let dir = project();
        let out = run(&dir, "rm_rf", serde_json::json!({}));
        assert!(out.is_error);
        assert!(out.text.contains("rm_rf"));
    }

    #[test]
    fn a_missing_argument_is_an_error_rather_than_a_default() {
        // Defaulting a missing path to "." would silently answer a question
        // the model did not ask.
        let dir = project();
        assert!(run(&dir, "read_file", serde_json::json!({})).is_error);
        assert!(run(&dir, "search_codebase", serde_json::json!({})).is_error);
    }
}
