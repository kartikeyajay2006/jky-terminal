use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

/// One block of message content.
///
/// `#[serde(tag = "type")]` produces the wire shape the Messages API expects:
/// a `type` discriminator alongside the variant's own fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<ContentBlock>,
}

impl Message {
    pub fn user_text(text: &str) -> Self {
        Self {
            role: Role::User,
            content: vec![ContentBlock::Text { text: text.to_string() }],
        }
    }
}

/// A tool offered to the model.
///
/// The field is `input_schema`, not `parameters`. The other spelling belongs
/// to a different vendor and is ignored here, which leaves the model holding
/// a tool it has no schema for.
#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub max_tokens: u32,
}

/// A decoded streaming event, flattened to what a UI actually needs.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    TextDelta(String),
    ToolUseStart { id: String, name: String },
    /// A fragment of a tool's JSON arguments. Accumulate; parse at BlockStop.
    ToolInputDelta(String),
    BlockStop,
    Done { stop_reason: String },
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_message_serialises_to_the_wire_shape() {
        let msg = Message::user_text("hello");
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"][0]["type"], "text");
        assert_eq!(json["content"][0]["text"], "hello");
    }

    #[test]
    fn a_tool_result_serialises_with_its_call_id() {
        let msg = Message {
            role: Role::User,
            content: vec![ContentBlock::ToolResult {
                tool_use_id: "toolu_1".into(),
                content: "42".into(),
                is_error: false,
            }],
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["content"][0]["type"], "tool_result");
        assert_eq!(json["content"][0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn a_failed_tool_result_is_marked_as_an_error() {
        let block = ContentBlock::ToolResult {
            tool_use_id: "toolu_1".into(),
            content: "no such file".into(),
            is_error: true,
        };
        assert_eq!(serde_json::to_value(&block).unwrap()["is_error"], true);
    }

    #[test]
    fn a_tool_use_block_round_trips() {
        let json = serde_json::json!({
            "type": "tool_use",
            "id": "toolu_9",
            "name": "read_file",
            "input": {"path": "src/main.rs"}
        });
        let block: ContentBlock = serde_json::from_value(json).unwrap();
        match block {
            ContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "toolu_9");
                assert_eq!(name, "read_file");
                assert_eq!(input["path"], "src/main.rs");
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn a_tool_spec_serialises_with_input_schema_not_parameters() {
        // The Anthropic wire name is input_schema. `parameters` is the OpenAI
        // spelling and is silently ignored, leaving the model with a tool it
        // cannot call.
        let tool = ToolSpec {
            name: "read_file".into(),
            description: "Read a file".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_value(&tool).unwrap();
        assert!(json.get("input_schema").is_some());
        assert!(json.get("parameters").is_none());
    }
}
