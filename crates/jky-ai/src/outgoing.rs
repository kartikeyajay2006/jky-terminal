//! What leaves for a provider has its secrets removed first.
//!
//! A conversation is exactly where a token ends up: a pasted `curl` line, a
//! `.env` the model was asked to read, a command whose output echoed a
//! header. Everything here runs in Rust on the way out, so a window that
//! forgets to ask still cannot send a recognisable secret.
//!
//! What is redacted is what *this machine* contributed — your messages and
//! tool results. The assistant's own words came from the provider and are
//! sent back as they were.

use crate::exec::ToolOutcome;
use crate::types::{ContentBlock, Message, Role};

/// Redact one block, returning how many secrets were removed.
fn redact_block(block: &mut ContentBlock, role: Role) -> usize {
    let text = match block {
        ContentBlock::Text { text } if role == Role::User => text,
        ContentBlock::ToolResult { content, .. } => content,
        _ => return 0,
    };
    let clean = jky_redact::redact(text);
    if clean.removed.is_empty() {
        return 0;
    }
    *text = clean.text;
    clean.removed.len()
}

/// Redact every message on its way out.
///
/// Returns how many secrets were removed from the **newest** message — the
/// one just written. Earlier messages are redacted again (it is idempotent,
/// and costs little) but were reported when they were first sent, so
/// counting them again would announce the same secret every turn.
pub fn redact_outgoing(messages: &mut [Message]) -> usize {
    let newest = messages.len().saturating_sub(1);
    let mut reported = 0;
    for (i, message) in messages.iter_mut().enumerate() {
        let role = message.role;
        let removed: usize = message
            .content
            .iter_mut()
            .map(|block| redact_block(block, role))
            .sum();
        if i == newest {
            reported = removed;
        }
    }
    reported
}

impl ToolOutcome {
    /// This outcome with its secrets removed, and how many there were.
    ///
    /// Applied before the result is shown, audited or sent: a tool's output
    /// is something this machine produced, and the model does not need a
    /// key's value to help with the file it was in.
    pub fn redacted(self) -> (Self, usize) {
        let clean = jky_redact::redact(&self.text);
        let count = clean.removed.len();
        (Self { text: clean.text, is_error: self.is_error }, count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Assembled at run time so the repository scan, which looks for key
    // shapes in the source, does not mistake a fixture for a leaked key.
    fn key() -> String {
        format!("sk-ant-{}", "api03-AbCdEfGhIjKlMnOpQrStUvWx")
    }

    fn user(text: &str) -> Message {
        Message::user_text(text)
    }

    fn text_of(message: &Message) -> &str {
        match &message.content[0] {
            ContentBlock::Text { text } => text,
            ContentBlock::ToolResult { content, .. } => content,
            other => panic!("unexpected block {other:?}"),
        }
    }

    #[test]
    fn a_key_in_your_message_never_leaves_and_is_counted() {
        let mut messages = vec![user(&format!("why does curl -H 'x-api-key: {}' fail?", key()))];
        assert_eq!(redact_outgoing(&mut messages), 1);
        assert!(!text_of(&messages[0]).contains(&key()));
        assert!(text_of(&messages[0]).contains("[redacted"));
    }

    #[test]
    fn a_key_in_an_earlier_message_is_still_removed_but_not_announced_again() {
        let mut messages = vec![
            user(&format!("my key is {}", key())),
            Message { role: Role::Assistant, content: vec![ContentBlock::Text { text: "noted".into() }] },
            user("and now?"),
        ];
        assert_eq!(redact_outgoing(&mut messages), 0);
        assert!(!text_of(&messages[0]).contains(&key()));
    }

    #[test]
    fn a_tool_result_is_redacted_whoever_carries_it() {
        let mut messages = vec![Message {
            role: Role::User,
            content: vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: format!("ANTHROPIC_API_KEY={}\nDEBUG=1", key()),
                is_error: false,
            }],
        }];
        assert_eq!(redact_outgoing(&mut messages), 1);
        let text = text_of(&messages[0]);
        assert!(!text.contains(&key()));
        assert!(text.contains("DEBUG=1"), "the rest of the file survives: {text}");
    }

    #[test]
    fn the_assistants_own_words_are_sent_back_as_they_were() {
        let said = format!("you pasted {} earlier", key());
        let mut messages = vec![Message {
            role: Role::Assistant,
            content: vec![ContentBlock::Text { text: said.clone() }],
        }];
        assert_eq!(redact_outgoing(&mut messages), 0);
        assert_eq!(text_of(&messages[0]), said);
    }

    #[test]
    fn a_tool_outcome_reports_what_it_removed() {
        let outcome = ToolOutcome { text: format!("token {}", key()), is_error: false };
        let (clean, count) = outcome.redacted();
        assert_eq!(count, 1);
        assert!(!clean.text.contains(&key()));
        assert!(!clean.is_error);
    }

    #[test]
    fn ordinary_text_is_left_exactly_alone() {
        let mut messages = vec![user("explain src/main.rs line 40")];
        assert_eq!(redact_outgoing(&mut messages), 0);
        assert_eq!(text_of(&messages[0]), "explain src/main.rs line 40");
    }
}
