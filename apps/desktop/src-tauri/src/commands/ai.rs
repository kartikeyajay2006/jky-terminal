use std::sync::{Arc, Mutex};

use jky_ai::{
    AIProvider, AnthropicProvider, ChatRequest, Message, OpenAiProvider, StreamEvent,
    assistant_tools, is_destructive, requires_approval,
};
use jky_audit::{AuditEvent, AuditKind, AuditLog};
use jky_secrets::{ProviderId, Secret, SecretStore};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, PendingTool};

const SYSTEM_PROMPT: &str = "\
You are the assistant inside JKY Terminal, a developer's terminal application.
You can read the user's project through tools. You cannot run any command
yourself — proposing one shows it to the user for approval, and they may
decline. Be concise: this output is read in a terminal pane, not a chat app.";

#[derive(Clone, Serialize)]
struct ToolRequest {
    id: String,
    name: String,
    command: String,
    reason: String,
    destructive: bool,
}

/// Read the stored key for a provider.
///
/// Split out so the failure paths are testable without a network. The error
/// is built from the provider name only and never from the key.
pub(crate) fn resolve_key(
    store: &dyn SecretStore,
    provider: &str,
) -> Result<Secret<String>, String> {
    let id = ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    store.get(id.as_key()).map_err(|_| {
        format!(
            "no API key stored for {}. Add one in Providers.",
            id.display_name()
        )
    })
}

/// Build the event handler that turns stream events into UI events.
///
/// Extracted so `ai_send` reads as a sequence rather than a wall, and so the
/// parking logic — the part that must never be bypassed — sits in one place.
fn make_handler(
    app: AppHandle,
    audit: Arc<AuditLog>,
    pending: Arc<Mutex<std::collections::HashMap<String, PendingTool>>>,
) -> impl FnMut(StreamEvent) + Send {
    // A tool's arguments arrive as JSON fragments and are only parseable once
    // its block stops, so both are accumulated across events.
    let mut current_tool: Option<(String, String)> = None;
    let mut tool_json = String::new();

    move |event: StreamEvent| match event {
        StreamEvent::TextDelta(text) => {
            let _ = app.emit("ai:delta", text);
        }
        StreamEvent::ToolUseStart { id, name } => {
            current_tool = Some((id, name));
            tool_json.clear();
        }
        StreamEvent::ToolInputDelta(fragment) => tool_json.push_str(&fragment),
        StreamEvent::BlockStop => {
            let Some((id, name)) = current_tool.take() else {
                return;
            };
            let input: serde_json::Value =
                serde_json::from_str(&tool_json).unwrap_or(serde_json::Value::Null);
            let command = input
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            let reason = input
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or_default()
                .to_string();

            let _ = audit.append(AuditEvent::new(
                AuditKind::ToolCall,
                &format!("{name}: {command}"),
            ));

            if requires_approval(&name) {
                // Parked, not executed. Nothing runs until the user says so,
                // and that decision is enforced here rather than in the UI.
                if let Ok(mut map) = pending.lock() {
                    map.insert(
                        id.clone(),
                        PendingTool { name: name.clone(), command: command.clone() },
                    );
                }
                let _ = app.emit(
                    "ai:tool_request",
                    ToolRequest {
                        id,
                        name,
                        destructive: is_destructive(&command),
                        command,
                        reason,
                    },
                );
            }
        }
        StreamEvent::Done { stop_reason } => {
            let _ = app.emit("ai:done", stop_reason);
        }
        StreamEvent::Error(message) => {
            let _ = app.emit("ai:error", message);
        }
    }
}

#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    conversation: Vec<Message>,
) -> Result<(), String> {
    // Everything is pulled out of state before the first await: a borrow held
    // across one would make the future non-Send.
    let id = ProviderId::parse(&provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    let key = resolve_key(state.secrets.as_ref(), &provider)?;
    let audit = state.audit.clone();
    let pending = state.pending_tools.clone();
    let model = state
        .settings
        .selected_model(&provider)
        .ok()
        .flatten()
        .unwrap_or_else(|| id.default_model().to_string());

    let _ = audit.append(AuditEvent::new(
        AuditKind::SecretRead,
        &format!("read the {provider} key to send a request"),
    ));
    let _ = audit.append(AuditEvent::new(
        AuditKind::ProviderRequest,
        &format!("{provider} / {model}: {} messages", conversation.len()),
    ));

    let request = ChatRequest {
        model,
        system: SYSTEM_PROMPT.to_string(),
        messages: conversation,
        tools: assistant_tools(),
        max_tokens: 64_000,
    };

    let mut handler = make_handler(app, audit, pending);

    match id {
        ProviderId::Anthropic => AnthropicProvider::new(key)
            .stream_chat(request, &mut handler)
            .await
            .map_err(|e| e.to_string()),
        ProviderId::OpenAi => OpenAiProvider::new(key)
            .stream_chat(request, &mut handler)
            .await
            .map_err(|e| e.to_string()),
        other => Err(format!(
            "{} is in the key vault but has no adapter yet. Use Anthropic or OpenAI.",
            other.display_name()
        )),
    }
}

#[tauri::command]
pub fn ai_approve_tool(state: State<'_, AppState>, call_id: String) -> Result<(), String> {
    let pending = state
        .pending_tools
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&call_id)
        .ok_or_else(|| format!("no pending tool call '{call_id}'"))?;

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::CommandRun,
        &format!("approved {}: {}", pending.name, pending.command),
    ));
    Ok(())
}

#[tauri::command]
pub fn ai_reject_tool(state: State<'_, AppState>, call_id: String) -> Result<(), String> {
    let pending = state
        .pending_tools
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&call_id);

    if let Some(tool) = pending {
        let _ = state.audit.append(AuditEvent::new(
            AuditKind::CommandRejected,
            &format!("declined {}: {}", tool.name, tool.command),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn audit_read(state: State<'_, AppState>) -> Result<Vec<AuditEvent>, String> {
    state.audit.read_all().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_secrets::MemoryStore;

    #[test]
    fn sending_without_a_stored_key_reports_it_clearly() {
        let store = MemoryStore::new();
        let err = resolve_key(&store, "anthropic").unwrap_err();
        assert!(
            err.to_lowercase().contains("key"),
            "the message should tell the user to add a key: {err}"
        );
        assert!(err.contains("Providers"), "and where to add it: {err}");
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let store = MemoryStore::new();
        assert!(resolve_key(&store, "skynet").is_err());
    }

    #[test]
    fn the_error_shown_to_the_user_never_contains_the_key() {
        let store = MemoryStore::new();
        let key = format!("sk-ant-api03-CANARY{}", "x".repeat(40));
        store.set("anthropic", Secret::new(key)).unwrap();

        // The failure path under test is a different provider, so the error is
        // built while a real key sits in the store next to it.
        let err = resolve_key(&store, "openai").unwrap_err();
        assert!(!err.contains("CANARY"));
    }

    #[test]
    fn a_read_only_tool_runs_without_approval() {
        assert!(!requires_approval("read_file"));
    }

    #[test]
    fn running_a_command_is_never_ungated() {
        assert!(requires_approval("run_command"));
    }
}
