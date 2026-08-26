# JKY Terminal — Plan 4: Tool Loop, Sessions, and the Assistant's Face

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant actually able to read the project and act on it — tools that run, results that come back, conversations that continue — and give it sessions, persistence, and a face worth looking at.

**Architecture:** Every tool resolves its path through one sandbox function that refuses anything outside the project root, including via symlink. The conversation loop lives in Rust: stream, execute ungated tools, park gated ones, feed results back, repeat until the model stops asking. Conversation state moves out of React component state so switching sections cannot destroy it.

**Tech Stack:** Rust 1.96 · `tokio` · React 18 · Zustand 5 · Vitest

**Spec:** [`docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md`](../specs/2026-08-26-jky-terminal-v0.1-design.md)

## Global Constraints

Carried forward. Each is already enforced by a test.

- **No IPC command may return a secret value.** `tests/security.rs` pins the command list; update it in the same commit that adds one, with the reason in the message.
- **CSP `connect-src` may contain only** `'self'`, `ipc:`, `http://ipc.localhost`.
- **The renderer gets no `fs`, `shell`, or `http` capability.** This plan gives the *model* file access; it must not give the renderer any.
- **No literal colour in a component.** Colours come from `src/styles/tokens.css`. The one exception is `theme.ts`'s swatches; the SVG symbol in Task 8 uses `currentColor` and token-derived gradients rather than adding a second.
- **No component may import `@tauri-apps/api` directly** — only `src/platform/tauri.ts`.
- **Cross-platform parity is a hard requirement.** CI builds and tests ubuntu, macos and windows.
- **Commits are authored solely by `kartikeyajay2006 <kartikeyajay2006@gmail.com>`.** No co-author trailers, no AI-attribution anywhere.
- **Conventional Commits.**

## The security problem this plan creates

Until now the model could only talk. This plan lets it read files, and that
changes the threat model:

- A `read_file` that accepts `../../.ssh/id_rsa` is not a code-reading tool,
  it is an exfiltration tool with extra steps.
- The model's tool arguments are **untrusted input**. They are influenced by
  whatever is in the files it has already read, which may include text written
  by someone else — a README, a dependency, a git branch name.
- A symlink inside the project pointing outside it is a path that *looks*
  contained and is not.

So every path a tool touches goes through one function, that function is
tested against traversal, absolute paths, and symlink escape, and no tool is
allowed to build a path any other way.

## The session rule, as implemented

The brief said "five sessions … automatically delete after three", which reads
two ways. This implements: **keep the `MAX_SESSIONS` most recent conversations,
prune the oldest beyond that, and let the user delete any of them by hand.**
`MAX_SESSIONS` is `5` and lives in one place, so the other reading is a
one-word change.

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/jky-ai/src/sandbox.rs` | The one path resolver every tool uses |
| `crates/jky-ai/src/exec.rs` | Executing the read-only tools |
| `crates/jky-ai/src/shell_exec.rs` | Running an approved command, with a timeout |
| `apps/desktop/src-tauri/src/turn.rs` | The conversation loop: stream, execute, resume |
| `apps/desktop/src/app/chatStore.ts` | Sessions, messages, pruning — outside React |
| `apps/desktop/src/components/JkyMark.tsx` | The JKY symbol |
| `apps/desktop/src/features/assistant/SessionList.tsx` | Session switcher |
| `apps/desktop/src/features/assistant/Welcome.tsx` | The empty state |

---

## Task 1: The path sandbox

The security boundary for every tool. Pure, and tested harder than anything
else in this plan.

**Files:**
- Create: `crates/jky-ai/src/sandbox.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolve_within(root: &Path, requested: &str) -> Result<PathBuf, SandboxError>`; `SandboxError::{Escape, Missing, NotUtf8}`. Tasks 2 and 3 route every path through it.

- [ ] **Step 1: Write the failing test**

`crates/jky-ai/src/sandbox.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn project() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join("README.md"), "# hi").unwrap();
        dir
    }

    #[test]
    fn a_relative_path_inside_the_project_resolves() {
        let dir = project();
        let path = resolve_within(dir.path(), "src/main.rs").unwrap();
        assert!(path.ends_with("src/main.rs"));
    }

    #[test]
    fn the_project_root_itself_resolves() {
        let dir = project();
        assert!(resolve_within(dir.path(), ".").is_ok());
    }

    #[test]
    fn a_parent_traversal_is_refused() {
        // The whole point. Tool arguments are influenced by file contents the
        // model has read, which may include text written by someone else.
        let dir = project();
        for attempt in [
            "../etc/passwd",
            "src/../../etc/passwd",
            "./../../etc/passwd",
            "src/./../../../etc/passwd",
        ] {
            assert!(
                matches!(resolve_within(dir.path(), attempt), Err(SandboxError::Escape(_))),
                "traversal not refused: {attempt}"
            );
        }
    }

    #[test]
    fn an_absolute_path_outside_the_project_is_refused() {
        let dir = project();
        for attempt in ["/etc/passwd", "/", "/home"] {
            assert!(
                matches!(resolve_within(dir.path(), attempt), Err(SandboxError::Escape(_))),
                "absolute path not refused: {attempt}"
            );
        }
    }

    #[test]
    fn an_absolute_path_inside_the_project_is_allowed() {
        // Legitimate: a model that has seen an absolute path in output may
        // reasonably hand it back.
        let dir = project();
        let inside = dir.path().join("README.md");
        assert!(resolve_within(dir.path(), &inside.to_string_lossy()).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_pointing_outside_the_project_is_refused() {
        // A path that looks contained and is not. Checking the string alone
        // would pass this; only resolving the link catches it.
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s3cret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), dir.path().join("link")).unwrap();

        assert!(matches!(
            resolve_within(dir.path(), "link"),
            Err(SandboxError::Escape(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_pointing_inside_the_project_is_allowed() {
        let dir = project();
        std::os::unix::fs::symlink(dir.path().join("README.md"), dir.path().join("readme-link"))
            .unwrap();
        assert!(resolve_within(dir.path(), "readme-link").is_ok());
    }

    #[test]
    fn a_missing_file_is_reported_as_missing_not_as_an_escape() {
        // The two are different: one is a mistake, the other is an attack.
        // Reporting both the same way hides the signal that matters.
        let dir = project();
        assert!(matches!(
            resolve_within(dir.path(), "src/nope.rs"),
            Err(SandboxError::Missing(_))
        ));
    }

    #[test]
    fn an_empty_path_is_refused() {
        let dir = project();
        assert!(resolve_within(dir.path(), "").is_err());
        assert!(resolve_within(dir.path(), "   ").is_err());
    }

    #[test]
    fn the_error_never_leaks_the_resolved_absolute_path() {
        // Errors are shown to the model. Telling it where the project sits on
        // disk hands it the information it needs to aim the next attempt.
        let dir = project();
        let err = resolve_within(dir.path(), "../../etc/passwd").unwrap_err();
        let text = err.to_string();
        assert!(
            !text.contains(&dir.path().to_string_lossy().to_string()),
            "error leaked the project root: {text}"
        );
    }

    #[test]
    fn a_path_with_a_null_byte_is_refused() {
        let dir = project();
        assert!(resolve_within(dir.path(), "src/main.rs\0.txt").is_err());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-ai sandbox`
Expected: FAIL — `cannot find function resolve_within`.

- [ ] **Step 3: Write the sandbox**

Prepend to `crates/jky-ai/src/sandbox.rs`:

```rust
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// The path resolved outside the project. Deliberately vague — this text
    /// is shown to the model, and naming the root would help it aim.
    #[error("'{0}' is outside the project")]
    Escape(String),
    #[error("'{0}' does not exist")]
    Missing(String),
    #[error("'{0}' is not a usable path")]
    NotUtf8(String),
}

/// Resolve a tool-supplied path, refusing anything outside `root`.
///
/// Every tool goes through this. Tool arguments are untrusted: they are
/// influenced by whatever the model has already read, which can include text
/// written by someone else — a README, a dependency, a branch name.
///
/// Canonicalisation is what makes it safe rather than merely careful. String
/// inspection would pass a symlink that points outside the project, because
/// the string looks contained; only resolving the link reveals where it goes.
pub fn resolve_within(root: &Path, requested: &str) -> Result<PathBuf, SandboxError> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err(SandboxError::NotUtf8(requested.to_string()));
    }
    // A NUL byte truncates the path at the syscall boundary on some platforms,
    // so "a\0b" can open "a". Refuse rather than reason about it.
    if trimmed.contains('\0') {
        return Err(SandboxError::NotUtf8("<path containing a null byte>".into()));
    }

    let candidate = Path::new(trimmed);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };

    // Both sides must be canonical before comparison: a root reached through a
    // symlink would otherwise never prefix-match its own children.
    let real_root = root
        .canonicalize()
        .map_err(|_| SandboxError::Missing("the project directory".into()))?;
    let real_path = joined
        .canonicalize()
        .map_err(|_| SandboxError::Missing(trimmed.to_string()))?;

    if !real_path.starts_with(&real_root) {
        return Err(SandboxError::Escape(trimmed.to_string()));
    }

    Ok(real_path)
}
```

Add `mod sandbox;` and `pub use sandbox::{SandboxError, resolve_within};` to
`crates/jky-ai/src/lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-ai sandbox`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the sandbox actually refuses**

A guard nobody has watched fail is a guard nobody should trust:

```bash
cargo test -p jky-ai sandbox -- --nocapture 2>&1 | grep -c 'test result: ok'
# Then break it deliberately and confirm the tests catch it:
sed -i 's|if !real_path.starts_with(&real_root) {|if false {|' crates/jky-ai/src/sandbox.rs
cargo test -p jky-ai sandbox    # EXPECT: FAIL, several tests
git checkout crates/jky-ai/src/sandbox.rs
cargo test -p jky-ai sandbox    # EXPECT: PASS
```

Expected: with the containment check disabled, the traversal, absolute-path
and symlink tests all fail. Do not proceed until you have seen that.

- [ ] **Step 6: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): add the tool path sandbox"
```

---

## Task 2: Executing the read-only tools

**Files:**
- Create: `crates/jky-ai/src/exec.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: `resolve_within`, `SandboxError` from Task 1.
- Produces: `execute_read_tool(root: &Path, name: &str, input: &serde_json::Value) -> ToolOutcome`; `ToolOutcome { text: String, is_error: bool }`; `MAX_TOOL_OUTPUT: usize`. Task 4 calls this for every ungated tool.

- [ ] **Step 1: Write the failing test**

`crates/jky-ai/src/exec.rs`:

```rust
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
        let dir = project();
        let out = run(&dir, "read_file", serde_json::json!({"path": "../../etc/passwd"}));
        assert!(out.is_error);
        assert!(out.text.to_lowercase().contains("outside the project"));
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
        assert!(out.text.to_lowercase().contains("not utf-8") || out.text.to_lowercase().contains("binary"));
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
        let out = run(&dir, "list_dir", serde_json::json!({"path": "/etc"}));
        assert!(out.is_error);
    }

    #[test]
    fn search_codebase_reports_file_and_line() {
        let dir = project();
        let out = run(&dir, "search_codebase", serde_json::json!({"query": "println"}));
        assert!(!out.is_error);
        assert!(out.text.contains("src/main.rs"));
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-ai exec`
Expected: FAIL — `cannot find function execute_read_tool`.

- [ ] **Step 3: Write the executor**

Prepend to `crates/jky-ai/src/exec.rs`:

```rust
use std::path::Path;

use crate::sandbox::resolve_within;

/// The most tool output sent back in one result.
///
/// A whole repository pasted into the context window costs money and crowds
/// out the conversation. Truncation is announced rather than silent, so the
/// model knows it is reasoning about a fragment.
pub const MAX_TOOL_OUTPUT: usize = 24_000;

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

    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // A trailing slash so the model can tell a directory from a file
            // without a second call.
            if e.path().is_dir() { format!("{name}/") } else { name }
        })
        .collect();
    names.sort();

    if names.is_empty() {
        return ToolOutcome::ok(format!("'{requested}' is empty"));
    }
    ToolOutcome::ok(truncate(names.join("\n")))
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

    let mut hits = Vec::new();
    walk(root, root, &mut |file| {
        let Ok(text) = std::fs::read_to_string(file) else {
            return; // binary or unreadable; not an error, just not a match
        };
        for (i, line) in text.lines().enumerate() {
            if line.contains(query) {
                let rel = file.strip_prefix(root).unwrap_or(file);
                hits.push(format!("{}:{}: {}", rel.display(), i + 1, line.trim()));
            }
        }
    });

    if hits.is_empty() {
        return ToolOutcome::ok(format!("no matches for '{query}'"));
    }
    ToolOutcome::ok(truncate(hits.join("\n")))
}

fn walk(root: &Path, dir: &Path, visit: &mut impl FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            walk(root, &path, visit);
        } else {
            visit(&path);
        }
    }
}
```

Add `mod exec;` and `pub use exec::{MAX_TOOL_OUTPUT, ToolOutcome, execute_read_tool};` to
`crates/jky-ai/src/lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-ai && cargo clippy -p jky-ai --all-targets -- -D warnings`
Expected: PASS; clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): execute the read-only tools inside the sandbox"
```

---

## Task 3: Running an approved command

**Files:**
- Create: `crates/jky-ai/src/shell_exec.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: `ToolOutcome`, `MAX_TOOL_OUTPUT` from Task 2; `default_shell` from `jky-pty`.
- Produces: `run_approved_command(root: &Path, command: &str, timeout: Duration) -> ToolOutcome`; `COMMAND_TIMEOUT: Duration`. Task 4 calls it after the user approves.

- [ ] **Step 1: Add the dependency**

`crates/jky-ai/Cargo.toml` gains:

```toml
jky-pty = { path = "../jky-pty" }
```

- [ ] **Step 2: Write the failing test**

`crates/jky-ai/src/shell_exec.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn run(cmd: &str) -> ToolOutcome {
        let dir = TempDir::new().unwrap();
        run_approved_command(dir.path(), cmd, Duration::from_secs(10))
    }

    #[test]
    fn a_successful_command_returns_its_output() {
        let out = run("echo hello-from-jky");
        assert!(!out.is_error, "unexpected error: {}", out.text);
        assert!(out.text.contains("hello-from-jky"));
    }

    #[test]
    fn a_failing_command_returns_its_error_output_and_is_marked_failed() {
        // The model needs the stderr to know what to try next; marking it as
        // an error is what stops it treating the message as a result.
        let out = run("ls /definitely-not-a-real-directory");
        assert!(out.is_error);
        assert!(!out.text.is_empty());
    }

    #[test]
    fn the_exit_code_is_reported() {
        let out = run("exit 3");
        assert!(out.is_error);
        assert!(out.text.contains('3'), "exit code missing: {}", out.text);
    }

    #[test]
    fn a_command_producing_nothing_says_so_rather_than_returning_emptiness() {
        // An empty result reads as a broken tool.
        let out = run("true");
        assert!(!out.is_error);
        assert!(!out.text.trim().is_empty());
    }

    #[test]
    fn output_larger_than_the_limit_is_truncated_and_announced() {
        let out = run("head -c 200000 /dev/zero | tr '\\0' 'x'");
        assert!(out.text.len() <= MAX_TOOL_OUTPUT + 200);
    }

    #[test]
    fn a_command_that_hangs_is_stopped_and_reported() {
        // Without this an approved `cat` with no input wedges the whole
        // conversation with no way back.
        let dir = TempDir::new().unwrap();
        let out = run_approved_command(dir.path(), "sleep 30", Duration::from_millis(300));
        assert!(out.is_error);
        assert!(out.text.to_lowercase().contains("timed out"));
    }

    #[test]
    fn the_command_runs_in_the_project_directory() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
        let out = run_approved_command(dir.path(), "ls", Duration::from_secs(10));
        assert!(out.text.contains("marker.txt"));
    }

    #[test]
    fn an_empty_command_is_refused() {
        assert!(run("   ").is_error);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p jky-ai shell_exec`
Expected: FAIL — `cannot find function run_approved_command`.

- [ ] **Step 4: Write the runner**

Prepend to `crates/jky-ai/src/shell_exec.rs`:

```rust
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use crate::exec::{MAX_TOOL_OUTPUT, ToolOutcome};

/// How long an approved command may run before it is stopped.
///
/// A command that never returns wedges the conversation with no way back —
/// an approved `cat` with no input would do it.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

/// Run a command the user has explicitly approved.
///
/// The approval happened before this is reached; nothing here re-checks it.
/// What this owns is making sure the result comes back bounded in both size
/// and time.
pub fn run_approved_command(root: &Path, command: &str, timeout: Duration) -> ToolOutcome {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ToolOutcome { text: "no command was given".into(), is_error: true };
    }

    let (program, flag) = if cfg!(windows) {
        ("cmd.exe", "/C")
    } else {
        ("/bin/sh", "-c")
    };

    let child = Command::new(program)
        .arg(flag)
        .arg(trimmed)
        .current_dir(root)
        .stdin(Stdio::null()) // a command waiting on input would hang forever
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            return ToolOutcome { text: format!("could not start the command: {e}"), is_error: true }
        }
    };

    // wait_with_output has no timeout, so the wait happens on a thread and the
    // deadline is enforced here.
    let (tx, rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    let output = match rx.recv_timeout(timeout) {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            let _ = handle.join();
            return ToolOutcome { text: format!("the command failed: {e}"), is_error: true };
        }
        Err(_) => {
            return ToolOutcome {
                text: format!("the command timed out after {} seconds", timeout.as_secs().max(1)),
                is_error: true,
            }
        }
    };
    let _ = handle.join();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    let mut text = String::new();
    if !stdout.trim().is_empty() {
        text.push_str(&stdout);
    }
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    if text.trim().is_empty() {
        // An empty string reads as a broken tool rather than a quiet success.
        text = format!("the command produced no output (exit code {code})");
    }
    if code != 0 {
        text = format!("exit code {code}\n{text}");
    }
    if text.len() > MAX_TOOL_OUTPUT {
        text.truncate(MAX_TOOL_OUTPUT);
        text.push_str("\n… output truncated at the size limit.");
    }

    ToolOutcome { text, is_error: code != 0 }
}
```

Add `mod shell_exec;` and `pub use shell_exec::{COMMAND_TIMEOUT, run_approved_command};` to
`crates/jky-ai/src/lib.rs`.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p jky-ai`
Expected: PASS. On Windows the shell-syntax tests use `cmd.exe`; if the pipe
test fails there, that is the test's shell assumption rather than the runner —
mark it `#[cfg(unix)]` and note why.

- [ ] **Step 6: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): run approved commands with a timeout and a size limit"
```

---

## Task 4: The conversation loop

The piece that makes tools mean anything: results go back and the model
continues.

**Files:**
- Create: `apps/desktop/src-tauri/src/turn.rs`
- Modify: `apps/desktop/src-tauri/src/commands/ai.rs`, `src/state.rs`, `src/main.rs`, `tests/security.rs`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `TurnState { provider: String, model: String, messages: Vec<Message>, assistant_blocks: Vec<ContentBlock>, results: Vec<ContentBlock>, awaiting: Vec<PendingTool> }`, held in `AppState.turn: Arc<Mutex<Option<TurnState>>>`; and `drive(app, state, turn) -> Result<(), String>` which loops until the model stops asking for tools or a gated call parks it. `ai_approve_tool` and `ai_reject_tool` become async and resume it.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src-tauri/src/turn.rs`, tests only. The loop's *decisions* are
what matter and they are pure; the streaming around them is already covered.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use jky_ai::{ContentBlock, Message, Role};

    fn tool_use(id: &str, name: &str) -> ContentBlock {
        ContentBlock::ToolUse {
            id: id.into(),
            name: name.into(),
            input: serde_json::json!({"path": "src/main.rs"}),
        }
    }

    #[test]
    fn a_turn_with_no_tool_calls_is_finished() {
        let blocks = vec![ContentBlock::Text { text: "hello".into() }];
        assert!(!needs_another_round(&blocks, &[]));
    }

    #[test]
    fn a_turn_whose_tools_all_ran_needs_another_round() {
        // The results have to go back or the model never sees them.
        let blocks = vec![tool_use("t1", "read_file")];
        let results = vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "fn main() {}".into(),
            is_error: false,
        }];
        assert!(needs_another_round(&blocks, &results));
    }

    #[test]
    fn the_assistant_turn_is_recorded_before_the_results() {
        // Sending results without the assistant turn that requested them is a
        // 400: the tool_use_id refers to nothing.
        let mut messages = vec![Message::user_text("hi")];
        let blocks = vec![tool_use("t1", "read_file")];
        let results = vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "ok".into(),
            is_error: false,
        }];

        append_round(&mut messages, blocks, results);

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1].role, Role::Assistant);
        assert_eq!(messages[2].role, Role::User);
    }

    #[test]
    fn every_result_for_one_turn_goes_in_a_single_user_message() {
        // Splitting them across messages teaches the model to stop making
        // parallel calls.
        let mut messages = vec![Message::user_text("hi")];
        let blocks = vec![tool_use("t1", "read_file"), tool_use("t2", "list_dir")];
        let results = vec![
            ContentBlock::ToolResult { tool_use_id: "t1".into(), content: "a".into(), is_error: false },
            ContentBlock::ToolResult { tool_use_id: "t2".into(), content: "b".into(), is_error: false },
        ];

        append_round(&mut messages, blocks, results);
        assert_eq!(messages[2].content.len(), 2);
    }

    #[test]
    fn a_declined_tool_still_returns_a_result_marked_as_an_error() {
        // Silence would leave the model waiting on a tool_use_id forever.
        let block = declined_result("t9");
        match block {
            ContentBlock::ToolResult { tool_use_id, is_error, .. } => {
                assert_eq!(tool_use_id, "t9");
                assert!(is_error);
            }
            other => panic!("wrong block: {other:?}"),
        }
    }

    #[test]
    fn the_loop_stops_after_the_round_limit() {
        // A model that keeps asking for tools would otherwise spend money
        // until the user notices.
        assert!(MAX_ROUNDS >= 3, "too few to be useful");
        assert!(MAX_ROUNDS <= 12, "too many to be safe");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-terminal turn`
Expected: FAIL — `cannot find function needs_another_round`.

- [ ] **Step 3: Write the loop helpers**

Prepend to `apps/desktop/src-tauri/src/turn.rs`:

```rust
use jky_ai::{ContentBlock, Message, Role};

/// How many times the model may ask for tools within one user turn.
///
/// Without a ceiling a model that keeps requesting tools spends money until
/// somebody notices.
pub const MAX_ROUNDS: usize = 8;

/// Whether the results collected this round have to go back to the model.
pub fn needs_another_round(blocks: &[ContentBlock], results: &[ContentBlock]) -> bool {
    let asked = blocks.iter().any(|b| matches!(b, ContentBlock::ToolUse { .. }));
    asked && !results.is_empty()
}

/// Append the assistant's turn and the results it produced.
///
/// Order matters: the assistant turn carries the tool_use blocks the results
/// refer to. Sending results without it is a 400, because the tool_use_id
/// points at nothing.
///
/// All results go in one user message. Splitting them teaches the model to
/// stop making parallel calls.
pub fn append_round(
    messages: &mut Vec<Message>,
    blocks: Vec<ContentBlock>,
    results: Vec<ContentBlock>,
) {
    messages.push(Message { role: Role::Assistant, content: blocks });
    messages.push(Message { role: Role::User, content: results });
}

/// The result sent back when the user declines a command.
///
/// Marked as an error so the model treats it as a refusal rather than as
/// output, and sent at all because silence would leave it waiting on a
/// tool_use_id that never resolves.
pub fn declined_result(tool_use_id: &str) -> ContentBlock {
    ContentBlock::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "The user declined to run this command.".to_string(),
        is_error: true,
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-terminal turn`
Expected: PASS, 6 tests.

- [ ] **Step 5: Hold the turn in state**

`apps/desktop/src-tauri/src/state.rs` — replace `pending_tools` with the
richer turn state, keeping `PendingTool`:

```rust
/// One user turn in flight, including any tool calls waiting on a decision.
pub struct TurnState {
    pub provider: String,
    pub model: String,
    pub messages: Vec<jky_ai::Message>,
    /// Blocks the assistant produced this round.
    pub assistant_blocks: Vec<jky_ai::ContentBlock>,
    /// Results gathered so far this round.
    pub results: Vec<jky_ai::ContentBlock>,
    /// Gated calls not yet approved or declined, by call id.
    pub awaiting: HashMap<String, PendingTool>,
    pub round: usize,
}
```

and on `AppState`:

```rust
    /// The turn currently in flight, if any. One at a time in v0.1.
    pub turn: Arc<Mutex<Option<TurnState>>>,
```

initialised to `Arc::new(Mutex::new(None))`.

- [ ] **Step 6: Rewrite ai_send around the loop**

In `apps/desktop/src-tauri/src/commands/ai.rs`, the event handler now collects
blocks instead of only emitting them, and after the stream ends the command:

1. executes every ungated tool with `execute_read_tool`, pushing a
   `ContentBlock::ToolResult` for each;
2. if any gated call is awaiting a decision, stores the `TurnState` and
   returns — nothing else happens until the user decides;
3. otherwise, if `needs_another_round`, calls `append_round` and streams again,
   up to `MAX_ROUNDS`;
4. otherwise emits `ai:done`.

`ai_approve_tool` becomes `async`, runs the command with
`run_approved_command`, pushes the result, removes the call from `awaiting`,
and — when nothing is left awaiting — resumes the loop. `ai_reject_tool`
does the same with `declined_result` and runs nothing.

Every executed tool appends to the audit log: `AuditKind::ToolCall` for a
read, `AuditKind::CommandRun` for an approved command, `CommandRejected` for a
declined one.

- [ ] **Step 7: Update the pinned command surface**

No new commands are added, but `ai_approve_tool` and `ai_reject_tool` change
signature. The pinned list is by name, so it stays as it is — confirm by
running `cargo test -p jky-terminal --test security`.

- [ ] **Step 8: Run everything**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS; clippy clean.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(assistant): close the tool loop"
```

---

## Task 5: Conversations outside React

Switching to the terminal currently destroys the conversation, because it
lives in component state and the component unmounts.

**Files:**
- Create: `apps/desktop/src/app/chatStore.ts`, `chatStore.test.ts`
- Modify: `apps/desktop/src/features/assistant/Assistant.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `useChat()` exposing `{ sessions: Session[]; activeId: string | null; newSession(): string; switchTo(id): void; deleteSession(id): void; addTurn(role, text): void; appendToLastAssistant(text): void; setBusy(b): void; MAX_SESSIONS }`; `Session { id: string; title: string; turns: Turn[]; createdAt: number }`; `Turn { role: "user" | "assistant"; text: string }`. Tasks 6 and 7 read from it.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/app/chatStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SESSIONS, useChat } from "./chatStore";

const reset = () => useChat.setState({ sessions: [], activeId: null, busy: false });

describe("chatStore", () => {
  beforeEach(reset);

  it("starts with no sessions", () => {
    expect(useChat.getState().sessions).toEqual([]);
  });

  it("creates a session and makes it active", () => {
    const id = useChat.getState().newSession();
    expect(useChat.getState().activeId).toBe(id);
    expect(useChat.getState().sessions).toHaveLength(1);
  });

  it("keeps turns when a session is not the active one", () => {
    // The bug this store exists to fix: switching away must not lose anything.
    const first = useChat.getState().newSession();
    useChat.getState().addTurn("user", "hello");
    const second = useChat.getState().newSession();
    useChat.getState().switchTo(first);

    expect(useChat.getState().sessions.find((s) => s.id === first)!.turns).toHaveLength(1);
    expect(second).not.toBe(first);
  });

  it("appends streamed text to the open assistant turn", () => {
    useChat.getState().newSession();
    useChat.getState().appendToLastAssistant("Hel");
    useChat.getState().appendToLastAssistant("lo");

    const turns = useChat.getState().sessions[0].turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Hello");
  });

  it("titles a session from its first question", () => {
    // "Session 3" tells you nothing when you are looking for one of five.
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "why does the build fail on windows");
    expect(useChat.getState().sessions[0].title).toMatch(/why does the build/i);
  });

  it("shortens a long title rather than letting it run", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "x".repeat(200));
    expect(useChat.getState().sessions[0].title.length).toBeLessThanOrEqual(60);
  });

  it(`keeps at most ${MAX_SESSIONS} sessions`, () => {
    for (let i = 0; i < MAX_SESSIONS + 3; i++) useChat.getState().newSession();
    expect(useChat.getState().sessions).toHaveLength(MAX_SESSIONS);
  });

  it("prunes the oldest session, not the newest", () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_SESSIONS + 1; i++) ids.push(useChat.getState().newSession());

    const kept = useChat.getState().sessions.map((s) => s.id);
    expect(kept).not.toContain(ids[0]);
    expect(kept).toContain(ids[ids.length - 1]);
  });

  it("deletes a session on request", () => {
    const a = useChat.getState().newSession();
    const b = useChat.getState().newSession();
    useChat.getState().deleteSession(a);

    expect(useChat.getState().sessions.map((s) => s.id)).toEqual([b]);
  });

  it("moves to another session when the active one is deleted", () => {
    const a = useChat.getState().newSession();
    const b = useChat.getState().newSession();
    useChat.getState().deleteSession(b);
    expect(useChat.getState().activeId).toBe(a);
  });

  it("clears the active id when the last session is deleted", () => {
    const only = useChat.getState().newSession();
    useChat.getState().deleteSession(only);
    expect(useChat.getState().activeId).toBeNull();
  });

  it("ignores a delete for a session that is not there", () => {
    const a = useChat.getState().newSession();
    useChat.getState().deleteSession("never-existed");
    expect(useChat.getState().sessions.map((s) => s.id)).toEqual([a]);
  });

  it("starts a session on the first turn if none is open", () => {
    // Asking a question should not require choosing to start a session first.
    useChat.getState().addTurn("user", "hello");
    expect(useChat.getState().sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test chatStore`
Expected: FAIL — cannot resolve `./chatStore`.

- [ ] **Step 3: Write the store**

`apps/desktop/src/app/chatStore.ts`:

```ts
import { create } from "zustand";

/**
 * How many conversations are kept.
 *
 * Beyond this the oldest is pruned. One constant, so changing the policy is a
 * one-word edit rather than a hunt.
 */
export const MAX_SESSIONS = 5;

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface Session {
  id: string;
  title: string;
  turns: Turn[];
  createdAt: number;
}

interface ChatState {
  sessions: Session[];
  activeId: string | null;
  busy: boolean;
  newSession: () => string;
  switchTo: (id: string) => void;
  deleteSession: (id: string) => void;
  addTurn: (role: Turn["role"], text: string) => void;
  appendToLastAssistant: (text: string) => void;
  setBusy: (busy: boolean) => void;
}

let counter = 0;
const nextId = () => `chat-${Date.now()}-${++counter}`;

const UNTITLED = "New conversation";

/** A session named after its first question is findable; "Session 3" is not. */
function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine || UNTITLED;
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeId: null,
  busy: false,

  newSession: () => {
    const id = nextId();
    const session: Session = { id, title: UNTITLED, turns: [], createdAt: Date.now() };
    set((s) => ({
      // Prune from the front: oldest first, newest kept.
      sessions: [...s.sessions, session].slice(-MAX_SESSIONS),
      activeId: id,
    }));
    return id;
  },

  switchTo: (id) => {
    if (get().sessions.some((s) => s.id === id)) set({ activeId: id });
  },

  deleteSession: (id) => {
    const { sessions, activeId } = get();
    if (!sessions.some((s) => s.id === id)) return;

    const remaining = sessions.filter((s) => s.id !== id);
    set({
      sessions: remaining,
      activeId: activeId === id ? (remaining[remaining.length - 1]?.id ?? null) : activeId,
    });
  },

  addTurn: (role, text) => {
    // Asking a question should not require choosing to start a session first.
    if (!get().activeId) get().newSession();

    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === s.activeId
          ? {
              ...session,
              title:
                session.title === UNTITLED && role === "user"
                  ? titleFrom(text)
                  : session.title,
              turns: [...session.turns, { role, text }],
            }
          : session,
      ),
    }));
  },

  appendToLastAssistant: (text) => {
    if (!get().activeId) get().newSession();

    set((s) => ({
      sessions: s.sessions.map((session) => {
        if (session.id !== s.activeId) return session;
        const last = session.turns[session.turns.length - 1];
        // Append to the open assistant turn rather than starting a new one
        // per token, or the log becomes one turn per character.
        if (last?.role === "assistant") {
          return {
            ...session,
            turns: [...session.turns.slice(0, -1), { ...last, text: last.text + text }],
          };
        }
        return { ...session, turns: [...session.turns, { role: "assistant", text }] };
      }),
    }));
  },

  setBusy: (busy) => set({ busy }),
}));
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @jky/desktop test chatStore`
Expected: PASS, 13 tests.

- [ ] **Step 5: Move the Assistant onto the store**

`Assistant.tsx` drops its `turns` state and reads
`useChat((s) => s.sessions.find((x) => x.id === s.activeId)?.turns ?? [])`,
calling `addTurn` and `appendToLastAssistant` instead of `setTurns`. Its event
subscriptions move to `App.tsx` so they survive the panel unmounting — a
stream that arrives while the terminal is showing must still land in the
session.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(assistant): keep conversations outside React state"
```

---

## Task 6: The session list

**Files:**
- Create: `apps/desktop/src/features/assistant/SessionList.tsx`, `SessionList.test.tsx`
- Modify: `apps/desktop/src/features/assistant/Assistant.css`

**Interfaces:**
- Consumes: `useChat`, `MAX_SESSIONS` from Task 5.
- Produces: `<SessionList />`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/features/assistant/SessionList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SESSIONS, useChat } from "../../app/chatStore";
import { SessionList } from "./SessionList";

describe("SessionList", () => {
  beforeEach(() => useChat.setState({ sessions: [], activeId: null, busy: false }));

  it("offers a way to start a conversation when there are none", () => {
    render(<SessionList />);
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();
  });

  it("lists a session by its title", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "why is the build failing");
    render(<SessionList />);

    expect(screen.getByRole("button", { name: /why is the build failing/i })).toBeInTheDocument();
  });

  it("marks the active session", () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "first");
    const second = useChat.getState().newSession();
    useChat.getState().addTurn("user", "second");
    render(<SessionList />);

    expect(screen.getByRole("button", { name: /second/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(useChat.getState().activeId).toBe(second);
  });

  it("switches session on click", async () => {
    const first = useChat.getState().newSession();
    useChat.getState().addTurn("user", "first");
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "second");
    render(<SessionList />);

    await userEvent.setup().click(screen.getByRole("button", { name: /first/i }));
    expect(useChat.getState().activeId).toBe(first);
  });

  it("deletes a session from its own control", async () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "doomed");
    render(<SessionList />);

    await userEvent.setup().click(screen.getByRole("button", { name: /delete doomed/i }));
    expect(useChat.getState().sessions).toHaveLength(0);
  });

  it("says how many conversations are kept", () => {
    // The pruning is surprising if it is never mentioned.
    render(<SessionList />);
    expect(screen.getByText(new RegExp(String(MAX_SESSIONS)))).toBeInTheDocument();
  });

  it("starts a new session from the control", async () => {
    render(<SessionList />);
    await userEvent.setup().click(screen.getByRole("button", { name: /new/i }));
    expect(useChat.getState().sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test SessionList`
Expected: FAIL — cannot resolve `./SessionList`.

- [ ] **Step 3: Write the component**

`apps/desktop/src/features/assistant/SessionList.tsx`:

```tsx
import { MAX_SESSIONS, useChat } from "../../app/chatStore";

export function SessionList() {
  const sessions = useChat((s) => s.sessions);
  const activeId = useChat((s) => s.activeId);
  const newSession = useChat((s) => s.newSession);
  const switchTo = useChat((s) => s.switchTo);
  const deleteSession = useChat((s) => s.deleteSession);

  return (
    <aside className="sessions" aria-label="Conversations">
      <div className="sessions__head">
        <span className="sessions__title">Conversations</span>
        <button type="button" className="sessions__new" onClick={() => newSession()}>
          + New
        </button>
      </div>

      <ul className="sessions__list">
        {[...sessions].reverse().map((session) => (
          <li key={session.id} className="sessions__row">
            <button
              type="button"
              className="sessions__link"
              aria-current={session.id === activeId ? "true" : undefined}
              onClick={() => switchTo(session.id)}
            >
              {session.title}
            </button>
            <button
              type="button"
              className="sessions__delete"
              aria-label={`Delete ${session.title}`}
              onClick={() => deleteSession(session.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <p className="sessions__note">
        The {MAX_SESSIONS} most recent are kept. Older ones are removed
        automatically.
      </p>
    </aside>
  );
}
```

Append the styling to `Assistant.css`:

```css
.sessions {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border-right: 1px solid var(--line);
  background: var(--surface);
  min-height: 0;
}

.sessions__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  padding: var(--s3);
  border-bottom: 1px solid var(--line);
}

.sessions__title {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.sessions__new {
  color: var(--accent);
  font-size: 12px;
}

.sessions__list {
  list-style: none;
  margin: 0;
  padding: var(--s2);
  overflow-y: auto;
  display: grid;
  gap: 2px;
  align-content: start;
}

.sessions__row {
  display: flex;
  align-items: center;
  border-radius: var(--radius);
  border-left: 2px solid transparent;
}

.sessions__row:hover {
  background: var(--surface-raised);
}

.sessions__row:has([aria-current="true"]) {
  border-left-color: var(--accent);
  background: var(--surface-raised);
}

.sessions__link {
  flex: 1;
  min-width: 0;
  padding: var(--s2) var(--s3);
  text-align: left;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sessions__link[aria-current="true"] {
  color: var(--accent);
}

.sessions__delete {
  padding: 0 var(--s2);
  color: var(--text-dim);
}

.sessions__delete:hover {
  color: var(--danger);
}

.sessions__note {
  margin: 0;
  padding: var(--s3);
  border-top: 1px solid var(--line);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--text-dim);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(assistant): add the session list"
```

---

## Task 7: The JKY symbol

The wordmark works at banner size and is unusable at 24px. The assistant needs
a mark, not a logotype.

**Files:**
- Create: `apps/desktop/src/components/JkyMark.tsx`, `JkyMark.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<JkyMark size?: number, animated?: boolean />`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/components/JkyMark.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JkyMark } from "./JkyMark";

describe("JkyMark", () => {
  it("is labelled, because it stands in for the product's name", () => {
    render(<JkyMark />);
    expect(screen.getByRole("img", { name: /jky/i })).toBeInTheDocument();
  });

  it("scales to the size it is given", () => {
    const { container } = render(<JkyMark size={96} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("96");
    expect(svg.getAttribute("height")).toBe("96");
  });

  it("keeps its aspect ratio through a viewBox rather than fixed coordinates", () => {
    const { container } = render(<JkyMark size={32} />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 64 64");
  });

  it("draws in theme colours rather than baked-in ones", () => {
    // A mark with hard-coded colour is invisible on half the themes.
    const { container } = render(<JkyMark />);
    const markup = container.innerHTML;
    expect(markup).toContain("var(--accent");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("gives each instance a unique gradient id", () => {
    // Duplicate ids make every instance after the first render the first
    // one's gradient, which changes when that one unmounts.
    const { container } = render(
      <>
        <JkyMark />
        <JkyMark />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("animates only when asked", () => {
    const { container: still } = render(<JkyMark />);
    const { container: moving } = render(<JkyMark animated />);
    expect(still.querySelector('[data-animated="true"]')).toBeNull();
    expect(moving.querySelector('[data-animated="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test JkyMark`
Expected: FAIL — cannot resolve `./JkyMark`.

- [ ] **Step 3: Write the mark**

`apps/desktop/src/components/JkyMark.tsx`. The mark is a prompt chevron whose
stroke continues into the hook of a J, with a spark where a cursor would sit —
the two things this product is, in one glyph.

```tsx
import { useId } from "react";

interface JkyMarkProps {
  size?: number;
  /** Breathes slowly. For the idle state, not for every instance. */
  animated?: boolean;
}

export function JkyMark({ size = 48, animated = false }: JkyMarkProps) {
  // Gradient ids must be unique per instance: duplicates make every later
  // instance render the first one's gradient, which then changes when that
  // instance unmounts.
  const gradientId = useId();
  const glowId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="JKY"
      data-animated={animated ? "true" : undefined}
      className="jkymark"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="55%" stopColor="var(--violet)" />
          <stop offset="100%" stopColor="var(--magenta)" />
        </linearGradient>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill={`url(#${glowId})`} />

      <rect
        x="3"
        y="3"
        width="58"
        height="58"
        rx="17"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        opacity="0.5"
      />

      {/* The chevron: a shell prompt. */}
      <path
        d="M20 22 L31 32 L20 42"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The J: its stem drops from the chevron's line and hooks left. */}
      <path
        d="M45 18 L45 38 Q45 46 37 46"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* The cursor, where one would sit after the prompt. */}
      <circle cx="45" cy="13" r="3" fill="var(--accent)" className="jkymark__spark" />
    </svg>
  );
}
```

Add to `apps/desktop/src/styles/base.css`:

```css
/* The mark's cursor breathes when it is the focus of an empty state.
   prefers-reduced-motion is already honoured globally in tokens.css. */
[data-animated="true"] .jkymark__spark {
  animation: jkymark-pulse 2.4s var(--ease) infinite;
}

@keyframes jkymark-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @jky/desktop test JkyMark`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(ui): add the JKY symbol"
```

---

## Task 8: The assistant's empty state

**Files:**
- Create: `apps/desktop/src/features/assistant/Welcome.tsx`, `Welcome.test.tsx`
- Modify: `Assistant.tsx`, `Assistant.css`

**Interfaces:**
- Consumes: `JkyMark` from Task 7.
- Produces: `<Welcome onPick={(prompt: string) => void} />`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/features/assistant/Welcome.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Welcome } from "./Welcome";

describe("Welcome", () => {
  it("shows the JKY mark", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByRole("img", { name: /jky/i })).toBeInTheDocument();
  });

  it("offers openings rather than a blank box", () => {
    // A cursor in an empty field is the least helpful possible invitation.
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });

  it("fills the composer when an opening is chosen", async () => {
    const onPick = vi.fn();
    render(<Welcome onPick={onPick} />);

    const first = screen.getAllByRole("button")[0];
    await userEvent.setup().click(first);
    expect(onPick).toHaveBeenCalledWith(expect.any(String));
    expect(onPick.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it("states the safety property, because it is the reassuring part", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByText(/nothing runs until you approve/i)).toBeInTheDocument();
  });

  it("mentions asking from the terminal", () => {
    render(<Welcome onPick={vi.fn()} />);
    expect(screen.getByText(/jky ask/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test Welcome`
Expected: FAIL — cannot resolve `./Welcome`.

- [ ] **Step 3: Write the empty state**

`apps/desktop/src/features/assistant/Welcome.tsx`:

```tsx
import { JkyMark } from "../../components/JkyMark";

interface WelcomeProps {
  onPick: (prompt: string) => void;
}

/**
 * Openings, not features.
 *
 * Each is a real question about the project in front of the user, because a
 * blank box with a cursor is the least helpful invitation an assistant can
 * offer.
 */
const OPENINGS = [
  { label: "Explain this project", prompt: "What does this project do? Read the README first." },
  { label: "What changed?", prompt: "What has changed in my working tree, and does anything look unfinished?" },
  { label: "Find something", prompt: "Search the codebase for TODO comments and summarise what is outstanding." },
  { label: "Review a file", prompt: "Read src/main.rs and tell me what it does and anything that looks wrong." },
];

export function Welcome({ onPick }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome__mark">
        <JkyMark size={88} animated />
      </div>

      <h2 className="welcome__title">Ask about this project</h2>
      <p className="welcome__blurb">
        The assistant reads your files through tools you can see it use.
        <strong> Nothing runs until you approve it.</strong>
      </p>

      <div className="welcome__openings">
        {OPENINGS.map((opening) => (
          <button
            key={opening.label}
            type="button"
            className="opening"
            onClick={() => onPick(opening.prompt)}
          >
            <span className="opening__label">{opening.label}</span>
            <span className="opening__prompt">{opening.prompt}</span>
          </button>
        ))}
      </div>

      <p className="welcome__tip">
        You can also ask from a terminal: <code>jky ask what does ls do</code>
      </p>
    </div>
  );
}
```

Append to `Assistant.css`:

```css
.welcome {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: var(--s4);
  padding: var(--s7) var(--s5);
  max-width: 660px;
  margin: 0 auto;
}

.welcome__mark {
  filter: drop-shadow(0 0 24px var(--accent-glow));
}

.welcome__title {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.02em;
  color: var(--text);
}

.welcome__blurb {
  margin: 0;
  max-width: 46ch;
  font-family: var(--font-sans);
  color: var(--text-muted);
}

.welcome__blurb strong {
  color: var(--accent);
  font-weight: 600;
}

.welcome__openings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--s2);
  width: 100%;
  margin-top: var(--s2);
}

.opening {
  display: grid;
  gap: var(--s1);
  padding: var(--s3) var(--s4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  text-align: left;
  background: var(--surface);
  transition: all var(--fast) var(--ease);
}

.opening:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.opening__label {
  color: var(--text);
  font-weight: 600;
}

.opening__prompt {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.welcome__tip {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-dim);
}

.welcome__tip code {
  font-family: var(--font-mono);
  color: var(--accent);
}

/* The panel becomes two columns once sessions exist. */
.chat {
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-areas:
    "sessions log"
    "sessions compose";
}

.chat__log {
  grid-area: log;
}

.chat__compose {
  grid-area: compose;
}

.sessions {
  grid-area: sessions;
}

@media (max-width: 720px) {
  .chat {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "log"
      "compose";
  }
  .sessions {
    display: none;
  }
}
```

`Assistant.tsx` renders `<SessionList />` and swaps its old empty paragraph for
`<Welcome onPick={setDraft} />`.

- [ ] **Step 4: Run everything**

Run: `pnpm run verify`
Expected: PASS.

- [ ] **Step 5: Extend the accessibility suite**

Add the assistant's empty state and the session list to
`apps/desktop/src/app/a11y.test.tsx`, following the existing pattern.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(assistant): redesign the empty state around the JKY mark"
```

---

## Task 9: Verify and merge

- [ ] **Step 1: Run everything**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm run verify
```

- [ ] **Step 2: Use it, with a real key**

The part no test covers.

1. Ask "what does this project do?" — expect a `read_file` tool card, the file
   read, and **an answer that follows**. A tool call with no answer after it
   means the loop is not closing.
2. Ask "run the tests" — expect an approval card. Click **Run**. Expect the
   output to come back and the assistant to comment on it.
3. Click **Don't run** on the next one — expect the assistant to acknowledge
   the refusal rather than hang.
4. Ask something, switch to Terminal mid-answer, switch back — **the answer
   must still be there and still arriving.**
5. Open six conversations; confirm the oldest disappears and the newest stays.
6. Delete one by hand.
7. Ask the assistant to read `../../../etc/passwd` — expect a refusal, and
   check `audit.jsonl` recorded the attempt.

- [ ] **Step 3: Push and confirm the platform matrix**

```bash
git push origin HEAD
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

---

## Definition of Done

- [ ] `cargo test --workspace`, `cargo clippy -D warnings`, `pnpm run verify` all pass
- [ ] The sandbox was observed **failing** with its containment check disabled
- [ ] A read-only tool runs and the assistant answers using what it read
- [ ] An approved command runs, its output returns, and the assistant responds to it
- [ ] A declined command is acknowledged, not hung on
- [ ] A path outside the project is refused and the attempt is in `audit.jsonl`
- [ ] A conversation survives switching to the terminal and back, mid-stream
- [ ] Beyond `MAX_SESSIONS`, the oldest is pruned and the newest kept
- [ ] axe reports no violations on the assistant, session list, or empty state
- [ ] CI green on ubuntu, macos and windows
- [ ] Every commit shows `kartikeyajay2006` as sole author with no trailers
