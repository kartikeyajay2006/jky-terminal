use crate::types::{ChatRequest, StreamEvent};

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("no API key is stored for this provider")]
    NoKey,
    #[error("the provider rejected the request: {0}")]
    Api(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("could not decode the response: {0}")]
    Decode(String),
}

/// A chat provider.
///
/// Two implementations ship in v0.1 (Anthropic and OpenAI). The trait exists
/// so adding a third is one new file rather than a refactor of every call site.
#[allow(async_fn_in_trait)]
pub trait AIProvider: Send + Sync {
    /// Stream a completion, invoking `on_event` for each decoded event.
    async fn stream_chat(
        &self,
        request: ChatRequest,
        on_event: &mut (dyn FnMut(StreamEvent) + Send),
    ) -> Result<(), AiError>;
}
