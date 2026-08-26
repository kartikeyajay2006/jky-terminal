use futures_util::StreamExt;
use jky_secrets::Secret;

use crate::provider::{AIProvider, AiError};
use crate::sse::SseDecoder;
use crate::types::{ChatRequest, Role, StreamEvent};

pub const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Build the request body.
///
/// Kept pure and separate from the HTTP call so the entire wire shape can be
/// asserted without a network or a key — which is where the 400s live.
pub fn build_body(request: &ChatRequest) -> serde_json::Value {
    // A trailing assistant message is a prefill, which current models reject
    // with a 400.
    let mut messages = request.messages.clone();
    while matches!(messages.last(), Some(m) if m.role == Role::Assistant) {
        messages.pop();
    }

    let mut body = serde_json::json!({
        "model": request.model,
        "max_tokens": request.max_tokens,
        "stream": true,
        "system": request.system,
        "messages": messages,
        // Adaptive thinking: the model decides depth. budget_tokens was
        // removed from current models and returns a 400.
        "thinking": { "type": "adaptive" },
        // effort is nested. At the top level it is silently ignored.
        "output_config": { "effort": "high" },
    });

    if !request.tools.is_empty() {
        body["tools"] = serde_json::to_value(&request.tools).unwrap_or(serde_json::Value::Null);
    }

    body
}

pub struct AnthropicProvider {
    api_key: Secret<String>,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(api_key: Secret<String>) -> Self {
        Self { api_key, client: reqwest::Client::new() }
    }
}

impl AIProvider for AnthropicProvider {
    async fn stream_chat(
        &self,
        request: ChatRequest,
        on_event: &mut (dyn FnMut(StreamEvent) -> bool + Send),
    ) -> Result<(), AiError> {
        let response = self
            .client
            .post(MESSAGES_URL)
            .header("x-api-key", self.api_key.expose())
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&build_body(&request))
            .send()
            .await
            .map_err(|e| AiError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            // The error body carries the provider's own explanation, which is
            // far more useful than the status alone. It never contains the key.
            let detail = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{status}: {detail}")));
        }

        let mut decoder = SseDecoder::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| AiError::Network(e.to_string()))?;
            let text = String::from_utf8_lossy(&bytes);
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
    use crate::types::{Message, ToolSpec};

    fn request() -> ChatRequest {
        ChatRequest {
            model: "claude-opus-5".into(),
            system: "You are helpful.".into(),
            messages: vec![Message::user_text("hi")],
            tools: vec![ToolSpec {
                name: "read_file".into(),
                description: "Read a file".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }],
            max_tokens: 64_000,
        }
    }

    #[test]
    fn the_body_streams() {
        assert_eq!(build_body(&request())["stream"], true);
    }

    #[test]
    fn the_body_carries_the_model_and_system_prompt() {
        let body = build_body(&request());
        assert_eq!(body["model"], "claude-opus-5");
        assert_eq!(body["system"], "You are helpful.");
    }

    #[test]
    fn thinking_is_adaptive() {
        assert_eq!(build_body(&request())["thinking"]["type"], "adaptive");
    }

    #[test]
    fn the_body_never_sends_budget_tokens() {
        // budget_tokens was removed from the current models and is rejected
        // with a 400. It is the single most likely thing to be carried over
        // from older example code.
        let body = build_body(&request());
        assert!(
            body["thinking"].get("budget_tokens").is_none(),
            "budget_tokens is rejected with a 400 on current models"
        );
    }

    #[test]
    fn effort_is_nested_inside_output_config() {
        // Top-level `effort` is silently ignored, which looks like the setting
        // having no effect rather than like an error.
        let body = build_body(&request());
        assert_eq!(body["output_config"]["effort"], "high");
        assert!(body.get("effort").is_none());
    }

    #[test]
    fn tools_are_sent_with_input_schema() {
        let body = build_body(&request());
        assert_eq!(body["tools"][0]["name"], "read_file");
        assert!(body["tools"][0].get("input_schema").is_some());
    }

    #[test]
    fn the_tools_key_is_omitted_when_there_are_none() {
        // An empty tools array is not the same as no tools; sending one asks
        // the model to consider a toolset that does not exist.
        let mut req = request();
        req.tools.clear();
        assert!(build_body(&req).get("tools").is_none());
    }

    #[test]
    fn the_last_message_is_never_from_the_assistant() {
        // Assistant prefill is rejected with a 400 on current models. Any
        // trailing assistant turn must be dropped before sending.
        let mut req = request();
        req.messages.push(Message {
            role: crate::types::Role::Assistant,
            content: vec![crate::types::ContentBlock::Text { text: "partial".into() }],
        });
        let body = build_body(&req);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.last().unwrap()["role"], "user");
    }

    #[test]
    fn the_endpoint_and_version_are_the_documented_ones() {
        assert_eq!(MESSAGES_URL, "https://api.anthropic.com/v1/messages");
        assert_eq!(ANTHROPIC_VERSION, "2023-06-01");
    }

    #[test]
    fn the_key_never_appears_in_the_request_body() {
        // The key belongs in a header. A body that carries it would be logged
        // by every proxy between here and the provider.
        let body = build_body(&request()).to_string();
        assert!(!body.contains("x-api-key"));
        assert!(!body.contains("sk-ant"));
    }
}
