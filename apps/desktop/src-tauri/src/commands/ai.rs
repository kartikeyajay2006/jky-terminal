use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use jky_ai::{
    AIProvider, AnthropicProvider, ChatRequest, ContentBlock, Message, OpenAiProvider,
    StreamEvent, OLLAMA_CHAT_URL, assistant_tools, command_risk, execute_read_tool, is_destructive, requires_approval,
    run_approved_command, COMMAND_TIMEOUT,
};
use jky_audit::{AuditEvent, AuditKind, AuditLog};
use jky_pty::{expand_tilde, home_dir};
use jky_secrets::{ProviderId, Secret, SecretStore};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, PendingTool, TurnState};
use crate::audit_detail;
use crate::turn::{MAX_ROUNDS, append_round, declined_result, needs_another_round};

const SYSTEM_PROMPT: &str = "\
You are the assistant inside JKY Terminal, a developer's terminal application.
You can read the user's project through tools. You cannot run any command
yourself — proposing one shows it to the user for approval, and they may
decline. Prefer reading a file over guessing at its contents. Be concise:
this output is read in a terminal pane, not a chat app.";

#[derive(Clone, Serialize)]
struct ToolRequest {
    id: String,
    name: String,
    command: String,
    reason: String,
    destructive: bool,
    risk: String,
}

#[derive(Clone, Serialize)]
struct ToolRan {
    id: String,
    name: String,
    summary: String,
    is_error: bool,
}

/// Everything the loop needs that does not change between rounds.
struct Ctx {
    app: AppHandle,
    key: Secret<String>,
    provider: ProviderId,
    model: String,
    audit: Arc<AuditLog>,
    slot: Arc<Mutex<Option<TurnState>>>,
    cancelled: Arc<AtomicBool>,
    root: PathBuf,
}

/// Read the stored key for a provider.
///
/// Split out so the failure paths are testable without a network. The error is
/// built from the provider name only and never from the key.
pub(crate) fn resolve_key(
    store: &dyn SecretStore,
    provider: &str,
) -> Result<Secret<String>, String> {
    let id = ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    store.get(id.as_key()).map_err(|_| {
        format!(
            "no API key stored for {}. Add one in Settings, Providers.",
            id.display_name()
        )
    })
}

/// Stream one round, returning the blocks the assistant produced.
///
/// Text is emitted as it arrives; tool blocks are collected because their
/// arguments only become parseable when the block stops.
async fn stream_round(ctx: &Ctx, messages: Vec<Message>) -> Result<Vec<ContentBlock>, String> {
    let request = ChatRequest {
        model: ctx.model.clone(),
        system: SYSTEM_PROMPT.to_string(),
        messages,
        tools: assistant_tools(),
        max_tokens: ctx.provider.max_output_tokens(),
    };

    // Shared rather than captured by value: the closure needs to write and the
    // caller needs to read once the stream is done.
    let blocks: Arc<Mutex<Vec<ContentBlock>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = blocks.clone();
    let app = ctx.app.clone();

    // Provider stream indices are stable within one response. Keeping each
    // call separate prevents parallel OpenAI calls from overwriting each
    // other's arguments.
    let mut open_tools: HashMap<usize, (String, String, String)> = HashMap::new();

    let cancelled = ctx.cancelled.clone();
    let mut on_event = move |event: StreamEvent| -> bool {
        if cancelled.load(Ordering::Relaxed) {
            return false;
        }
        match event {
        StreamEvent::TextDelta(text) => {
            if let Ok(mut b) = sink.lock() {
                match b.last_mut() {
                    Some(ContentBlock::Text { text: existing }) => existing.push_str(&text),
                    _ => b.push(ContentBlock::Text { text: text.clone() }),
                }
            }
            let _ = app.emit("ai:delta", text);
        }
        StreamEvent::ToolUseStart { index, id, name } => {
            open_tools.insert(index, (id, name, String::new()));
        }
        StreamEvent::ToolInputDelta { index, fragment } => {
            if let Some((_, _, json)) = open_tools.get_mut(&index) {
                json.push_str(&fragment);
            }
        }
        StreamEvent::BlockStop { index } => {
            if let Some((id, name, json)) = open_tools.remove(&index) {
                let input = serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
                if let Ok(mut b) = sink.lock() {
                    b.push(ContentBlock::ToolUse { id, name, input });
                }
            }
        }
            StreamEvent::Done { .. } => {}
            StreamEvent::Error(message) => {
                let _ = app.emit("ai:error", message);
            }
        }
        true
    };

    match ctx.provider {
        ProviderId::Anthropic => AnthropicProvider::new(Secret::new(ctx.key.expose().clone()))
            .stream_chat(request, &mut on_event)
            .await
            .map_err(|e| e.to_string())?,
        ProviderId::OpenAi => OpenAiProvider::new(Secret::new(ctx.key.expose().clone()))
            .stream_chat(request, &mut on_event)
            .await
            .map_err(|e| e.to_string())?,
        ProviderId::Ollama => OpenAiProvider::at(OLLAMA_CHAT_URL, Secret::new(String::new()))
            .stream_chat(request, &mut on_event)
            .await
            .map_err(|e| e.to_string())?,
        other => {
            return Err(format!(
                "{} is in the key vault but has no adapter yet. Use Anthropic or OpenAI.",
                other.display_name()
            ))
        }
    }

    let collected = blocks.lock().map_err(|e| e.to_string())?.clone();
    Ok(collected)
}

/// Drive a turn to completion, or until a gated tool needs a decision.
///
/// The loop is what makes tools mean anything: a result that never goes back
/// leaves the model having asked a question it never hears the answer to.
async fn drive(ctx: Ctx, mut turn: TurnState) -> Result<(), String> {
    loop {
        if ctx.cancelled.load(Ordering::Relaxed) {
            if let Ok(mut slot) = ctx.slot.lock() {
                *slot = None;
            }
            let _ = ctx.app.emit("ai:done", "cancelled");
            return Ok(());
        }
        if turn.round >= MAX_ROUNDS {
            let _ = ctx.app.emit(
                "ai:error",
                format!("stopped after {MAX_ROUNDS} rounds of tool use"),
            );
            let _ = ctx.app.emit("ai:done", "max_rounds");
            return Ok(());
        }
        turn.round += 1;

        let blocks = stream_round(&ctx, turn.messages.clone()).await?;

        turn.assistant_blocks = blocks.clone();
        turn.results.clear();
        turn.awaiting.clear();

        for block in &blocks {
            let ContentBlock::ToolUse { id, name, input } = block else {
                continue;
            };

            if requires_approval(name) {
                // Parked, not executed. The decision is enforced here rather
                // than in the UI, so a renderer that declines to show a dialog
                // cannot run anything.
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

                let _ = ctx.audit.append(AuditEvent::new(
                    AuditKind::ToolCall,
                    &audit_detail::tool_proposed(name, &command),
                ));

                turn.awaiting.insert(
                    id.clone(),
                    PendingTool { name: name.clone(), command: command.clone() },
                );
                let _ = ctx.app.emit(
                    "ai:tool_request",
                    ToolRequest {
                        id: id.clone(),
                        name: name.clone(),
                        destructive: is_destructive(&command),
                        risk: command_risk(&command).to_string(),
                        command,
                        reason,
                    },
                );
                continue;
            }

            let outcome = execute_read_tool(&ctx.root, name, input);
            let _ = ctx.audit.append(AuditEvent::new(
                AuditKind::ToolCall,
                &audit_detail::tool_ran(name, input, outcome.is_error),
            ));
            let _ = ctx.app.emit(
                "ai:tool_ran",
                ToolRan {
                    id: id.clone(),
                    name: name.clone(),
                    summary: summarise(&outcome.text),
                    is_error: outcome.is_error,
                },
            );
            turn.results.push(ContentBlock::ToolResult {
                tool_use_id: id.clone(),
                content: outcome.text,
                is_error: outcome.is_error,
            });
        }

        if !turn.awaiting.is_empty() {
            // Park the turn and stop. Approving or declining resumes it.
            if let Ok(mut slot) = ctx.slot.lock() {
                *slot = Some(turn);
            }
            return Ok(());
        }

        if !needs_another_round(&turn.assistant_blocks, &turn.results) {
            if let Ok(mut slot) = ctx.slot.lock() {
                *slot = None;
            }
            let _ = ctx.app.emit("ai:done", "end_turn");
            return Ok(());
        }

        append_round(
            &mut turn.messages,
            std::mem::take(&mut turn.assistant_blocks),
            std::mem::take(&mut turn.results),
        );
    }
}

/// A one-line description of a tool's output, for the transcript.
fn summarise(text: &str) -> String {
    let lines = text.lines().count();
    let first = text.lines().next().unwrap_or("").trim();
    if lines <= 1 {
        first.chars().take(120).collect()
    } else {
        format!("{} lines", lines)
    }
}

fn build_ctx(app: &AppHandle, state: &AppState, provider: &str) -> Result<Ctx, String> {
    let id = ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))?;
    // Local Ollama deliberately has no credential. Do not touch the secret
    // store for it: a missing key must not prevent a local model from running.
    let key = if id.requires_key() {
        resolve_key(state.secrets.as_ref(), provider)?
    } else {
        Secret::new(String::new())
    };
    let model = state
        .settings
        .selected_model(provider)
        .ok()
        .flatten()
        .unwrap_or_else(|| id.default_model().to_string());

    Ok(Ctx {
        app: app.clone(),
        key,
        provider: id,
        model,
        audit: state.audit.clone(),
        slot: state.turn.clone(),
        cancelled: state.cancelled.clone(),
        // AI file tools need an explicit project boundary. Falling back to a
        // home directory makes an apparently project-scoped assistant able to
        // read unrelated personal files. The terminal may still start in the
        // home directory; only AI tools require this deliberate setting.
        root: {
            let configured = state
                .settings
                .terminal_start_dir()
                .map_err(|e| e.to_string())?
                .filter(|path| !path.trim().is_empty())
                .ok_or("choose a project folder in Settings → Terminal before using AI tools")?;
            let root = expand_tilde(&configured, home_dir().as_deref());
            if !root.is_dir() {
                return Err("the configured AI project folder does not exist".into());
            }
            root.canonicalize().map_err(|e| e.to_string())?
        },
    })
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
    let ctx = build_ctx(&app, &state, &provider)?;
    {
        let mut active = state.ai_active.lock().map_err(|e| e.to_string())?;
        if *active {
            return Err("an AI turn is already in progress; finish or cancel it first".into());
        }
        *active = true;
    }

    let _ = ctx.audit.append(AuditEvent::new(
        AuditKind::SecretRead,
        &audit_detail::secret_read(&provider),
    ));
    let _ = ctx.audit.append(AuditEvent::new(
        AuditKind::ProviderRequest,
        &audit_detail::provider_request(&provider, &ctx.model, conversation.len()),
    ));

    state.cancelled.store(false, Ordering::Relaxed);

    let turn = TurnState {
        provider,
        messages: conversation,
        assistant_blocks: Vec::new(),
        results: Vec::new(),
        awaiting: HashMap::new(),
        round: 0,
    };

    let result = drive(ctx, turn).await;
    if state.turn.lock().map_err(|e| e.to_string())?.is_none() {
        *state.ai_active.lock().map_err(|e| e.to_string())? = false;
    }
    if let Err(message) = &result {
        let _ = app.emit("ai:error", message.clone());
        let _ = app.emit("ai:done", "error");
    }
    result
}

/// Record a decision on a parked tool call and resume if nothing is left.
async fn decide(
    app: AppHandle,
    state: State<'_, AppState>,
    call_id: String,
    approve: bool,
) -> Result<(), String> {
    // Build every fallible dependency before removing the parked turn. A
    // context failure must leave the approval available to retry.
    let provider = state
        .turn
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("there is no turn waiting on a decision")?
        .provider
        .clone();
    let ctx = build_ctx(&app, &state, &provider)?;
    let mut turn = state
        .turn
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("there is no turn waiting on a decision")?;

    let Some(pending) = turn.awaiting.remove(&call_id) else {
        // Put it back: another call may still be waiting.
        if let Ok(mut slot) = state.turn.lock() {
            *slot = Some(turn);
        }
        return Err(format!("no pending tool call '{call_id}'"));
    };

    let block = if approve {
        let outcome = run_approved_command(&ctx.root, &pending.command, COMMAND_TIMEOUT);
        let _ = ctx.audit.append(AuditEvent::new(
            AuditKind::CommandRun,
            &audit_detail::command(&pending.command),
        ));
        let _ = app.emit(
            "ai:tool_ran",
            ToolRan {
                id: call_id.clone(),
                name: pending.name.clone(),
                summary: summarise(&outcome.text),
                is_error: outcome.is_error,
            },
        );
        ContentBlock::ToolResult {
            tool_use_id: call_id,
            content: outcome.text,
            is_error: outcome.is_error,
        }
    } else {
        let _ = ctx.audit.append(AuditEvent::new(
            AuditKind::CommandRejected,
            &audit_detail::command(&pending.command),
        ));
        declined_result(&call_id)
    };

    turn.results.push(block);

    if !turn.awaiting.is_empty() {
        // Another call is still waiting; park again rather than resuming.
        if let Ok(mut slot) = state.turn.lock() {
            *slot = Some(turn);
        }
        return Ok(());
    }

    append_round(
        &mut turn.messages,
        std::mem::take(&mut turn.assistant_blocks),
        std::mem::take(&mut turn.results),
    );

    let result = drive(ctx, turn).await;
    if state.turn.lock().map_err(|e| e.to_string())?.is_none() {
        *state.ai_active.lock().map_err(|e| e.to_string())? = false;
    }
    if let Err(message) = &result {
        let _ = app.emit("ai:error", message.clone());
        let _ = app.emit("ai:done", "error");
    }
    result
}

#[tauri::command]
pub async fn ai_approve_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    call_id: String,
) -> Result<(), String> {
    decide(app, state, call_id, true).await
}

#[tauri::command]
pub async fn ai_reject_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    call_id: String,
) -> Result<(), String> {
    decide(app, state, call_id, false).await
}

/// Stop the turn in flight.
///
/// The flag is checked between stream chunks, so the connection is dropped
/// rather than read to the end and discarded — stopping an answer you no
/// longer want should also stop paying for it.
#[tauri::command]
pub fn ai_cancel(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::Relaxed);
    if let Ok(mut slot) = state.turn.lock() {
        // A parked approval has no running stream left to observe the flag,
        // so it can release the serialization gate immediately. A streaming
        // request keeps it until its owner exits, preventing a new request
        // from resetting this request's cancellation state.
        if slot.take().is_some() {
            if let Ok(mut active) = state.ai_active.lock() {
                *active = false;
            }
        }
    }
    let _ = app.emit("ai:done", "cancelled");
    Ok(())
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

    #[test]
    fn a_one_line_result_is_summarised_by_its_content() {
        assert_eq!(summarise("the working tree is clean"), "the working tree is clean");
    }

    #[test]
    fn a_long_result_is_summarised_by_its_size() {
        // Pasting a whole file into the transcript would bury the answer.
        let summary = summarise("a\nb\nc\nd");
        assert_eq!(summary, "4 lines");
    }

    #[test]
    fn a_very_long_single_line_is_cut_rather_than_shown_whole() {
        assert!(summarise(&"x".repeat(500)).len() <= 120);
    }
}
