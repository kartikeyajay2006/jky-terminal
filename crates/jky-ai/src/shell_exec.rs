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

    let (program, flag) = if cfg!(windows) { ("cmd.exe", "/C") } else { ("/bin/sh", "-c") };

    let child = Command::new(program)
        .arg(flag)
        .arg(trimmed)
        .current_dir(root)
        // A command waiting on input would otherwise hang until the timeout.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            return ToolOutcome { text: format!("could not start the command: {e}"), is_error: true }
        }
    };

    // wait_with_output has no timeout, so the wait happens on a thread and the
    // deadline is enforced here.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let output = match rx.recv_timeout(timeout) {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return ToolOutcome { text: format!("the command failed: {e}"), is_error: true }
        }
        Err(_) => {
            return ToolOutcome {
                text: format!("the command timed out after {} seconds", timeout.as_secs().max(1)),
                is_error: true,
            }
        }
    };

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
    #[cfg(unix)]
    fn a_failing_command_returns_its_error_output_and_is_marked_failed() {
        // The model needs the stderr to know what to try next; marking it as
        // an error is what stops it treating the message as a result.
        let out = run("ls /definitely-not-a-real-directory");
        assert!(out.is_error);
        assert!(!out.text.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn the_exit_code_is_reported() {
        let out = run("exit 3");
        assert!(out.is_error);
        assert!(out.text.contains('3'), "exit code missing: {}", out.text);
    }

    #[test]
    #[cfg(unix)]
    fn a_command_producing_nothing_says_so_rather_than_returning_emptiness() {
        // An empty result reads as a broken tool.
        let out = run("true");
        assert!(!out.is_error);
        assert!(!out.text.trim().is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn output_larger_than_the_limit_is_truncated_and_announced() {
        let out = run("head -c 200000 /dev/zero | tr '\\0' 'x'");
        assert!(out.text.len() <= MAX_TOOL_OUTPUT + 200);
    }

    #[test]
    #[cfg(unix)]
    fn a_command_that_hangs_is_stopped_and_reported() {
        // Without this an approved `cat` with no input wedges the whole
        // conversation with no way back.
        let dir = TempDir::new().unwrap();
        let out = run_approved_command(dir.path(), "sleep 30", Duration::from_millis(300));
        assert!(out.is_error);
        assert!(out.text.to_lowercase().contains("timed out"));
    }

    #[test]
    #[cfg(unix)]
    fn a_command_waiting_on_input_does_not_hang_forever() {
        // stdin is null precisely so this returns instead of blocking.
        let dir = TempDir::new().unwrap();
        let out = run_approved_command(dir.path(), "cat", Duration::from_secs(5));
        assert!(!out.text.is_empty());
    }

    #[test]
    #[cfg(unix)]
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
