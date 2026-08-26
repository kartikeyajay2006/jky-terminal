use crate::types::ToolSpec;

fn tool(name: &str, description: &str, schema: serde_json::Value) -> ToolSpec {
    ToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: schema,
    }
}

/// The tools the assistant may ask for in v0.1.
pub fn assistant_tools() -> Vec<ToolSpec> {
    vec![
        tool(
            "read_file",
            "Read a UTF-8 text file from the current project and return its contents.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to the project root"}
                },
                "required": ["path"]
            }),
        ),
        tool(
            "list_dir",
            "List the entries of a directory in the current project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory relative to the project root"}
                },
                "required": ["path"]
            }),
        ),
        tool(
            "git_status",
            "Show the working tree status of the current project.",
            serde_json::json!({"type": "object", "properties": {}}),
        ),
        tool(
            "search_codebase",
            "Search the project for a literal string and return matching lines with their file and line number.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Literal text to find"}
                },
                "required": ["query"]
            }),
        ),
        tool(
            "run_command",
            "Propose a shell command. The user is shown the exact command and must approve it before it runs.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to run"},
                    "reason": {"type": "string", "description": "Why this command is needed"}
                },
                "required": ["command", "reason"]
            }),
        ),
    ]
}

/// Read-only tools that may run without asking.
const UNGATED: &[&str] = &["read_file", "list_dir", "git_status", "search_codebase"];

/// Whether a tool needs the user to say yes first.
///
/// Fails closed: anything not explicitly known to be read-only is gated, so a
/// tool added later is safe by default rather than dangerous by default.
pub fn requires_approval(tool_name: &str) -> bool {
    !UNGATED.contains(&tool_name)
}

/// Command fragments that warrant more than a single click to confirm.
const DESTRUCTIVE: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "git push --force",
    "git push -f",
    "dd if=",
    "mkfs",
    "chmod -r 777",
    "chmod 777 /",
    "shutdown",
    "reboot",
    "> /dev/sd",
    ":(){",
    "del /f /s /q",
    "format c:",
];

/// Whether a command deserves type-to-confirm rather than click-to-confirm.
///
/// Substring matching over the whole command, deliberately. Inspecting only
/// the first word is the obvious approach and misses `ls && rm -rf /`.
pub fn is_destructive(command: &str) -> bool {
    let normalised = command.to_lowercase();
    let squeezed = normalised.split_whitespace().collect::<Vec<_>>().join(" ");
    DESTRUCTIVE.iter().any(|pattern| squeezed.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_toolset_covers_reading_the_project() {
        let names: Vec<String> = assistant_tools().into_iter().map(|t| t.name).collect();
        for expected in ["read_file", "list_dir", "git_status", "search_codebase", "run_command"] {
            assert!(names.contains(&expected.to_string()), "missing tool: {expected}");
        }
    }

    #[test]
    fn every_tool_declares_an_object_schema_with_a_description() {
        for tool in assistant_tools() {
            assert_eq!(tool.input_schema["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty(), "{} has no description", tool.name);
        }
    }

    #[test]
    fn running_a_command_always_requires_approval() {
        // Not "usually". The gate has no exceptions in v0.1 — an
        // always-allow toggle is where irreversible mistakes originate.
        assert!(requires_approval("run_command"));
    }

    #[test]
    fn reading_does_not_require_approval() {
        for read_only in ["read_file", "list_dir", "git_status", "search_codebase"] {
            assert!(!requires_approval(read_only), "{read_only} should not be gated");
        }
    }

    #[test]
    fn an_unknown_tool_requires_approval() {
        // Fail closed. A tool added later without updating this list must be
        // gated by default rather than silently ungated.
        assert!(requires_approval("some_future_tool"));
    }

    #[test]
    fn recognised_destructive_commands_escalate() {
        for cmd in [
            "rm -rf /",
            "rm -rf ~/projects",
            "git push --force origin main",
            "git push -f",
            "dd if=/dev/zero of=/dev/sda",
            "mkfs.ext4 /dev/sdb1",
            "chmod -R 777 /",
            "shutdown now",
            ":(){ :|:& };:",
        ] {
            assert!(is_destructive(cmd), "not flagged: {cmd}");
        }
    }

    #[test]
    fn ordinary_commands_do_not_escalate() {
        for cmd in ["ls -la", "git status", "cargo test", "npm run build", "cat README.md"] {
            assert!(!is_destructive(cmd), "wrongly flagged: {cmd}");
        }
    }

    #[test]
    fn detection_ignores_case_and_padding() {
        assert!(is_destructive("  RM -RF /tmp/x  "));
    }

    #[test]
    fn a_destructive_command_hidden_after_a_separator_is_still_caught() {
        // Checking only the first word is the obvious implementation and the
        // wrong one: `ls && rm -rf /` starts with `ls`.
        assert!(is_destructive("ls && rm -rf /"));
        assert!(is_destructive("echo hi; git push --force"));
        assert!(is_destructive("cat x | xargs rm -rf"));
    }

    #[test]
    fn extra_whitespace_between_words_does_not_hide_a_match() {
        // `rm   -rf` is the same command to a shell and must be to us too.
        assert!(is_destructive("rm    -rf   /tmp/x"));
    }
}
