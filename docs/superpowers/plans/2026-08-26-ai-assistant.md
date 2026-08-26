# JKY Terminal — Plan 3: AI Assistant

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An assistant tab that streams a real answer from Anthropic using the key already in the OS keychain, can read the project through tools, and cannot run a single command without the user saying yes.

**Architecture:** Rust has no official Anthropic SDK, so `crates/jky-ai` speaks the Messages API over raw HTTP with `reqwest`. Every part that can be pure is pure — request building returns a `serde_json::Value`, the SSE parser is a state machine over `&str` — so the whole protocol is testable without a network or a key. The confirmation gate lives in **Rust, not the UI**: `run_command` never executes on the model's say-so; it parks the call and waits for an explicit approve command. Every secret read, tool call, and command execution appends to a JSONL audit log.

**Tech Stack:** Rust 1.96 · `reqwest` (rustls) · `tokio` · `serde_json` · Anthropic Messages API `2023-06-01` · React 18 · Vitest

**Spec:** [`docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md`](../specs/2026-08-26-jky-terminal-v0.1-design.md)

## Global Constraints

Carried forward. Every one is already enforced by a test; do not weaken any to make a task easier.

- **No IPC command may return a secret value.** `apps/desktop/src-tauri/tests/security.rs` pins the exposed command list. This plan adds commands, so update that list **in the same commit**, with the reason in the message.
- **CSP `connect-src` may contain only** `'self'`, `ipc:`, `http://ipc.localhost`. **The assistant must not fetch from the webview.** All Anthropic traffic originates in Rust. This is the property that makes a compromised frontend unable to exfiltrate the key, and this plan is the first that could accidentally break it.
- **The renderer gets no `fs`, `shell`, or `http` capability.**
- **No literal colour in a component.** Colours come from `src/styles/tokens.css`.
- **No component may import `@tauri-apps/api` directly** — only `src/platform/tauri.ts`.
- **Cross-platform parity is a hard requirement.** CI builds and tests ubuntu, macos and windows.
- **Commits are authored solely by `kartikeyajay2006 <kartikeyajay2006@gmail.com>`.** No co-author trailers, no AI-attribution anywhere.
- **Conventional Commits.**

## Anthropic API facts this plan depends on

Getting any of these wrong produces a 400 that looks like a bug in our code. They are current as of 2026-06.

| Thing | Value |
|---|---|
| Endpoint | `POST https://api.anthropic.com/v1/messages` |
| Required headers | `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json` |
| Default model | `claude-opus-5` |
| Thinking | `{"type": "adaptive"}`. **`budget_tokens` is removed — sending it returns 400** on Opus 5 / Sonnet 5 / Fable 5. |
| Effort | `output_config: {"effort": "high"}` — nested, never top-level |
| `max_tokens` | `64000` for streaming requests |
| Assistant prefill | **Removed** — a trailing assistant message returns 400 |
| Streaming | `"stream": true`, response is SSE |
| SSE event types | `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error` |
| Text delta | `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"…"}}` |
| Tool input delta | `delta.type == "input_json_delta"`, with `partial_json` — accumulate and parse once at `content_block_stop` |
| Tool call block | `{"type":"tool_use","id":"toolu_…","name":"…","input":{…}}` |
| Returning a result | user message containing `{"type":"tool_result","tool_use_id":"toolu_…","content":"…"}`, `is_error: true` on failure |
| Parallel tool calls | one assistant message may hold several `tool_use` blocks; return **all** results in **one** user message |

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/jky-audit/src/lib.rs` | Append-only JSONL audit log |
| `crates/jky-ai/src/types.rs` | `Message`, `ContentBlock`, `ToolSpec`, `ChatRequest` |
| `crates/jky-ai/src/sse.rs` | SSE frame splitter and event decoder — pure |
| `crates/jky-ai/src/anthropic.rs` | Request building and the HTTP call |
| `crates/jky-ai/src/provider.rs` | The `AIProvider` trait |
| `crates/jky-ai/src/tools.rs` | Tool schemas and the destructive-command predicate |
| `apps/desktop/src-tauri/src/commands/ai.rs` | IPC surface, streaming events, the approval gate |
| `apps/desktop/src/features/assistant/Assistant.tsx` | Chat panel |
| `apps/desktop/src/features/assistant/ToolCard.tsx` | Tool call display and the confirm control |

---

## Task 1: The audit log

Plan 1 deferred this. It belongs here because this is the first plan whose code reads the stored key and runs commands — the two things worth auditing.

**Files:**
- Create: `crates/jky-audit/Cargo.toml`, `crates/jky-audit/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `AuditLog::new(path)`, `AuditLog::append(&self, AuditEvent) -> Result<(), AuditError>`, `AuditLog::read_all(&self) -> Result<Vec<AuditEvent>, AuditError>`; `AuditEvent { at: String, kind: AuditKind, detail: String }`; `AuditKind::{SecretRead, ToolCall, CommandRun, CommandRejected, ProviderRequest}`. Task 6 appends on every gated action.

- [ ] **Step 1: Write the failing test**

`crates/jky-audit/src/lib.rs`, tests only for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn log() -> (TempDir, AuditLog) {
        let d = TempDir::new().unwrap();
        let l = AuditLog::new(d.path().join("audit.jsonl"));
        (d, l)
    }

    #[test]
    fn an_empty_log_reads_as_no_events() {
        let (_d, l) = log();
        assert!(l.read_all().unwrap().is_empty());
    }

    #[test]
    fn an_appended_event_reads_back() {
        let (_d, l) = log();
        l.append(AuditEvent::new(AuditKind::ToolCall, "read_file src/main.rs")).unwrap();

        let events = l.read_all().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, AuditKind::ToolCall);
        assert!(events[0].detail.contains("read_file"));
    }

    #[test]
    fn events_keep_the_order_they_were_appended_in() {
        // An audit log whose order cannot be trusted is not an audit log.
        let (_d, l) = log();
        for i in 0..5 {
            l.append(AuditEvent::new(AuditKind::CommandRun, &format!("cmd-{i}"))).unwrap();
        }
        let details: Vec<String> = l.read_all().unwrap().into_iter().map(|e| e.detail).collect();
        assert_eq!(details, vec!["cmd-0", "cmd-1", "cmd-2", "cmd-3", "cmd-4"]);
    }

    #[test]
    fn every_event_carries_a_timestamp() {
        let (_d, l) = log();
        l.append(AuditEvent::new(AuditKind::SecretRead, "anthropic")).unwrap();
        assert!(!l.read_all().unwrap()[0].at.is_empty());
    }

    #[test]
    fn one_unreadable_line_does_not_discard_the_rest() {
        // A partially written final line — a crash mid-append — must not make
        // the whole history unreadable.
        let d = TempDir::new().unwrap();
        let path = d.path().join("audit.jsonl");
        let l = AuditLog::new(&path);
        l.append(AuditEvent::new(AuditKind::ToolCall, "good")).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{ truncated\n")
            .unwrap();

        assert_eq!(l.read_all().unwrap().len(), 1, "the good line must survive");
    }

    #[test]
    fn the_parent_directory_is_created_on_first_append() {
        let d = TempDir::new().unwrap();
        let nested = d.path().join("deep/deeper/audit.jsonl");
        AuditLog::new(&nested)
            .append(AuditEvent::new(AuditKind::ToolCall, "x"))
            .unwrap();
        assert!(nested.is_file());
    }

    #[test]
    fn a_detail_containing_a_newline_cannot_forge_a_second_entry() {
        // Details come from tool arguments, which come from the model. A
        // newline in a detail would otherwise write a second JSONL record and
        // let a prompt injection fabricate audit history.
        let (_d, l) = log();
        l.append(AuditEvent::new(
            AuditKind::ToolCall,
            "innocent\n{\"kind\":\"CommandRun\",\"detail\":\"forged\"}",
        ))
        .unwrap();

        let events = l.read_all().unwrap();
        assert_eq!(events.len(), 1, "a newline in a detail forged an entry");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-audit`
Expected: FAIL — `cannot find type AuditLog`.

- [ ] **Step 3: Write the crate**

`crates/jky-audit/Cargo.toml`:

```toml
[package]
name = "jky-audit"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true

[dev-dependencies]
tempfile = "3"
```

`crates/jky-audit/src/lib.rs`, above the tests:

```rust
//! Append-only audit log.
//!
//! JSONL rather than a database: one event per line, append-only, readable
//! with `tail` and `grep` when the app is not running. An audit trail whose
//! contents can only be inspected through the thing being audited is worth
//! considerably less.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("could not write the audit log: {0}")]
    Write(String),
    #[error("could not read the audit log: {0}")]
    Read(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditKind {
    /// The stored key was read in order to make a request.
    SecretRead,
    /// The model asked for a tool.
    ToolCall,
    /// The user approved a command and it ran.
    CommandRun,
    /// The user declined a command.
    CommandRejected,
    /// A request was sent to a provider.
    ProviderRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    /// RFC 3339 UTC.
    pub at: String,
    pub kind: AuditKind,
    pub detail: String,
}

impl AuditEvent {
    pub fn new(kind: AuditKind, detail: &str) -> Self {
        Self { at: now_rfc3339(), kind, detail: sanitise(detail) }
    }
}

/// Strip anything that could end a JSONL record early.
///
/// Details are built from tool arguments, which come from the model. Without
/// this, a newline inside a detail writes a second record and lets a prompt
/// injection fabricate audit history.
fn sanitise(detail: &str) -> String {
    detail.replace(['\n', '\r'], " ")
}

fn now_rfc3339() -> String {
    // Formatted by hand rather than pulling in a date crate for one call site.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's days-from-civil, inverted. Public domain algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub struct AuditLog {
    path: PathBuf,
}

impl AuditLog {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    pub fn append(&self, event: AuditEvent) -> Result<(), AuditError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AuditError::Write(e.to_string()))?;
        }
        let line = serde_json::to_string(&event).map_err(|e| AuditError::Write(e.to_string()))?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| AuditError::Write(e.to_string()))?;
        writeln!(file, "{line}").map_err(|e| AuditError::Write(e.to_string()))
    }

    /// Read every event, skipping any line that will not parse.
    ///
    /// A crash mid-append leaves a partial final line. Discarding the entire
    /// history because of it would be the wrong trade for an audit log.
    pub fn read_all(&self) -> Result<Vec<AuditEvent>, AuditError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(AuditError::Read(e.to_string())),
        };
        Ok(raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect())
    }
}
```

The test file needs `use std::io::Write;` in scope — it is already imported at module level.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-audit`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-audit
git commit -m "feat(audit): add append-only JSONL audit log"
```

---

## Task 2: AI types and the provider trait

**Files:**
- Create: `crates/jky-ai/Cargo.toml`, `crates/jky-ai/src/lib.rs`, `crates/jky-ai/src/types.rs`, `crates/jky-ai/src/provider.rs`
- Modify: root `Cargo.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: `Role::{User, Assistant}`; `ContentBlock::{Text{text}, ToolUse{id,name,input}, ToolResult{tool_use_id,content,is_error}}`; `Message{role, content: Vec<ContentBlock>}`; `ToolSpec{name, description, input_schema}`; `ChatRequest{model, system, messages, tools, max_tokens}`; `StreamEvent::{TextDelta(String), ToolUseStart{id,name}, ToolInputDelta(String), BlockStop, Done{stop_reason}, Error(String)}`; and the `AIProvider` trait. Tasks 3–6 all speak these types.

- [ ] **Step 1: Add the dependency**

Append to the workspace `[workspace.dependencies]` in the root `Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync"] }
futures-util = "0.3"
```

`default-features = false` with `rustls-tls` matters: the default pulls native TLS, which needs OpenSSL headers present on every build machine. rustls keeps the Windows and macOS CI jobs from needing extra system packages.

`crates/jky-ai/Cargo.toml`:

```toml
[package]
name = "jky-ai"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
jky-secrets = { path = "../jky-secrets" }
reqwest.workspace = true
tokio.workspace = true
futures-util.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write the failing test**

`crates/jky-ai/src/types.rs`:

```rust
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p jky-ai`
Expected: FAIL — `cannot find type Message`.

- [ ] **Step 4: Write the types**

Prepend to `crates/jky-ai/src/types.rs`:

```rust
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
```

- [ ] **Step 5: Write the provider trait**

`crates/jky-ai/src/provider.rs`:

```rust
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
/// One implementation ships in v0.1 (Anthropic). The trait exists so adding
/// another is one new file rather than a refactor of every call site.
#[allow(async_fn_in_trait)]
pub trait AIProvider: Send + Sync {
    /// Stream a completion, invoking `on_event` for each decoded event.
    async fn stream_chat(
        &self,
        request: ChatRequest,
        on_event: &mut (dyn FnMut(StreamEvent) + Send),
    ) -> Result<(), AiError>;
}
```

`crates/jky-ai/src/lib.rs`:

```rust
mod provider;
mod types;

pub use provider::{AIProvider, AiError};
pub use types::{ChatRequest, ContentBlock, Message, Role, StreamEvent, ToolSpec};
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p jky-ai`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/jky-ai Cargo.toml
git commit -m "feat(ai): add message types and the provider trait"
```

---

## Task 3: The SSE decoder

The most bug-prone part of streaming, and the easiest to test properly — it is a
pure function from bytes to events.

**Files:**
- Create: `crates/jky-ai/src/sse.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: `StreamEvent` from Task 2.
- Produces: `SseDecoder::new()`, `SseDecoder::push(&mut self, chunk: &str) -> Vec<StreamEvent>`. Task 4 feeds it network chunks.

- [ ] **Step 1: Write the failing test**

`crates/jky-ai/src/sse.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::StreamEvent;

    fn decode(input: &str) -> Vec<StreamEvent> {
        SseDecoder::new().push(input)
    }

    #[test]
    fn a_text_delta_becomes_a_text_event() {
        let events = decode(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("Hi".into())]);
    }

    #[test]
    fn a_frame_split_across_chunks_is_reassembled() {
        // Network chunks do not respect frame boundaries. Splitting mid-JSON
        // is the normal case, not an edge case.
        let mut d = SseDecoder::new();
        assert!(d.push("event: content_block_delta\ndata: {\"type\":\"content_bl").is_empty());
        let events = d.push(
            "ock_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("ok".into())]);
    }

    #[test]
    fn several_frames_in_one_chunk_all_decode() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"a\"}}\n\n\
             data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"b\"}}\n\n",
        );
        assert_eq!(
            events,
            vec![StreamEvent::TextDelta("a".into()), StreamEvent::TextDelta("b".into())]
        );
    }

    #[test]
    fn a_tool_use_block_start_is_reported_with_its_id_and_name() {
        let events = decode(
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_7\",\"name\":\"read_file\",\"input\":{}}}\n\n",
        );
        assert_eq!(
            events,
            vec![StreamEvent::ToolUseStart { id: "toolu_7".into(), name: "read_file".into() }]
        );
    }

    #[test]
    fn tool_argument_fragments_are_surfaced_for_accumulation() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"pa\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::ToolInputDelta("{\"pa".into())]);
    }

    #[test]
    fn a_text_block_start_emits_nothing() {
        // Only tool blocks need announcing; a text block start carries no
        // information the caller does not already have.
        assert!(decode(
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"
        )
        .is_empty());
    }

    #[test]
    fn block_stop_is_reported_so_tool_arguments_can_be_parsed() {
        assert_eq!(
            decode("data: {\"type\":\"content_block_stop\",\"index\":1}\n\n"),
            vec![StreamEvent::BlockStop]
        );
    }

    #[test]
    fn the_stop_reason_arrives_with_message_delta() {
        assert_eq!(
            decode("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"}}\n\n"),
            vec![StreamEvent::Done { stop_reason: "tool_use".into() }]
        );
    }

    #[test]
    fn a_ping_is_ignored() {
        assert!(decode("event: ping\ndata: {\"type\":\"ping\"}\n\n").is_empty());
    }

    #[test]
    fn a_stream_error_frame_becomes_an_error_event() {
        let events = decode(
            "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::Error("Overloaded".into())]);
    }

    #[test]
    fn the_done_sentinel_is_ignored() {
        assert!(decode("data: [DONE]\n\n").is_empty());
    }

    #[test]
    fn malformed_json_is_skipped_rather_than_aborting_the_stream() {
        // One bad frame must not kill a response that is otherwise fine.
        let events = decode(
            "data: {not json\n\n\
             data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("ok".into())]);
    }

    #[test]
    fn crlf_line_endings_decode_the_same_as_lf() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"x\"}}\r\n\r\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("x".into())]);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-ai sse`
Expected: FAIL — `cannot find type SseDecoder`.

- [ ] **Step 3: Write the decoder**

Prepend to `crates/jky-ai/src/sse.rs`:

```rust
use crate::types::StreamEvent;

/// Incremental Server-Sent Events decoder.
///
/// Holds a buffer because network chunks do not align to frame boundaries —
/// a chunk routinely ends in the middle of a JSON object.
#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk, get back every event that completed within it.
    pub fn push(&mut self, chunk: &str) -> Vec<StreamEvent> {
        // Normalise line endings once so frame splitting has a single shape
        // to look for rather than three.
        self.buffer.push_str(&chunk.replace("\r\n", "\n"));

        let mut events = Vec::new();
        while let Some(idx) = self.buffer.find("\n\n") {
            let frame: String = self.buffer.drain(..idx + 2).collect();
            if let Some(event) = decode_frame(&frame) {
                events.push(event);
            }
        }
        events
    }
}

fn decode_frame(frame: &str) -> Option<StreamEvent> {
    // The `event:` line duplicates the `type` field inside the payload, so the
    // payload alone is enough and there is one place to get it wrong.
    let data = frame
        .lines()
        .find_map(|line| line.strip_prefix("data:"))?
        .trim();

    if data.is_empty() || data == "[DONE]" {
        return None;
    }

    let value: serde_json::Value = serde_json::from_str(data).ok()?;

    match value.get("type")?.as_str()? {
        "content_block_start" => {
            let block = value.get("content_block")?;
            if block.get("type")?.as_str()? != "tool_use" {
                return None;
            }
            Some(StreamEvent::ToolUseStart {
                id: block.get("id")?.as_str()?.to_string(),
                name: block.get("name")?.as_str()?.to_string(),
            })
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            match delta.get("type")?.as_str()? {
                "text_delta" => Some(StreamEvent::TextDelta(
                    delta.get("text")?.as_str()?.to_string(),
                )),
                "input_json_delta" => Some(StreamEvent::ToolInputDelta(
                    delta.get("partial_json")?.as_str()?.to_string(),
                )),
                _ => None,
            }
        }
        "content_block_stop" => Some(StreamEvent::BlockStop),
        "message_delta" => Some(StreamEvent::Done {
            stop_reason: value
                .get("delta")?
                .get("stop_reason")?
                .as_str()
                .unwrap_or("end_turn")
                .to_string(),
        }),
        "error" => Some(StreamEvent::Error(
            value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown provider error")
                .to_string(),
        )),
        _ => None,
    }
}
```

Add `mod sse;` and `pub use sse::SseDecoder;` to `crates/jky-ai/src/lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-ai`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): add incremental SSE decoder"
```

---

## Task 4: The Anthropic adapter

**Files:**
- Create: `crates/jky-ai/src/anthropic.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: `ChatRequest`, `StreamEvent`, `AIProvider`, `AiError`, `SseDecoder`.
- Produces: `AnthropicProvider::new(api_key: Secret<String>)`, `build_body(&ChatRequest) -> serde_json::Value`, `ANTHROPIC_VERSION`, `MESSAGES_URL`. Task 6 constructs the provider with the key it read from the keychain.

- [ ] **Step 1: Write the failing test**

Request building is a pure function, so the entire wire shape is testable with
no network and no key — which is where the expensive mistakes live.

`crates/jky-ai/src/anthropic.rs`:

```rust
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-ai anthropic`
Expected: FAIL — `cannot find function build_body`.

- [ ] **Step 3: Write the adapter**

Prepend to `crates/jky-ai/src/anthropic.rs`:

```rust
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
        on_event: &mut (dyn FnMut(StreamEvent) + Send),
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
                on_event(event);
            }
        }

        Ok(())
    }
}
```

Add `mod anthropic;` and `pub use anthropic::{ANTHROPIC_VERSION, AnthropicProvider, MESSAGES_URL, build_body};` to `crates/jky-ai/src/lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-ai && cargo clippy -p jky-ai --all-targets -- -D warnings`
Expected: PASS, 27 tests; clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): add the Anthropic Messages API adapter"
```

---

## Task 5: Tools and the destructive-command gate

**Files:**
- Create: `crates/jky-ai/src/tools.rs`
- Modify: `crates/jky-ai/src/lib.rs`

**Interfaces:**
- Consumes: `ToolSpec` from Task 2.
- Produces: `assistant_tools() -> Vec<ToolSpec>`; `is_destructive(&str) -> bool`; `requires_approval(&str) -> bool`. Task 6 refuses to run anything without approval and escalates when `is_destructive` is true.

- [ ] **Step 1: Write the failing test**

`crates/jky-ai/src/tools.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_toolset_covers_reading_the_project() {
        let names: Vec<String> = assistant_tools().into_iter().map(|t| t.name).collect();
        for expected in ["read_file", "list_dir", "git_status", "search_codebase", "run_command"] {
            assert!(names.contains(&expected.to_string()), "missing tool: {expected}");
        }
    }

    #[test]
    fn every_tool_declares_an_object_schema_with_required_fields() {
        for tool in assistant_tools() {
            assert_eq!(tool.input_schema["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty(), "{} has no description", tool.name);
        }
    }

    #[test]
    fn running_a_command_always_requires_approval() {
        // Not "usually". The gate has no exceptions in v0.1 — an
        // always-allow toggle is where irreversible mistakes originate.
        assert!(requires_approval("run_command"));
    }

    #[test]
    fn reading_does_not_require_approval() {
        for read_only in ["read_file", "list_dir", "git_status", "search_codebase"] {
            assert!(!requires_approval(read_only), "{read_only} should not be gated");
        }
    }

    #[test]
    fn an_unknown_tool_requires_approval() {
        // Fail closed. A tool added later without updating this list must be
        // gated by default rather than silently ungated.
        assert!(requires_approval("some_future_tool"));
    }

    #[test]
    fn recognised_destructive_commands_escalate() {
        for cmd in [
            "rm -rf /",
            "rm -rf ~/projects",
            "git push --force origin main",
            "git push -f",
            "dd if=/dev/zero of=/dev/sda",
            "mkfs.ext4 /dev/sdb1",
            "chmod -R 777 /",
            "shutdown now",
            ":(){ :|:& };:",
        ] {
            assert!(is_destructive(cmd), "not flagged: {cmd}");
        }
    }

    #[test]
    fn ordinary_commands_do_not_escalate() {
        for cmd in ["ls -la", "git status", "cargo test", "npm run build", "cat README.md"] {
            assert!(!is_destructive(cmd), "wrongly flagged: {cmd}");
        }
    }

    #[test]
    fn detection_ignores_case_and_padding() {
        assert!(is_destructive("  RM -RF /tmp/x  "));
    }

    #[test]
    fn a_destructive_command_hidden_after_a_separator_is_still_caught() {
        // Checking only the first word is the obvious implementation and the
        // wrong one: `ls && rm -rf /` starts with `ls`.
        assert!(is_destructive("ls && rm -rf /"));
        assert!(is_destructive("echo hi; git push --force"));
        assert!(is_destructive("cat x | xargs rm -rf"));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-ai tools`
Expected: FAIL — `cannot find function assistant_tools`.

- [ ] **Step 3: Write the tools module**

Prepend to `crates/jky-ai/src/tools.rs`:

```rust
use crate::types::ToolSpec;

fn tool(name: &str, description: &str, schema: serde_json::Value) -> ToolSpec {
    ToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: schema,
    }
}

/// The tools the assistant may ask for in v0.1.
pub fn assistant_tools() -> Vec<ToolSpec> {
    vec![
        tool(
            "read_file",
            "Read a UTF-8 text file from the current project and return its contents.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to the project root"}
                },
                "required": ["path"]
            }),
        ),
        tool(
            "list_dir",
            "List the entries of a directory in the current project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory relative to the project root"}
                },
                "required": ["path"]
            }),
        ),
        tool(
            "git_status",
            "Show the working tree status of the current project.",
            serde_json::json!({"type": "object", "properties": {}}),
        ),
        tool(
            "search_codebase",
            "Search the project for a literal string and return matching lines with their file and line number.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Literal text to find"}
                },
                "required": ["query"]
            }),
        ),
        tool(
            "run_command",
            "Propose a shell command. The user is shown the exact command and must approve it before it runs.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to run"},
                    "reason": {"type": "string", "description": "Why this command is needed"}
                },
                "required": ["command", "reason"]
            }),
        ),
    ]
}

/// Read-only tools that may run without asking.
const UNGATED: &[&str] = &["read_file", "list_dir", "git_status", "search_codebase"];

/// Whether a tool needs the user to say yes first.
///
/// Fails closed: anything not explicitly known to be read-only is gated, so a
/// tool added later is safe by default rather than dangerous by default.
pub fn requires_approval(tool_name: &str) -> bool {
    !UNGATED.contains(&tool_name)
}

/// Command fragments that warrant more than a single click to confirm.
const DESTRUCTIVE: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "git push --force",
    "git push -f",
    "dd if=",
    "mkfs",
    "chmod -r 777",
    "chmod 777 /",
    "shutdown",
    "reboot",
    "> /dev/sd",
    ":(){",
    "del /f /s /q",
    "format c:",
];

/// Whether a command deserves type-to-confirm rather than click-to-confirm.
///
/// Substring matching over the whole command, deliberately. Inspecting only
/// the first word is the obvious approach and misses `ls && rm -rf /`.
pub fn is_destructive(command: &str) -> bool {
    let normalised = command.to_lowercase();
    let squeezed = normalised.split_whitespace().collect::<Vec<_>>().join(" ");
    DESTRUCTIVE.iter().any(|pattern| squeezed.contains(pattern))
}
```

Add `mod tools;` and `pub use tools::{assistant_tools, is_destructive, requires_approval};` to `crates/jky-ai/src/lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p jky-ai`
Expected: PASS, 36 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-ai
git commit -m "feat(ai): add the assistant toolset and the approval gate"
```

---

## Task 6: The assistant IPC surface

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/ai.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`, `src/state.rs`, `src/main.rs`, `Cargo.toml`, `tests/security.rs`

**Interfaces:**
- Consumes: everything from Tasks 1–5, plus `SecretStore` and `SettingsStore`.
- Produces: `ai_send(conversation: Vec<Message>, provider: String) -> Result<(), String>`; `ai_approve_tool(call_id: String) -> Result<(), String>`; `ai_reject_tool(call_id: String) -> Result<(), String>`; `audit_read() -> Result<Vec<AuditEvent>, String>`; and events `ai:delta`, `ai:tool_request`, `ai:done`, `ai:error`. Task 7 consumes these.

- [ ] **Step 1: Wire the dependencies and state**

Add to `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`:

```toml
jky-ai = { path = "../../../crates/jky-ai" }
jky-audit = { path = "../../../crates/jky-audit" }
tokio.workspace = true
```

Add to `AppState` in `apps/desktop/src-tauri/src/state.rs`, alongside the existing fields:

```rust
    pub audit: Arc<AuditLog>,
    /// Tool calls waiting for the user to approve or decline them.
    pub pending_tools: Arc<Mutex<HashMap<String, PendingTool>>>,
```

with `use jky_audit::AuditLog;`, `use std::collections::HashMap;`, `use std::sync::Mutex;`, and in `new()`:

```rust
            audit: Arc::new(AuditLog::new(config_dir.join("audit.jsonl"))),
            pending_tools: Arc::new(Mutex::new(HashMap::new())),
```

Define `PendingTool` in `state.rs`:

```rust
/// A tool call the model asked for, held until the user decides.
#[derive(Debug, Clone)]
pub struct PendingTool {
    pub id: String,
    pub name: String,
    pub command: String,
}
```

- [ ] **Step 2: Write the failing test**

`apps/desktop/src-tauri/src/commands/ai.rs`, tests only:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use jky_secrets::{MemoryStore, Secret, SecretStore};

    #[test]
    fn sending_without_a_stored_key_reports_it_clearly() {
        let store = MemoryStore::new();
        let err = resolve_key(&store, "anthropic").unwrap_err();
        assert!(
            err.to_lowercase().contains("key"),
            "the message should tell the user to add a key: {err}"
        );
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let store = MemoryStore::new();
        assert!(resolve_key(&store, "skynet").is_err());
    }

    #[test]
    fn the_error_shown_to_the_user_never_contains_the_key() {
        // resolve_key succeeds here, so the failure path under test is the
        // one where a later error might interpolate what it just read.
        let store = MemoryStore::new();
        let key = format!("sk-ant-api03-CANARY{}", "x".repeat(40));
        store.set("anthropic", Secret::new(key)).unwrap();

        let err = resolve_key(&store, "nonexistent").unwrap_err();
        assert!(!err.contains("CANARY"));
    }

    #[test]
    fn a_read_only_tool_runs_without_approval() {
        assert!(!jky_ai::requires_approval("read_file"));
    }

    #[test]
    fn running_a_command_is_never_ungated() {
        assert!(jky_ai::requires_approval("run_command"));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p jky-terminal ai`
Expected: FAIL — `cannot find function resolve_key`.

- [ ] **Step 4: Write the commands**

Prepend to `apps/desktop/src-tauri/src/commands/ai.rs`:

```rust
use jky_ai::{
    AIProvider, AnthropicProvider, ChatRequest, ContentBlock, Message, StreamEvent,
    assistant_tools, is_destructive, requires_approval,
};
use jky_audit::{AuditEvent, AuditKind};
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
    store
        .get(id.as_key())
        .map_err(|_| format!("no API key stored for {}. Add one in Providers.", id.display_name()))
}

#[tauri::command]
pub async fn ai_send(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    conversation: Vec<Message>,
) -> Result<(), String> {
    let key = resolve_key(state.secrets.as_ref(), &provider)?;

    let _ = state.audit.append(AuditEvent::new(
        AuditKind::SecretRead,
        &format!("read key for {provider} to send a request"),
    ));
    let _ = state.audit.append(AuditEvent::new(
        AuditKind::ProviderRequest,
        &format!("{provider}: {} messages", conversation.len()),
    ));

    let model = state
        .settings
        .selected_model(&provider)
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            ProviderId::parse(&provider)
                .map(|p| p.default_model().to_string())
                .unwrap_or_default()
        });

    let request = ChatRequest {
        model,
        system: SYSTEM_PROMPT.to_string(),
        messages: conversation,
        tools: assistant_tools(),
        max_tokens: 64_000,
    };

    let provider_impl = AnthropicProvider::new(key);
    let pending = state.pending_tools.clone();
    let audit = state.audit.clone();

    // Accumulated across events: a tool's arguments arrive as JSON fragments
    // and are only parseable once its block stops.
    let mut current_tool: Option<(String, String)> = None;
    let mut tool_json = String::new();

    let emit = app.clone();
    let mut on_event = move |event: StreamEvent| match event {
        StreamEvent::TextDelta(text) => {
            let _ = emit.emit("ai:delta", text);
        }
        StreamEvent::ToolUseStart { id, name } => {
            current_tool = Some((id, name));
            tool_json.clear();
        }
        StreamEvent::ToolInputDelta(fragment) => tool_json.push_str(&fragment),
        StreamEvent::BlockStop => {
            if let Some((id, name)) = current_tool.take() {
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
                    // Parked, not executed. Nothing runs until the user says so.
                    if let Ok(mut map) = pending.lock() {
                        map.insert(
                            id.clone(),
                            PendingTool { id: id.clone(), name: name.clone(), command: command.clone() },
                        );
                    }
                    let _ = emit.emit(
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
        }
        StreamEvent::Done { stop_reason } => {
            let _ = emit.emit("ai:done", stop_reason);
        }
        StreamEvent::Error(message) => {
            let _ = emit.emit("ai:error", message);
        }
    };

    provider_impl
        .stream_chat(request, &mut on_event)
        .await
        .map_err(|e| e.to_string())
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
        &format!("approved: {}", pending.command),
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
            &format!("declined: {}", tool.command),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn audit_read(state: State<'_, AppState>) -> Result<Vec<jky_audit::AuditEvent>, String> {
    state.audit.read_all().map_err(|e| e.to_string())
}
```

Register all four in `main.rs`'s `generate_handler!`, add `pub mod ai;` to `commands/mod.rs`.

- [ ] **Step 5: Update the pinned command surface**

The security guard fires until the new commands are acknowledged. In
`apps/desktop/src-tauri/tests/security.rs`, extend the expected list — it is
compared sorted, so keep it alphabetical:

```rust
        "ai_approve_tool".to_string(),
        "ai_reject_tool".to_string(),
        "ai_send".to_string(),
        "audit_read".to_string(),
```

`audit_read` returns audit events, which contain tool names and commands but
never secret values — `AuditEvent` has no field that could hold one.

- [ ] **Step 6: Run the tests**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS; clippy clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(ai): expose the assistant over IPC with a Rust-side approval gate"
```

---

## Task 7: The assistant panel

**Files:**
- Create: `apps/desktop/src/features/assistant/Assistant.tsx`, `Assistant.css`, `ToolCard.tsx`, `Assistant.test.tsx`
- Modify: `apps/desktop/src/platform/types.ts`, `tauri.ts`, `web.ts`, `src/App.tsx`, `src/app/Rail.tsx`

**Interfaces:**
- Consumes: the four commands and four events from Task 6.
- Produces: `<Assistant />`, and an `ai` namespace on the platform: `send(provider, conversation)`, `approveTool(id)`, `rejectTool(id)`, `onDelta(cb)`, `onToolRequest(cb)`, `onDone(cb)`, `onError(cb)`.

- [ ] **Step 1: Extend the platform interface**

Add to `apps/desktop/src/platform/types.ts`:

```ts
export interface AiMessage {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  >;
}

export interface ToolRequest {
  id: string;
  name: string;
  command: string;
  reason: string;
  destructive: boolean;
}

export interface AiApi {
  send(provider: string, conversation: AiMessage[]): Promise<void>;
  approveTool(id: string): Promise<void>;
  rejectTool(id: string): Promise<void>;
  onDelta(handler: (text: string) => void): Promise<() => void>;
  onToolRequest(handler: (req: ToolRequest) => void): Promise<() => void>;
  onDone(handler: (stopReason: string) => void): Promise<() => void>;
  onError(handler: (message: string) => void): Promise<() => void>;
}
```

and `readonly ai: AiApi;` on `Platform`.

`apps/desktop/src/platform/tauri.ts` gains:

```ts
  const ai: AiApi = {
    async send(provider, conversation) {
      await invoke<void>("ai_send", { provider, conversation });
    },
    async approveTool(id) {
      await invoke<void>("ai_approve_tool", { callId: id });
    },
    async rejectTool(id) {
      await invoke<void>("ai_reject_tool", { callId: id });
    },
    onDelta: (h) => listen<string>("ai:delta", (e) => h(e.payload)),
    onToolRequest: (h) => listen<ToolRequest>("ai:tool_request", (e) => h(e.payload)),
    onDone: (h) => listen<string>("ai:done", (e) => h(e.payload)),
    onError: (h) => listen<string>("ai:error", (e) => h(e.payload)),
  };
```

`apps/desktop/src/platform/web.ts` gains a mock that streams a canned reply
word by word, so the panel is developable in a browser:

```ts
  const aiHandlers = {
    delta: [] as Array<(t: string) => void>,
    tool: [] as Array<(r: ToolRequest) => void>,
    done: [] as Array<(s: string) => void>,
    error: [] as Array<(m: string) => void>,
  };

  const ai: AiApi = {
    async send(_provider, conversation) {
      const last = conversation[conversation.length - 1];
      const asked =
        last?.content.find((c) => c.type === "text") &&
        (last.content[0] as { text: string }).text;
      for (const word of `You said: ${asked ?? ""}`.split(" ")) {
        aiHandlers.delta.forEach((h) => h(`${word} `));
      }
      aiHandlers.done.forEach((h) => h("end_turn"));
    },
    async approveTool() {},
    async rejectTool() {},
    async onDelta(h) {
      aiHandlers.delta.push(h);
      return () => aiHandlers.delta.splice(aiHandlers.delta.indexOf(h), 1);
    },
    async onToolRequest(h) {
      aiHandlers.tool.push(h);
      return () => aiHandlers.tool.splice(aiHandlers.tool.indexOf(h), 1);
    },
    async onDone(h) {
      aiHandlers.done.push(h);
      return () => aiHandlers.done.splice(aiHandlers.done.indexOf(h), 1);
    },
    async onError(h) {
      aiHandlers.error.push(h);
      return () => aiHandlers.error.splice(aiHandlers.error.indexOf(h), 1);
    },
  };
```

Return `ai` from both factories.

- [ ] **Step 2: Write the failing test**

`apps/desktop/src/features/assistant/Assistant.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Assistant } from "./Assistant";

describe("Assistant", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  it("invites the user to ask something", async () => {
    render(<Assistant />);
    expect(await screen.findByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });

  it("shows what the user asked", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    await user.type(screen.getByRole("textbox", { name: /message/i }), "what is this repo");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/what is this repo/)).toBeInTheDocument();
  });

  it("streams the reply in as it arrives", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    await user.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText(/You said: hello/)).toBeInTheDocument());
  });

  it("will not send an empty message", async () => {
    render(<Assistant />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("clears the box after sending so the next message starts fresh", async () => {
    const user = userEvent.setup();
    render(<Assistant />);

    const box = screen.getByRole("textbox", { name: /message/i });
    await user.type(box, "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(box).toHaveValue(""));
  });
});
```

`ToolCard` gets its own file so the gate is testable in isolation:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard";

const req = {
  id: "toolu_1",
  name: "run_command",
  command: "cargo test",
  reason: "Check the suite passes",
  destructive: false,
};

describe("ToolCard", () => {
  it("shows the exact command and the reason", () => {
    render(<ToolCard request={req} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("cargo test")).toBeInTheDocument();
    expect(screen.getByText(/Check the suite passes/)).toBeInTheDocument();
  });

  it("runs only when approved", async () => {
    const onApprove = vi.fn();
    render(<ToolCard request={req} onApprove={onApprove} onReject={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /^run$/i }));
    expect(onApprove).toHaveBeenCalledWith("toolu_1");
  });

  it("declines without running", async () => {
    const onReject = vi.fn();
    render(<ToolCard request={req} onApprove={vi.fn()} onReject={onReject} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /don't run/i }));
    expect(onReject).toHaveBeenCalledWith("toolu_1");
  });

  it("makes a destructive command type-to-confirm", async () => {
    const onApprove = vi.fn();
    const danger = { ...req, command: "rm -rf build", destructive: true };
    render(<ToolCard request={danger} onApprove={onApprove} onReject={vi.fn()} />);

    // One click is not enough for something irreversible.
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();

    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: /type the command/i }), "rm -rf build");
    expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });

  it("keeps run disabled while the typed confirmation does not match", async () => {
    const danger = { ...req, command: "rm -rf build", destructive: true };
    render(<ToolCard request={danger} onApprove={vi.fn()} onReject={vi.fn()} />);

    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: /type the command/i }), "rm -rf buil");
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @jky/desktop test Assistant`
Expected: FAIL — cannot resolve `./Assistant`.

- [ ] **Step 4: Write ToolCard**

```tsx
import { useId, useState } from "react";
import type { ToolRequest } from "../../platform";

interface ToolCardProps {
  request: ToolRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function ToolCard({ request, onApprove, onReject }: ToolCardProps) {
  const confirmId = useId();
  const [typed, setTyped] = useState("");

  // A destructive command needs more than a click. Retyping it is the
  // cheapest friction that still requires reading what you are agreeing to.
  const ready = !request.destructive || typed.trim() === request.command.trim();

  return (
    <div className="tool" data-destructive={request.destructive}>
      <div className="tool__head">
        <span className="tool__name">{request.name}</span>
        {request.destructive && <span className="tool__warn">destructive</span>}
      </div>

      <pre className="tool__cmd">{request.command}</pre>
      <p className="tool__why">{request.reason}</p>

      {request.destructive && (
        <div className="field">
          <label className="field__label" htmlFor={confirmId}>
            Type the command to confirm
          </label>
          <input
            id={confirmId}
            className="input"
            value={typed}
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}

      <div className="tool__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          onClick={() => onApprove(request.id)}
        >
          Run
        </button>
        <button type="button" className="btn" onClick={() => onReject(request.id)}>
          Don&apos;t run
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the Assistant panel**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform, type AiMessage, type ToolRequest } from "../../platform";
import { ToolCard } from "./ToolCard";
import "./Assistant.css";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolRequest[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const platform = getPlatform();
    const cleanups: Array<() => void> = [];

    void (async () => {
      cleanups.push(
        await platform.ai.onDelta((text) =>
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, text: last.text + text }];
            }
            return [...prev, { role: "assistant", text }];
          }),
        ),
      );
      cleanups.push(await platform.ai.onToolRequest((req) => setTools((t) => [...t, req])));
      cleanups.push(await platform.ai.onDone(() => setBusy(false)));
      cleanups.push(
        await platform.ai.onError((message) => {
          setError(message);
          setBusy(false);
        }),
      );
    })();

    return () => cleanups.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, tools]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;

    setTurns((prev) => [...prev, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    setError(null);

    const conversation: AiMessage[] = [
      { role: "user", content: [{ type: "text", text }] },
    ];

    try {
      await getPlatform().ai.send("anthropic", conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
      setBusy(false);
    }
  }, [draft]);

  return (
    <div className="chat">
      <div className="chat__log">
        {turns.length === 0 && (
          <p className="chat__empty">
            Ask about this project. The assistant can read your files and propose
            commands, but nothing runs until you approve it.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="turn" data-role={turn.role}>
            <span className="turn__who">{turn.role === "user" ? "you" : "jky"}</span>
            <div className="turn__text">{turn.text}</div>
          </div>
        ))}

        {tools.map((req) => (
          <ToolCard
            key={req.id}
            request={req}
            onApprove={(id) => {
              void getPlatform().ai.approveTool(id);
              setTools((t) => t.filter((x) => x.id !== id));
            }}
            onReject={(id) => {
              void getPlatform().ai.rejectTool(id);
              setTools((t) => t.filter((x) => x.id !== id));
            }}
          />
        ))}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="chat__compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="input"
          aria-label="Message"
          placeholder="Ask about this project…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Style it**

`apps/desktop/src/features/assistant/Assistant.css`:

```css
.chat {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
}

.chat__log {
  overflow-y: auto;
  padding: var(--s5);
  display: grid;
  gap: var(--s4);
  align-content: start;
}

.chat__empty {
  color: var(--text-dim);
  font-family: var(--font-sans);
  max-width: 48ch;
}

.turn {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: var(--s3);
}

.turn__who {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  padding-top: 2px;
}

.turn[data-role="assistant"] .turn__who {
  color: var(--accent);
}

.turn__text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.tool {
  border: 1px solid var(--line-strong);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius);
  padding: var(--s4);
  display: grid;
  gap: var(--s3);
  background: var(--surface);
}

.tool[data-destructive="true"] {
  border-left-color: var(--danger);
}

.tool__head {
  display: flex;
  gap: var(--s3);
  align-items: center;
  font-size: 12px;
  color: var(--text-dim);
}

.tool__warn {
  color: var(--danger);
  letter-spacing: 0.08em;
}

.tool__cmd {
  margin: 0;
  padding: var(--s3);
  background: var(--ground);
  border-radius: var(--radius);
  color: var(--text);
  overflow-x: auto;
}

.tool__why {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-muted);
}

.tool__actions {
  display: flex;
  gap: var(--s2);
}

.chat__compose {
  display: flex;
  gap: var(--s2);
  padding: var(--s3);
  border-top: 1px solid var(--line);
  background: var(--surface);
}
```

- [ ] **Step 7: Add it to the rail**

In `apps/desktop/src/app/Rail.tsx`, add to `RAIL_ITEMS`:

```tsx
  { id: "assistant", label: "Assistant", glyph: "✦" },
```

and render it in `App.tsx` when `section === "assistant"`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 123 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(assistant): add the streaming chat panel and the approval card"
```

---

## Task 8: Use it against the real API

Every prior task is verified by tests against mocks. This one is verified by a
real request with a real key, because that is the only thing that proves the
headers, the body shape, and the SSE decoding are all simultaneously right.

**Files:** none.

- [ ] **Step 1: Launch and connect a provider**

```bash
pnpm run dev:desktop
```

Go to **Providers**, paste a real Anthropic key, confirm the row reads
**connected**.

- [ ] **Step 2: Ask something simple**

Open **Assistant**, send "say hello in five words". Expected: text streams in
token by token, not all at once at the end. If it arrives in one lump, the SSE
decoder is buffering the whole response — check that `stream: true` is in the
body.

- [ ] **Step 3: Trigger a tool**

Send "what files are in the crates directory". Expected: the assistant calls
`list_dir` without asking permission, since it is read-only.

- [ ] **Step 4: Trigger the gate**

Send "run the test suite". Expected: a tool card showing the exact command and
a reason, with **Run** and **Don't run**. Nothing executes until you click.
Click **Don't run** and confirm nothing happened.

- [ ] **Step 5: Trigger the escalation**

Send "delete the target directory with rm -rf". Expected: the card is marked
destructive and **Run** is disabled until the command is retyped exactly.

- [ ] **Step 6: Check the audit log**

```bash
cat ~/.config/dev.jky.terminal/audit.jsonl | tail -20
```

Expected: one line per event — `SecretRead`, `ProviderRequest`, `ToolCall`,
and `CommandRejected` for the declined command. Every line valid JSON.

- [ ] **Step 7: Confirm the key never left Rust**

With the app running, open the webview devtools and run in the console:

```js
await window.__TAURI_INTERNALS__.invoke("vault_get_secret", { provider: "anthropic" })
```

Expected: an error that the command does not exist. That is the property the
whole design rests on, and this is the only way to observe it from the
attacker's side of the boundary.

---

## Task 9: Verify and merge

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm run verify
```

Expected: all green. Record the actual output.

- [ ] **Step 2: Confirm no literal colours crept in**

```bash
# Quote the globs. Under zsh an unquoted --include=*.tsx is expanded by the
# shell, grep errors, and the pipeline prints nothing — which looks exactly
# like a pass.
grep -rnE '#[0-9a-fA-F]{3,8}\b' apps/desktop/src --include='*.tsx' --include='*.ts' \
  | grep -v 'theme.ts' | grep -v '.test.'
```

Expected: no output.

- [ ] **Step 3: Push and confirm the platform matrix**

```bash
git push origin HEAD
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: ubuntu, macos and windows all green. `reqwest` with `rustls-tls`
rather than native TLS is what keeps the Windows and macOS jobs from needing
extra system packages — if a TLS link error appears there, that feature flag
is the first thing to check.

---

## Deliberate deviation from the spec

**Spec §5.4 (context transparency)** describes injecting cwd, git branch and
status, open file paths and recent terminal output into every request, then
disclosing that in a collapsible chip so the user can see what left their
machine.

This plan sends **no automatic context at all**. The conversation carries only
what the user typed; anything else the model wants, it must fetch through a
tool call — and every tool call is visible in the transcript.

The reasoning: a disclosure chip summarises a payload the user cannot inspect
and did not ask for. Sending nothing by default removes the thing the chip
exists to explain. "Your terminal output was included" is a weaker guarantee
than "nothing was included unless you watched it be read", and the second
costs a round trip rather than a design.

The trade is real and worth naming: the assistant starts each conversation
knowing nothing about the project, so simple questions cost an extra tool
call. If that friction outweighs the transparency in practice, the spec's
approach is the fallback — and the chip becomes mandatory the moment anything
is injected without being asked for.

---

## Definition of Done

Complete when every one of these has been observed, not assumed:

- [ ] `cargo test --workspace` and `cargo clippy -D warnings` pass
- [ ] `pnpm run verify` passes
- [ ] A real question streams a real answer token by token
- [ ] A read-only tool runs without a prompt
- [ ] `run_command` **never** runs without an explicit click
- [ ] A destructive command requires retyping it
- [ ] Declining a command leaves it unexecuted, and the audit log records it
- [ ] `audit.jsonl` holds one valid JSON object per line
- [ ] No IPC command can read the key, checked from the devtools console
- [ ] CI green on ubuntu, macos and windows
- [ ] Every commit shows `kartikeyajay2006` as sole author with no trailers
- [ ] No context reaches the model except through a visible tool call

## What Plan 4 builds on this

Plan 4 (Dashboard) adds `crates/jky-store` for SQLite-backed notes, calendar
events and reminders, and moves the audit log behind the same store so it
becomes searchable. Nothing in the assistant changes.
