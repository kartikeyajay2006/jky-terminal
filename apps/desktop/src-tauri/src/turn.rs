use jky_ai::{ContentBlock, Message, Role};

/// How many times the model may ask for tools within one user turn.
///
/// Without a ceiling, a model that keeps requesting tools spends money until
/// somebody notices.
pub const MAX_ROUNDS: usize = 8;

// Checked at compile time rather than in a test: the value is a constant, so
// a runtime assertion could never fail on a build that got this far.
const _: () = assert!(
    MAX_ROUNDS >= 3,
    "too few rounds to be useful — one read then an answer is two"
);
const _: () = assert!(
    MAX_ROUNDS <= 12,
    "too many rounds to be safe — each one is a paid request"
);

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
/// All results go in one user message. Splitting them across messages teaches
/// the model to stop making parallel calls.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_use(id: &str, name: &str) -> ContentBlock {
        ContentBlock::ToolUse {
            id: id.into(),
            name: name.into(),
            input: serde_json::json!({"path": "src/main.rs"}),
        }
    }

    fn result(id: &str, text: &str) -> ContentBlock {
        ContentBlock::ToolResult {
            tool_use_id: id.into(),
            content: text.into(),
            is_error: false,
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
        assert!(needs_another_round(&blocks, &[result("t1", "fn main() {}")]));
    }

    #[test]
    fn a_turn_that_asked_for_tools_but_ran_none_does_not_loop() {
        // That is the gated case: it waits for the user, it does not spin.
        let blocks = vec![tool_use("t1", "run_command")];
        assert!(!needs_another_round(&blocks, &[]));
    }

    #[test]
    fn the_assistant_turn_is_recorded_before_the_results() {
        // Sending results without the assistant turn that requested them is a
        // 400: the tool_use_id refers to nothing.
        let mut messages = vec![Message::user_text("hi")];
        append_round(&mut messages, vec![tool_use("t1", "read_file")], vec![result("t1", "ok")]);

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1].role, Role::Assistant);
        assert_eq!(messages[2].role, Role::User);
    }

    #[test]
    fn every_result_for_one_turn_goes_in_a_single_user_message() {
        // Splitting them across messages teaches the model to stop making
        // parallel calls.
        let mut messages = vec![Message::user_text("hi")];
        append_round(
            &mut messages,
            vec![tool_use("t1", "read_file"), tool_use("t2", "list_dir")],
            vec![result("t1", "a"), result("t2", "b")],
        );
        assert_eq!(messages[2].content.len(), 2);
    }

    #[test]
    fn a_declined_tool_still_returns_a_result_marked_as_an_error() {
        // Silence would leave the model waiting on a tool_use_id forever.
        match declined_result("t9") {
            ContentBlock::ToolResult { tool_use_id, is_error, content } => {
                assert_eq!(tool_use_id, "t9");
                assert!(is_error);
                assert!(content.to_lowercase().contains("declined"));
            }
            other => panic!("wrong block: {other:?}"),
        }
    }

}
