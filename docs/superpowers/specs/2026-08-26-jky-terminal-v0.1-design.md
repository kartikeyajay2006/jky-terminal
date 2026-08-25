# JKY Terminal v0.1 — "The Cockpit" Design Spec

- **Date:** 2026-08-26
- **Owner:** [@kartikeyajay2006](https://github.com/kartikeyajay2006)
- **Status:** Approved — ready for implementation planning
- **Supersedes for build purposes:** `ROADMAP.md` phases 0–16 remain the long-range
  vision. This spec defines the *first shippable release* and reorders the roadmap's
  security work to the front.

---

## 1. Purpose

Ship a real, installable, daily-usable AI terminal — not a mockup and not a nine-week
march. v0.1 delivers everything in the reference concept that does not require a
third-party OAuth handshake, with the secrets layer built before anything that holds
a secret.

### Success criteria

v0.1 is done when all of the following are true:

1. The app installs and launches on Linux, macOS and Windows.
2. A real PTY shell runs in a tab: job control, resize, signals, colour, and
   interactive programs (`vim`, `htop`, `top`) all behave correctly.
3. The user pastes an Anthropic API key once, and it is never readable by the
   frontend again — verified by an automated test, not by inspection.
4. The AI assistant streams replies token-by-token and can call tools against the
   real working directory, with every state-mutating call gated behind explicit
   confirmation.
5. Calendar, notes, reminders and the system monitor all work and survive restart.
6. All six themes render every surface correctly with no hard-coded colours.
7. CI is green: `cargo test`, `cargo clippy -D warnings`, Vitest, Playwright,
   axe-core, and the three security assertions in §4.3.

### Non-goals for v0.1

Explicitly deferred, with the release that will carry them:

| Deferred | Target |
|---|---|
| OAuth integrations hub (GitHub, Google, Slack, Notion, AWS, K8s) | v0.2 |
| Browser tab (embedded webview) | v0.2 |
| Database tab (drivers, connection secrets, query grid) | v0.2 |
| WASM plugin sandbox + marketplace | v0.3 |
| Pro plan, billing, hosted AI credits | post-v1.0 |
| Cloud sync, mobile app, team server | post-v1.0 |

---

## 2. Architecture

### 2.1 Repository layout

```
jky-terminal/
├─ apps/
│  └─ desktop/
│     ├─ src/                   React 18 + TypeScript + Vite
│     │  ├─ app/                shell, layout, providers
│     │  ├─ features/
│     │  │  ├─ terminal/        xterm.js + WebGL addon
│     │  │  ├─ assistant/       chat, streaming, tool cards
│     │  │  ├─ editor/          Monaco
│     │  │  ├─ dashboard/       calendar, notes, reminders, monitor
│     │  │  ├─ palette/         command palette + omnibox
│     │  │  └─ settings/        keys, themes, audit log
│     │  ├─ platform/           platform adapter (see §2.2)
│     │  └─ styles/             tokens, theme definitions
│     └─ src-tauri/
│        ├─ src/
│        │  ├─ main.rs
│        │  ├─ commands/        #[tauri::command] wrappers ONLY
│        │  └─ state.rs
│        └─ Cargo.toml
├─ crates/                      Rust workspace
│  ├─ jky-secrets/              SecretStore trait + OS keychain impl
│  ├─ jky-pty/                  portable-pty spawn/resize/IO
│  ├─ jky-ai/                   AIProvider trait + Anthropic adapter
│  └─ jky-store/                sqlx SQLite + migrations
├─ packages/
│  └─ ui/                       design tokens + shared primitives
└─ docs/
```

**Deviation from `ROADMAP.md` §3:** the roadmap placed Rust crates (`pty-bridge`)
inside `packages/` next to TypeScript packages. That directory is a pnpm workspace
root; mixing cargo crates into it confuses both toolchains and breaks
`pnpm -r` globbing. Rust moves to `crates/`.

### 2.2 The platform adapter

`apps/desktop/src/platform/` exports one interface with two implementations:

- `tauri.ts` — real `invoke()` calls to the Rust backend.
- `web.ts` — in-memory mocks (fake PTY echo, fake keychain, canned AI stream).

Selected at build time by a Vite define. This gives two properties that matter:

1. **Fast iteration.** UI work runs as a plain web app with instant HMR and browser
   devtools, with no Rust recompile and no `webkit2gtk` dependency.
2. **Testability.** Playwright E2E runs against the web build in CI without needing
   a windowing system or an OS keychain.

Every native capability must be reached through this adapter. A component that calls
`invoke()` directly is a bug and is caught by an ESLint rule restricting that import
to `platform/tauri.ts`.

### 2.3 Logic placement rule

`src-tauri/src/commands/` contains only thin `#[tauri::command]` wrappers that
deserialize arguments, call into a crate, and serialize the result. All real logic
lives in `crates/`, so it is unit-testable with `cargo test` without launching a
window or a webview.

---

## 3. Rust crates

### 3.1 `jky-secrets`

```rust
pub struct Secret<T>(T);          // Debug/Display print "[redacted]"

pub trait SecretStore: Send + Sync {
    fn set(&self, key: &str, value: Secret<String>) -> Result<()>;
    fn get(&self, key: &str) -> Result<Secret<String>>;   // crate-internal callers only
    fn has(&self, key: &str) -> Result<bool>;
    fn delete(&self, key: &str) -> Result<()>;
    fn list_keys(&self) -> Result<Vec<String>>;           // names only, never values
}
```

v0.1 ships one implementation, `KeyringStore`, backed by the `keyring` crate
(Linux Secret Service / macOS Keychain / Windows Credential Manager), using service
name `dev.jky.terminal` and the provider id as the account.

The trait exists so v0.2's layered OAuth vault is an added implementation rather
than a migration of every call site.

### 3.2 `jky-pty`

Wraps `portable-pty`. Spawns the user's login shell, handles resize, forwards
signals, and streams output. One session per terminal tab, keyed by a session id.
Output is pushed to the frontend as Tauri events rather than polled.

### 3.3 `jky-ai`

```rust
pub trait AIProvider: Send + Sync {
    async fn stream_chat(&self, req: ChatRequest) -> Result<impl Stream<Item = ChatEvent>>;
    fn list_models(&self) -> Vec<ModelInfo>;
    fn supports_tools(&self) -> bool;
}
```

v0.1 ships one implementation: `AnthropicProvider`, using the Messages API with
streaming. Default model `claude-sonnet-5`; `claude-opus-5` selectable as
"deep think". The trait means adding OpenAI or Ollama in a later release touches one
new file and one settings enum.

### 3.4 `jky-store`

SQLite via `sqlx`, migrations under `crates/jky-store/migrations/`.

| Table | Purpose |
|---|---|
| `notes` | markdown notes, FTS5 full-text index |
| `events` | calendar events |
| `reminders` | due time, completion state |
| `command_history` | every command run, with cwd + exit code |
| `conversations`, `messages` | AI chat history per workspace |
| `audit_log` | secret reads, command executions, AI tool calls |

---

## 4. Security model

The user's stated priority #1. Described here precisely, including its one limitation.

### 4.1 Key lifecycle

```
Settings UI ──vault_set_secret()──▶ jky-secrets ──▶ OS Keychain
 (key in JS memory once,             Secret<String>    (Secret Service /
  at entry, then dropped)                               Hello / macOS)
                                                             │
Assistant UI ──ai_chat_send()──▶ jky-ai ◀──reads key─────────┘
     ▲                              │
     └──── ai:token events ─────────┘ ──▶ api.anthropic.com  (Rust only)
```

### 4.2 Controls

1. **No key-reading IPC command exists.** The exposed surface is
   `vault_set_secret`, `vault_has_secret -> bool`, `vault_delete_secret`, and
   `vault_list_providers` (names only). There is deliberately no command that
   returns a secret value. An absent command cannot be exploited or mis-permissioned.
2. **CSP `connect-src 'self'`.** The webview cannot open a network connection to any
   external host. A fully compromised frontend — a malicious transitive npm
   dependency, an XSS in rendered markdown — has nowhere to exfiltrate to. All
   outbound traffic originates in Rust. This is the strongest control in the design.
3. **`Secret<String>` newtype.** `Debug` and `Display` render `[redacted]`, so a
   stray `dbg!()`, a panic backtrace, or a structured log line cannot leak the value.
   `Drop` zeroizes the buffer.
4. **Tauri capability manifest.** The renderer is granted no `fs`, `shell`, or `http`
   plugin capability. Every privileged action goes through an allow-listed command.
5. **Audit log.** Every keychain read, shell execution and AI tool call is written to
   `audit_log` with a timestamp and outcome, viewable and exportable from Settings.
6. **Self-hosted fonts.** Inter and JetBrains Mono are bundled, not fetched from a
   CDN — required by the CSP above and a supply-chain reduction in its own right.

### 4.3 Security assertions in CI

Three tests that fail the build:

1. Enumerate the registered Tauri command list; assert no command returns a secret
   value.
2. Parse the built `tauri.conf.json` CSP; assert `connect-src` contains no host
   other than `'self'`.
3. Scan the production JS bundle for high-entropy strings matching known API-key
   shapes; assert none are present.

### 4.4 Known limitation

The key transits JavaScript exactly once: when the user pastes it into the Settings
input. Tauri does not offer a native secure-input dialog capable of replacing this.
Mitigations: the field is `type="password"`, the value is never written to Zustand or
any persisted store, and it is cleared from component state immediately on submit.
Every subsequent use of the key is Rust-only.

This limitation is documented rather than glossed, and revisiting it (a native input
surface) is a v0.2 candidate.

---

## 5. AI assistant

### 5.1 Tools

`read_file`, `list_dir`, `git_status`, `search_codebase`, `run_command`.

### 5.2 Confirmation gate

`run_command` always renders a confirmation card showing the exact command, the
working directory, and Run / Cancel. There is no "always allow this pattern" opt-in
in v0.1 — that toggle is where irreversible mistakes originate, and it can be added
later once the confirmation UX has proven itself in real use.

### 5.3 Destructive-pattern escalation

Commands matching known-destructive patterns (`rm -rf`, `git push --force`, `dd`,
`mkfs`, fork bombs) escalate from click-to-confirm to type-the-command-to-confirm.
This applies to human-typed commands as well as AI-suggested ones.

### 5.4 Context transparency

Whatever context is sent to the model — cwd, git branch and status, open file paths,
recent terminal output — is summarised in a collapsible chip on the message, so the
user can always see what left their machine.

---

## 6. UI/UX

### 6.1 Design language

Same layout DNA as the reference concept — left workspace rail, tabbed centre
workspace, right dashboard column, bottom dock, status bar — at higher craft.

- **Neon is earned, not ambient.** The reference mockup applies glow uniformly,
  which destroys emphasis. Cyan `#00E5FF` is reserved for active, focused and
  interactive states. Everything else sits on an eight-step neutral ramp over
  `#08080C`. Elevation comes from lightness steps, not from outlining every box.
- **Palette:** ground `#08080C`, primary `#00E5FF`, accent `#FF3CF0`,
  secondary `#7C3AED`.
- **Typography:** Inter for UI, JetBrains Mono for terminal and code. Self-hosted.
- **Spacing:** 4px base unit, eight-step scale.
- **Motion:** Framer Motion springs (stiffness 400, damping 30). No fade-only
  transitions. `prefers-reduced-motion` disables transforms and keeps opacity only.
- **Density:** more vertical room for the terminal than the reference allows; the
  dashboard column collapses to an icon rail.

### 6.2 Theming

Six themes — Cyberpunk (default), Dracula, Nord, Solarized, Light, High-Contrast —
implemented as CSS custom properties swapped on `:root[data-theme]`. Components read
tokens only; a literal hex value in a component is a lint error. Adding a seventh
theme is a data file, not a refactor.

### 6.3 Accessibility

Full keyboard navigation, visible focus rings on every interactive element, ARIA
roles on all custom widgets, and axe-core assertions in CI. High-Contrast theme meets
WCAG AA contrast ratios on all text.

### 6.4 Keyboard model

`Cmd/Ctrl+K` command palette, `Cmd/Ctrl+1..5` tab switching, `Cmd/Ctrl+T` new
terminal tab, `Cmd/Ctrl+Shift+A` inline natural-language-to-command in a terminal.

---

## 7. Testing

| Layer | Tool | Scope |
|---|---|---|
| Rust units | `cargo test` | each crate in isolation; `jky-secrets` against a mock store |
| Rust lint | `cargo clippy -D warnings` | blocking |
| Frontend units | Vitest + React Testing Library | components, stores, adapter contract |
| E2E | Playwright | against the web build, no windowing system needed |
| Accessibility | axe-core | every route, all six themes |
| Security | custom | the three assertions in §4.3 |
| Dependencies | `cargo audit`, `pnpm audit` | fails on high/critical |

---

## 8. Build order

Security first, correcting the ordering defect in `ROADMAP.md` where the vault
(Phase 9) landed four phases after the AI engine that needs a key (Phase 5).

| Step | Deliverable |
|---|---|
| 0 | Monorepo scaffold, CI pipeline, platform adapter contract |
| 1 | `jky-secrets`, Settings key UI, CSP lockdown, security tests |
| 2 | Design system, app shell, six themes |
| 3 | `jky-pty`, terminal tab |
| 4 | `jky-ai`, assistant tab, tool confirmation gate |
| 5 | `jky-store`, dashboard widgets |
| 6 | Editor tab, notes integration |
| 7 | Command palette, omnibox |
| 8 | Packaging, signing, auto-update, release workflow |

---

## 9. Environment prerequisites

Verified on the development machine (Fedora 43) on 2026-08-26:

| Requirement | Status |
|---|---|
| Node 22.22, npm 11.19 | present |
| Rust 1.96 (cargo, rustc) | present |
| `gh` authenticated as `kartikeyajay2006`, scopes `repo` + `workflow` | present |
| pnpm | absent — install via `corepack enable` |
| `webkit2gtk4.1-devel`, `libsoup3-devel` | absent — required for Tauri builds |

The missing system libraries block `tauri dev` and `tauri build` only. Steps 0–2 and
all web-build testing proceed without them.

Install on Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel libsoup3-devel openssl-devel \
  curl wget file libappindicator-gtk3-devel librsvg2-devel
```

---

## 10. Licence and attribution

MIT, per the existing `LICENSE`. All commits are authored solely by
`kartikeyajay2006 <kartikeyajay2006@gmail.com>`.
