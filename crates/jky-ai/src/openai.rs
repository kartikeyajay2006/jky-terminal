use std::collections::HashMap;

use futures_util::StreamExt;
use jky_secrets::Secret;

use crate::provider::{AIProvider, AiError};
use crate::sse::Utf8ChunkDecoder;
use crate::types::{ChatRequest, ContentBlock, Role, StreamEvent};

pub const CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

/// Ollama's OpenAI-compatible endpoint, on the machine this is running on.
///
/// Ollama speaks two protocols and this is the one that needs no second
/// adapter: the same request body, the same SSE framing, a different host. It
/// wants an API key header and ignores what is in it, which is the one place
/// a local runtime and a paid one differ here.
pub const OLLAMA_CHAT_URL: &str = "http://localhost:11434/v1/chat/completions";

/// Build the request body.
///
/// Differs from the Anthropic shape in four places, each of which fails
/// quietly rather than loudly if reversed: the system prompt is a message,
/// tools nest under `function` with `parameters`, there is no `thinking`
/// field, and there is no `output_config`.
pub fn build_openai_body(request: &ChatRequest) -> serde_json::Value {
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": request.system,
    })];

    for message in &request.messages {
        let text = message.content.iter().filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        }).collect::<Vec<_>>().join("\n");

        match message.role {
            Role::Assistant => {
                let calls: Vec<_> = message.content.iter().filter_map(|block| match block {
                    ContentBlock::ToolUse { id, name, input } => Some(serde_json::json!({
                        "id": id,
                        "type": "function",
                        "function": { "name": name, "arguments": input.to_string() },
                    })),
                    _ => None,
                }).collect();
                if !text.is_empty() || !calls.is_empty() {
                    let mut assistant = serde_json::json!({ "role": "assistant", "content": text });
                    if !calls.is_empty() { assistant["tool_calls"] = serde_json::Value::Array(calls); }
                    messages.push(assistant);
                }
            }
            Role::User => {
                if !text.is_empty() {
                    messages.push(serde_json::json!({ "role": "user", "content": text }));
                }
                // Tool results are a distinct OpenAI role, linked to the
                // preceding assistant call by tool_call_id. Flattening them
                // into user text breaks the provider's tool protocol.
                for block in &message.content {
                    if let ContentBlock::ToolResult { tool_use_id, content, .. } = block {
                        messages.push(serde_json::json!({
                            "role": "tool", "tool_call_id": tool_use_id, "content": content,
                        }));
                    }
                }
            }
        }
    }

    let mut body = serde_json::json!({
        "model": request.model,
        "max_tokens": request.max_tokens,
        "stream": true,
        "messages": messages,
    });

    if !request.tools.is_empty() {
        body["tools"] = serde_json::Value::Array(
            request
                .tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.input_schema,
                        }
                    })
                })
                .collect(),
        );
    }

    body
}

/// Incremental SSE decoder for the Chat Completions stream shape.
#[derive(Default)]
pub struct OpenAiSseDecoder {
    buffer: String,
    tool_ids: HashMap<usize, String>,
}

impl OpenAiSseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &str) -> Vec<StreamEvent> {
        self.buffer.push_str(&chunk.replace("\r\n", "\n"));

        let mut events = Vec::new();
        while let Some(idx) = self.buffer.find("\n\n") {
            let frame: String = self.buffer.drain(..idx + 2).collect();
            events.extend(self.decode_frame(&frame));
        }
        events
    }
}

fn tool_index(call: &serde_json::Value) -> Option<usize> {
    call.get("index")?.as_u64().map(|index| index as usize)
}

impl OpenAiSseDecoder {
fn decode_frame(&mut self, frame: &str) -> Vec<StreamEvent> {
    let Some(data) = frame.lines().find_map(|l| l.strip_prefix("data:")).map(str::trim) else {
        return Vec::new();
    };

    if data.is_empty() {
        return Vec::new();
    }
    if data == "[DONE]" {
        // OpenAI's explicit terminator. Anthropic has no equivalent.
        return vec![StreamEvent::Done { stop_reason: "stop".into() }];
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return Vec::new();
    };
    let Some(choice) = value.get("choices").and_then(|c| c.get(0)) else {
        return Vec::new();
    };

    let mut events = Vec::new();

    if let Some(delta) = choice.get("delta") {
        if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
            if !text.is_empty() {
                events.push(StreamEvent::TextDelta(text.to_string()));
            }
        }
        if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
            for call in calls {
                let Some(index) = tool_index(call) else { continue };
                let function = call.get("function");
                // A call announces itself with an id and a name, then streams
                // its arguments in later frames carrying neither.
                if let (Some(id), Some(name)) = (
                    call.get("id").and_then(|i| i.as_str()),
                    function.and_then(|f| f.get("name")).and_then(|n| n.as_str()),
                ) {
                    self.tool_ids.insert(index, id.to_string());
                    events.push(StreamEvent::ToolUseStart {
                        index,
                        id: id.to_string(),
                        name: name.to_string(),
                    });
                }
                if let Some(args) = function
                    .and_then(|f| f.get("arguments"))
                    .and_then(|a| a.as_str())
                {
                    if !args.is_empty() {
                        events.push(StreamEvent::ToolInputDelta { index, fragment: args.to_string() });
                    }
                }
            }
        }
    }

    if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
        for index in self.tool_ids.keys() {
            events.push(StreamEvent::BlockStop { index: *index });
        }
        self.tool_ids.clear();
        events.push(StreamEvent::Done { stop_reason: reason.to_string() });
    }

    events
}
}

pub struct OpenAiProvider {
    api_key: Secret<String>,
    url: String,
    client: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(api_key: Secret<String>) -> Self {
        Self::at(CHAT_COMPLETIONS_URL, api_key)
    }

    /// The same protocol, somewhere else.
    ///
    /// Exists for Ollama, which serves an OpenAI-compatible endpoint on this
    /// machine. A whole second adapter for a body and a stream format that
    /// are already implemented here would be two copies of one thing, and the
    /// second copy is the one that stops getting fixed.
    pub fn at(url: &str, api_key: Secret<String>) -> Self {
        Self {
            api_key,
            url: url.to_string(),
            client: reqwest::Client::new(),
        }
    }
}

impl AIProvider for OpenAiProvider {
    async fn stream_chat(
        &self,
        request: ChatRequest,
        on_event: &mut (dyn FnMut(StreamEvent) -> bool + Send),
    ) -> Result<(), AiError> {
        let response = self
            .client
            .post(&self.url)
            // Bearer, not x-api-key. The other spelling returns a 401 that
            // reads like a bad key rather than a bad header.
            .header("authorization", format!("Bearer {}", self.api_key.expose()))
            .header("content-type", "application/json")
            .json(&build_openai_body(&request))
            .send()
            .await
            .map_err(|e| AiError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{status}: {detail}")));
        }

        let mut decoder = OpenAiSseDecoder::new();
        let mut utf8 = Utf8ChunkDecoder::default();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| AiError::Network(e.to_string()))?;
            let text = utf8.push(&bytes);
            for event in decoder.push(&text) {
                if !on_event(event) {
                    // The caller asked to stop. Returning drops the response,
                    // which closes the connection rather than reading to the
                    // end and discarding it.
                    return Ok(());
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Message, StreamEvent, ToolSpec};

    fn request() -> ChatRequest {
        ChatRequest {
            model: "gpt-4o-mini".into(),
            system: "You are helpful.".into(),
            messages: vec![Message::user_text("hi")],
            tools: vec![ToolSpec {
                name: "read_file".into(),
                description: "Read a file".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }],
            max_tokens: 4096,
        }
    }

    #[test]
    fn the_system_prompt_is_the_first_message_not_a_top_level_field() {
        // Anthropic takes `system` at the top level; OpenAI takes a system
        // message. Sending the Anthropic shape here silently drops it.
        let body = build_openai_body(&request());
        assert!(body.get("system").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "You are helpful.");
    }

    #[test]
    fn the_body_streams() {
        assert_eq!(build_openai_body(&request())["stream"], true);
    }

    #[test]
    fn a_tool_uses_parameters_not_input_schema() {
        // The opposite of the Anthropic spelling. Getting this backwards
        // leaves the model with a tool it has no schema for.
        let body = build_openai_body(&request());
        let function = &body["tools"][0]["function"];
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(function["name"], "read_file");
        assert!(function.get("parameters").is_some());
        assert!(function.get("input_schema").is_none());
    }

    #[test]
    fn the_tools_key_is_omitted_when_there_are_none() {
        let mut req = request();
        req.tools.clear();
        assert!(build_openai_body(&req).get("tools").is_none());
    }

    #[test]
    fn tool_calls_and_results_keep_openais_required_linkage() {
        let mut req = request();
        req.messages = vec![
            Message {
                role: Role::Assistant,
                content: vec![ContentBlock::ToolUse {
                    id: "call_42".into(),
                    name: "read_file".into(),
                    input: serde_json::json!({"path": "src/main.rs"}),
                }],
            },
            Message {
                role: Role::User,
                content: vec![ContentBlock::ToolResult {
                    tool_use_id: "call_42".into(), content: "fn main() {}".into(), is_error: false,
                }],
            },
        ];
        let messages = build_openai_body(&req)["messages"].as_array().unwrap().to_vec();
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["tool_calls"][0]["id"], "call_42");
        assert_eq!(messages[1]["tool_calls"][0]["function"]["name"], "read_file");
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_42");
    }

    #[test]
    fn thinking_and_output_config_are_not_sent() {
        // Both are Anthropic-only. OpenAI rejects unknown top-level fields.
        let body = build_openai_body(&request());
        assert!(body.get("thinking").is_none());
        assert!(body.get("output_config").is_none());
    }

    #[test]
    fn the_endpoint_is_the_documented_one() {
        assert_eq!(CHAT_COMPLETIONS_URL, "https://api.openai.com/v1/chat/completions");
    }

    // The two constructors differ in exactly one thing, and it is the thing
    // that decides whether a request leaves this machine.
    #[test]
    fn the_default_endpoint_is_openai_and_the_other_one_is_local() {
        assert!(CHAT_COMPLETIONS_URL.starts_with("https://api.openai.com/"));
        assert!(OLLAMA_CHAT_URL.starts_with("http://localhost:"));
        assert!(OLLAMA_CHAT_URL.ends_with("/v1/chat/completions"), "not the compatible endpoint");
    }

    #[test]
    fn a_provider_built_for_ollama_posts_to_ollama() {
        let p = OpenAiProvider::at(OLLAMA_CHAT_URL, Secret::new("ignored".to_string()));
        assert_eq!(p.url, OLLAMA_CHAT_URL);
        assert_eq!(
            OpenAiProvider::new(Secret::new("k".to_string())).url,
            CHAT_COMPLETIONS_URL
        );
    }

    #[test]
    fn a_content_delta_becomes_a_text_event() {
        let frame = format!("data: {}\n\n", serde_json::json!({
            "choices": [{"index": 0, "delta": {"content": "Hi"}}]
        }));
        assert_eq!(
            OpenAiSseDecoder::new().push(&frame),
            vec![StreamEvent::TextDelta("Hi".into())]
        );
    }

    #[test]
    fn the_done_sentinel_ends_the_stream() {
        // OpenAI terminates with a literal [DONE]; Anthropic does not.
        assert_eq!(
            OpenAiSseDecoder::new().push("data: [DONE]\n\n"),
            vec![StreamEvent::Done { stop_reason: "stop".into() }]
        );
    }

    #[test]
    fn a_finish_reason_is_reported() {
        let frame = format!("data: {}\n\n", serde_json::json!({
            "choices": [{"delta": {}, "finish_reason": "tool_calls"}]
        }));
        assert_eq!(
            OpenAiSseDecoder::new().push(&frame),
            vec![StreamEvent::Done { stop_reason: "tool_calls".into() }]
        );
    }

    #[test]
    fn a_tool_call_start_is_reported_with_its_id_and_name() {
        let frame = format!("data: {}\n\n", serde_json::json!({
            "choices": [{"delta": {"tool_calls": [{
                "index": 0, "id": "call_1",
                "function": {"name": "read_file", "arguments": ""}
            }]}}]
        }));
        assert_eq!(
            OpenAiSseDecoder::new().push(&frame),
            vec![StreamEvent::ToolUseStart { index: 0, id: "call_1".into(), name: "read_file".into() }]
        );
    }

    #[test]
    fn tool_argument_fragments_are_surfaced_for_accumulation() {
        let frame = format!("data: {}\n\n", serde_json::json!({
            "choices": [{"delta": {"tool_calls": [{
                "index": 0, "function": {"arguments": "{\"pa"}
            }]}}]
        }));
        assert_eq!(
            OpenAiSseDecoder::new().push(&frame),
            vec![StreamEvent::ToolInputDelta { index: 0, fragment: "{\"pa".into() }]
        );
    }

    #[test]
    fn parallel_tool_call_fragments_keep_their_indices() {
        let mut decoder = OpenAiSseDecoder::new();
        let starts = format!("data: {}\n\n", serde_json::json!({"choices": [{"delta": {"tool_calls": [
            {"index": 0, "id": "call_a", "function": {"name": "read_file", "arguments": ""}},
            {"index": 1, "id": "call_b", "function": {"name": "list_dir", "arguments": ""}}
        ]}}]}));
        let fragments = format!("data: {}\n\n", serde_json::json!({"choices": [{"delta": {"tool_calls": [
            {"index": 1, "function": {"arguments": r#"{"path":"b"#}},
            {"index": 0, "function": {"arguments": r#"{"path":"a"#}}
        ]}}]}));
        let events = [decoder.push(&starts), decoder.push(&fragments)].concat();
        assert!(events.contains(&StreamEvent::ToolInputDelta { index: 0, fragment: "{\"path\":\"a".into() }));
        assert!(events.contains(&StreamEvent::ToolInputDelta { index: 1, fragment: "{\"path\":\"b".into() }));
    }

    #[test]
    fn a_frame_split_across_chunks_is_reassembled() {
        let mut d = OpenAiSseDecoder::new();
        assert!(d.push("data: {\"choices\":[{\"delta\":{\"cont").is_empty());
        assert_eq!(
            d.push("ent\":\"ok\"}}]}\n\n"),
            vec![StreamEvent::TextDelta("ok".into())]
        );
    }

    #[test]
    fn malformed_json_is_skipped_rather_than_aborting_the_stream() {
        let good = serde_json::json!({"choices": [{"delta": {"content": "ok"}}]});
        let input = format!("data: {{not json\n\ndata: {good}\n\n");
        assert_eq!(
            OpenAiSseDecoder::new().push(&input),
            vec![StreamEvent::TextDelta("ok".into())]
        );
    }

    #[test]
    fn an_empty_content_delta_emits_nothing() {
        // The first frame of a stream often carries an empty content string
        // alongside the role. Emitting it would prepend a blank token.
        let frame = format!("data: {}\n\n", serde_json::json!({
            "choices": [{"delta": {"role": "assistant", "content": ""}}]
        }));
        assert!(OpenAiSseDecoder::new().push(&frame).is_empty());
    }
}
