//! One question, one answer, when a command fails.
//!
//! Deliberately not `ai_send`. That command runs the assistant: a system
//! prompt, a tool loop, approval gates, and a turn held in `AppState` because
//! a gated tool has to be able to wait for a decision. None of that belongs
//! under a failed `git push`, and using it would also mean a suggestion in the
//! terminal and a conversation in the Assistant panel fighting over the one
//! turn slot.
//!
//! So: no tools, no turn state, no history. The prompt is built in the window
//! from what the terminal already has, sent once, and the answer comes back
//! whole.
//!
//! **The token policy lives here.** The offer that appears under a failed
//! command costs nothing — it is drawn from what the terminal already knows.
//! This is reached only when someone presses a button, the request is bounded
//! before it arrives, and the answer is cut off once it is long enough:
//! returning `false` from the stream callback drops the connection, which is
//! the only way to actually stop paying for words nobody asked for.

use jky_ai::{
    AIProvider, AnthropicProvider, ChatRequest, ContentBlock, Message, OLLAMA_CHAT_URL,
    OpenAiProvider, Role, StreamEvent,
};
use jky_audit::{AuditEvent, AuditKind};
use jky_secrets::{ProviderId, Secret};
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::state::AppState;

/// The longest answer worth waiting for under a failed command.
///
/// A terminal is not a chat window. Three sentences is the ask; this is the
/// point at which the connection is dropped whatever the model thinks it is
/// still doing.
const MAX_ANSWER: usize = 1200;

/// The longest question this will carry.
///
/// The window builds a bounded one, so this is the boundary refusing to
/// forward anything larger rather than a second opinion about what to send.
const MAX_PROMPT: usize = 4000;

/// A local runtime needs a key header and ignores what is in it.
const NO_KEY_NEEDED: &str = "ollama";

/// Ask one question and get one answer.
#[tauri::command]
pub async fn ai_ask_once(
    state: State<'_, AppState>,
    provider: String,
    prompt: String,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("there is nothing to ask".into());
    }
    if prompt.len() > MAX_PROMPT {
        return Err("that question is too long to send".into());
    }

    let model = state
        .settings
        .selected_model(&provider)
        .ok()
        .flatten()
        .ok_or("choose a model for this provider in Settings first")?;

    let request = ChatRequest {
        model,
        // Short and fixed. A long system prompt is a cost paid on every
        // question, and this one is asked from a terminal.
        system: "You help a developer read a failed shell command. Be brief \
                 and concrete. No pleasantries, no restating the question."
            .to_string(),
        messages: vec![Message {
            role: Role::User,
            content: vec![ContentBlock::Text { text: prompt }],
        }],
        // None. This answers a question; it does not do anything.
        tools: Vec::new(),
        max_tokens: 700,
    };

    let answer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let sink = answer.clone();

    let mut on_event = move |event: StreamEvent| -> bool {
        if let StreamEvent::TextDelta(text) = event {
            if let Ok(mut buffer) = sink.lock() {
                buffer.push_str(&text);
                // Stop reading. Dropping the connection here is the only way
                // to stop paying for an answer that has outstayed its use.
                return buffer.len() < MAX_ANSWER;
            }
        }
        true
    };

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::ProviderRequest,
        &format!("{provider}: one-shot advice for a failed command"),
    ));

    match provider.as_str() {
        NO_KEY_NEEDED => {
            OpenAiProvider::at(OLLAMA_CHAT_URL, Secret::new("local".to_string()))
                .stream_chat(request, &mut on_event)
                .await
                .map_err(|_| {
                    "Ollama did not answer. Is it running? (`ollama serve`)".to_string()
                })?
        }
        other => {
            let id = ProviderId::parse(other)
                .ok_or_else(|| format!("{other} is not a provider this can ask"))?;
            let key = state
                .secrets
                .get(other)
                .map_err(|_| format!("no key is stored for {other}"))?;

            let _ = state.audit.append(AuditEvent::new(
                AuditKind::SecretRead,
                &format!("{other} key read for one-shot advice"),
            ));

            match id {
                ProviderId::Anthropic => {
                    AnthropicProvider::new(Secret::new(key.expose().clone()))
                        .stream_chat(request, &mut on_event)
                        .await
                        .map_err(|e| e.to_string())?
                }
                ProviderId::OpenAi => OpenAiProvider::new(Secret::new(key.expose().clone()))
                    .stream_chat(request, &mut on_event)
                    .await
                    .map_err(|e| e.to_string())?,
                other => {
                    return Err(format!(
                        "{} has no adapter yet. Use Anthropic, OpenAI, or Ollama.",
                        other.display_name()
                    ))
                }
            }
        }
    }

    let text = answer
        .lock()
        .map_err(|_| "the answer was lost".to_string())?
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("the model returned nothing".into());
    }
    Ok(text)
}
