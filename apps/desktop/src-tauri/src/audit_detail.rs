//! What an audit entry says.
//!
//! Each entry already carries its kind, so the detail should not repeat it.
//! "read the openai key to send a request" under kind `SecretRead` says
//! "read", "key" and "request" three times over; `openai` says the one thing
//! the kind does not. These are read as a stream — in the app, or by anyone
//! who cats the JSONL beside it — and a stream is only scannable if each line
//! carries the part that differs.

use serde_json::Value;

/// The provider whose key was read.
pub fn secret_read(provider: &str) -> String {
    provider.to_string()
}

/// The model asked, and how much conversation went with it.
pub fn provider_request(provider: &str, model: &str, messages: usize) -> String {
    format!(
        "{provider}/{model} · {messages} msg{}",
        // "1 msgs" reads as a bug because it is one.
        if messages == 1 { "" } else { "s" }
    )
}

/// A tool call and its outcome: `read_file src/main.rs → ok`.
pub fn tool_ran(name: &str, input: &Value, is_error: bool) -> String {
    let arg = tool_arg(input);
    let outcome = if is_error { "error" } else { "ok" };
    if arg.is_empty() {
        format!("{name} → {outcome}")
    } else {
        format!("{name} {arg} → {outcome}")
    }
}

/// A tool call put to the user rather than run.
pub fn tool_proposed(name: &str, command: &str) -> String {
    format!("{name} {command}")
}

/// The command itself. The kind already says whether it ran or was declined.
pub fn command(command: &str) -> String {
    command.to_string()
}

/// The one argument worth showing for a tool call.
///
/// Every tool has a single argument that identifies what it acted on; the
/// rest is noise in a log line. Serialised JSON is what the old entries
/// showed, and `read_file {"path":"src/main.rs"} -> ok` buries the path in
/// punctuation.
fn tool_arg(input: &Value) -> String {
    for key in ["path", "query", "command"] {
        if let Some(v) = input.get(key).and_then(Value::as_str) {
            return v.to_string();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_key_read_names_only_the_provider() {
        assert_eq!(secret_read("openai"), "openai");
    }

    #[test]
    fn a_request_names_the_model_and_the_conversation_size() {
        assert_eq!(provider_request("openai", "gpt-4o", 3), "openai/gpt-4o · 3 msgs");
    }

    #[test]
    fn one_message_is_singular() {
        // "1 msgs" is the kind of detail that makes a log look unfinished.
        assert_eq!(provider_request("openai", "gpt-4o", 1), "openai/gpt-4o · 1 msg");
    }

    #[test]
    fn a_tool_call_shows_the_path_it_touched() {
        assert_eq!(
            tool_ran("read_file", &json!({"path": "src/main.rs"}), false),
            "read_file src/main.rs → ok",
        );
    }

    #[test]
    fn a_failed_tool_call_says_so() {
        assert_eq!(
            tool_ran("read_file", &json!({"path": "nope"}), true),
            "read_file nope → error",
        );
    }

    #[test]
    fn a_search_shows_its_query() {
        assert_eq!(
            tool_ran("search_codebase", &json!({"query": "fn main"}), false),
            "search_codebase fn main → ok",
        );
    }

    #[test]
    fn a_tool_with_no_arguments_still_reads_as_a_sentence() {
        // project_tree takes nothing; the line must not end up "tool  → ok".
        assert_eq!(tool_ran("project_tree", &json!({}), false), "project_tree → ok");
    }

    #[test]
    fn an_unrecognised_argument_shape_does_not_lose_the_tool_name() {
        assert_eq!(tool_ran("future_tool", &json!({"x": 1}), false), "future_tool → ok");
    }

    #[test]
    fn a_proposed_command_shows_the_command() {
        assert_eq!(tool_proposed("run_command", "cargo test"), "run_command cargo test");
    }

    #[test]
    fn a_run_or_declined_entry_is_just_the_command() {
        // The kind carries "ran" or "declined"; repeating it wastes the line.
        assert_eq!(command("rm -rf build"), "rm -rf build");
    }
}
