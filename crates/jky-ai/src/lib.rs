mod anthropic;
mod openai;
mod provider;
mod sse;
mod tools;
mod types;

pub use anthropic::{ANTHROPIC_VERSION, AnthropicProvider, MESSAGES_URL, build_body};
pub use openai::{CHAT_COMPLETIONS_URL, OpenAiProvider, OpenAiSseDecoder, build_openai_body};
pub use provider::{AIProvider, AiError};
pub use sse::SseDecoder;
pub use tools::{assistant_tools, is_destructive, requires_approval};
pub use types::{ChatRequest, ContentBlock, Message, Role, StreamEvent, ToolSpec};
