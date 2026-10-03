# Architecture

<p align="center">
  <img src="img/banner-architecture.svg" alt="Architecture — nineteen Rust crates, one thin IPC layer, and a webview that only asks" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-ffc131?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Rust-19%20crates-dea584?style=flat-square&logo=rust&logoColor=white" alt="19 Rust crates">
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/xterm.js-6-00e5ff?style=flat-square" alt="xterm.js 6">
  <img src="https://img.shields.io/badge/pnpm%20%2B%20Turbo-monorepo-bd93f9?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm and Turbo monorepo">
</p>

This page is for contributors and for anyone evaluating how JKY is built. It explains the layers, where
each responsibility lives, and the handful of rules that the tests enforce so the design cannot quietly
erode.

**On this page:** [Three layers](#three-layers) · [Repository layout](#repository-layout) ·
[The crates](#the-nineteen-crates) · [The IPC layer](#the-ipc-layer) · [The platform adapter](#the-platform-adapter) ·
[A command's journey](#a-commands-journey) · [Processes](#processes-at-runtime) ·
[Rules the tests enforce](#rules-the-tests-enforce) · [Build and test](#build-and-test)

---

## Three layers

```mermaid
flowchart TB
    subgraph UI["🎨 Interface · apps/desktop/src"]
        direction LR
        F[features/<br/>terminal · editor · assistant · …]:::violet
        S[app/<br/>stores · shell · shortcuts]:::violet
        P[platform/<br/>the only door to native]:::magenta
        F --> P
        S --> P
    end
    subgraph IPC["🚪 Commands · apps/desktop/src-tauri/src/commands"]
        C[113 thin #91;tauri::command#93; wrappers]:::amber
    end
    subgraph CORE["🦀 Logic · crates/"]
        direction LR
        K1[jky-pty · jky-detach]:::cyan
        K2[jky-files · jky-workspace]:::cyan
        K3[jky-ai · jky-secrets]:::cyan
        K4[… 13 more]:::cyan
    end
    P == "invoke()" ==> C
    C --> K1 & K2 & K3 & K4

    classDef cyan fill:#00e5ff,stroke:#00a3b5,color:#06141a
    classDef amber fill:#ffb340,stroke:#d18a12,color:#1f1300
    classDef violet fill:#7c3aed,stroke:#5b21b6,color:#ffffff
    classDef magenta fill:#ff3cf0,stroke:#c026d3,color:#1a0618
```

| Layer | Holds | Rule |
|---|---|---|
| **Interface** | React components, Zustand stores, xterm.js | Never calls Tauri directly. Every native capability goes through `platform/`. |
| **Commands** | `#[tauri::command]` functions | Thin wrappers only — parse arguments, call a crate, return a result. |
| **Crates** | All real logic | Plain Rust libraries with their own unit tests, usable without Tauri. |

**The window can ask; only Rust can act.** That sentence is the architecture. It is why the logic is
testable without a window, why the interface can run in a plain browser, and why the security model can
be described in a page.

---

## Repository layout

```text
jky-terminal/
├── apps/desktop/
│   ├── src/                     React interface
│   │   ├── app/                 shell, rail, tabs, stores, shortcuts, theme
│   │   ├── features/            one folder per section — terminal, editor, assistant, …
│   │   ├── platform/            tauri.ts (real) · web.ts (browser stand-in) · types.ts
│   │   ├── components/          shared UI pieces
│   │   └── styles/              tokens.css · themes.css — every colour lives here
│   └── src-tauri/
│       ├── src/commands/        the 113 IPC commands, thin
│       ├── src/supervisor.rs    the --supervise entry point
│       ├── src/turn.rs          the assistant's tool loop
│       ├── tests/security.rs    the boundary, as tests
│       ├── capabilities/        the window's (minimal) Tauri permissions
│       └── tauri.conf.json      CSP, bundle settings
├── crates/                      19 Rust libraries — all real logic
├── docs/                        you are here
├── scripts/                     clean-dist · scan-bundle
└── .github/workflows/           ci.yml · release.yml
```

---

## The nineteen crates

| Crate | Responsibility |
|---|---|
| 🟢 **jky-pty** | Spawning shells in a PTY, resolving which shell, shell-integration hooks for bash, zsh, fish, Nushell and PowerShell, and the `jky` launchers. |
| 🟢 **jky-detach** | Shells that outlive the window: the supervisor, its socket or named pipe, join/open/end/prune. |
| 🟢 **jky-history** | Every command you have run, the subsequence search and ranking. |
| 🟢 **jky-memory** | Work Memory: every run with its output tail, duration, git branch and revision, pin and note, in SQLite with a trigram full-text index; redacted and bounded before it is stored, schema-versioned with migrations. |
| 🟢 **jky-complete** | What could come next on a command line — without running anything. |
| 🟢 **jky-live** | Re-running one of three known commands so a panel can stay current. |
| 🟢 **jky-keys** | What every key is bound to; the modifier and `Ctrl+C`/`Ctrl+D` rules. |
| 🔵 **jky-persist** | Atomic, flushed writes and schema-numbered JSON documents with migrations — shared by every store. |
| 🔵 **jky-files** | Reading and writing inside one directory and nowhere else. |
| 🔵 **jky-workspace** | Saved workspaces. |
| 🔵 **jky-settings** | Non-secret preferences. |
| 🔵 **jky-store** | Dashboard data and scrollback. |
| 🟣 **jky-ai** | Providers (Anthropic, OpenAI-compatible incl. Ollama), streaming, tools, the path sandbox, risk labels, approved-command execution. |
| 🟣 **jky-redact** | Recognising secrets in text — keys, tokens, JWTs, private keys, credentials in context — and replacing them with labels. |
| 🟣 **jky-secrets** | The keychain, the provider and model catalogue, key shape checks, a zeroising secret type. |
| 🟣 **jky-audit** | The append-only, hash-chained audit log, its keychain anchor and its verifier. |
| 🟠 **jky-remote** | Saved hosts and the `ssh` argument validation. |
| 🟠 **jky-apps** | Apps that fetch: GitHub, Gmail, weather, places, routes, news, the HTTP client, the browser's URL rules. |
| 🟠 **jky-tools** | Developer tools that need a dependency. |
| 🟠 **jky-system** | What the machine is doing: CPU, memory, disks, processes, DNS. |
| 🟠 **jky-ports** | What is listening on this machine. |
| 🟠 **jky-capture** | What happens to a picture once the window has taken one. |

🟢 terminal core · 🔵 data · 🟣 trust · 🟠 integrations

---

## Data on disk

Every file JKY keeps falls into one of two kinds, and each kind has one rule for change.

| Kind | Files | How it changes safely |
|---|---|---|
| **Documents** — read whole, written whole | `settings.json`, `keymap.json`, `workspaces.json`, `hosts.json`, `notes.json`, `todos.json`, `events.json`, `reminders.json` | Each carries a top-level `"schema"` number. `jky-persist` walks an older file forward one migration at a time when it is read, and **refuses** a file from a newer build — for reading and therefore for writing — because an older build would drop the fields it does not know on its next save. Unnumbered files from before schemas are schema 0. |
| **Logs** — appended line by line | `audit.jsonl` | New fields are always optional, so every old line still parses. A log is never rewritten to change its shape. |
| **Database** — SQLite, changed in transactions | `memory.sqlite3` (Work Memory: every run, its output tail, duration, git state, pin and note) | `PRAGMA user_version` is the schema number. Each migration runs in its own transaction, so a crash leaves the last complete version. A database from a newer build is refused **before anything is written to it** — not even its journal mode is changed — and that session keeps its history in memory. The `history.jsonl` of earlier versions is imported once, in one transaction, and only then removed. |

Every whole-file write goes through one function, `jky_persist::atomic_write`: a uniquely named
temporary file, `sync_all`, a rename over the original, and on Unix a flush of the directory. A crash
or power cut leaves the previous contents, never a mixture — and two overlapping writers each get
their own temporary file.

---

## The IPC layer

Each command is a few lines: take arguments, call a crate, map the error to a string. The full list is
pinned by name in a test, with a comment for every entry explaining why that widening of the window's
reach is acceptable.

```mermaid
sequenceDiagram
    autonumber
    participant C as Component
    participant P as platform/tauri.ts
    participant I as files_read (command)
    participant K as jky-files
    C->>P: platform.files.read(root, "src/app.ts")
    P->>I: invoke("files_read", { root, path })
    I->>K: workspace(settings, root)?.read(path)
    K->>K: open beneath the folder handle, size, UTF-8
    K-->>I: Ok(text) or FileError
    I-->>P: Result<String, String>
    P-->>C: text — or a thrown, readable error
```

Long-running work — the PTY stream, assistant streaming, live panels — uses Tauri events rather than
return values, but the same rule holds: the window subscribes; Rust decides what is sent.

---

## The platform adapter

Every native capability the interface uses is declared once, in `platform/types.ts`, and implemented
twice:

| Implementation | Used when | Behaviour |
|---|---|---|
| `platform/tauri.ts` | In the desktop app | Calls the real IPC commands |
| `platform/web.ts` | `pnpm dev` in a browser, and in tests | Keeps values in closures that die with the tab — **never** `localStorage` for anything secret |

**Parity tests** keep the two honest: the browser catalogue of `jky` commands, apps, keymap defaults and
store shapes are checked against the Rust source, so a change on one side without the other fails the
build. A component calling `invoke()` directly is a lint error.

This is what lets 2,200+ interface tests run in a fast, headless environment while the Rust side carries
its own 1,000+ tests.

---

## A command's journey

From a key press to a panel, using `git status -s` as the example:

```mermaid
flowchart LR
    K([⌨ Enter]):::ink --> X[xterm.js<br/>onData]:::violet
    X -- pty_write --> R[Rust<br/>jky-pty]:::cyan
    R --> SH[zsh]:::ink
    SH -- "OSC 133;C · output · 133;D · 1337 JKYDone" --> R
    R -- event stream --> X
    X --> M[MarkTracker<br/>finds the block]:::amber
    M --> REC[recognise#40;#41;<br/>8 parsers in order]:::magenta
    M --> H[history_record]:::mint
    REC --> PANEL([Panel beneath the output]):::lime

    classDef ink fill:#14141f,stroke:#2a2a3c,color:#e8e8f2
    classDef cyan fill:#00e5ff,stroke:#00a3b5,color:#06141a
    classDef amber fill:#ffb340,stroke:#d18a12,color:#1f1300
    classDef violet fill:#7c3aed,stroke:#5b21b6,color:#ffffff
    classDef mint fill:#3ddc97,stroke:#15a36b,color:#04170f
    classDef magenta fill:#ff3cf0,stroke:#c026d3,color:#1a0618
    classDef lime fill:#a3e635,stroke:#65a30d,color:#111a03
```

The recognisers run in the interface because they only interpret text the window already has. Anything
that *acts* — re-running a command for a live panel, reading a file, recording history — goes back
through an IPC command.

---

## Processes at runtime

```mermaid
flowchart TB
    APP["jky-terminal<br/>(window process)"]:::violet
    S1["jky-terminal --supervise tab-1"]:::cyan
    S2["jky-terminal --supervise tab-2"]:::cyan
    SH1[zsh]:::ink
    SH2[zsh → cargo build]:::ink
    SSH["ssh prod<br/>(child of the window)"]:::amber
    APP -. socket / named pipe .- S1
    APP -. socket / named pipe .- S2
    S1 --> SH1
    S2 --> SH2
    APP --> SSH

    classDef ink fill:#14141f,stroke:#2a2a3c,color:#e8e8f2
    classDef cyan fill:#00e5ff,stroke:#00a3b5,color:#06141a
    classDef amber fill:#ffb340,stroke:#d18a12,color:#1f1300
    classDef violet fill:#7c3aed,stroke:#5b21b6,color:#ffffff
```

- Each local pane's shell is held by its own **supervisor**, the same binary run with `--supervise`.
  The window connects as a client.
- Supervisor sockets live in a directory only your user can enter; on Windows each named pipe admits
  only its owner.
- A supervisor exits with its shell. On start, the window ends any supervisor no pane claims.
- **Remote panes are children of the window**, so they end with it and are never reopened
  automatically.

---

## Rules the tests enforce

| Rule | Enforced by |
|---|---|
| Logic lives in `crates/`; commands are thin | Code review, and the pinned command list |
| Every native call goes through `platform/` | ESLint |
| No IPC command returns a secret | `security.rs` — name scan and return-type scan |
| The command surface changes only on purpose | `security.rs` — exact list by name |
| `connect-src` names no external host | `security.rs` |
| The window has no fs, shell or http capability | `security.rs` |
| No literal colour in a component | ESLint |
| Every theme's text meets WCAG contrast on its ground | A theme test computes it |
| `prefers-reduced-motion` honoured by one rule | A test pins it |
| The entry bundle stays within budget, with no credential-shaped strings | `scripts/scan-bundle.mjs` |
| The browser adapter matches the Rust catalogues | Parity tests |
| Recognisers match real shells | Recorded `zsh -i` and `bash -i` sessions |

---

## Build and test

```mermaid
flowchart LR
    subgraph JS["pnpm + Turbo"]
        T1[typecheck]:::violet --> T2[lint]:::violet --> T3[vitest<br/>2,311 tests]:::violet --> T4[vite build]:::violet --> T5[scan:bundle]:::red
    end
    subgraph RS["cargo"]
        R1[cargo test --workspace<br/>1,276 tests]:::cyan --> R2[clippy -D warnings]:::cyan --> R3[cargo build -p jky-terminal]:::cyan
    end
    JS --> OK([✓ ready to push]):::mint
    RS --> OK

    classDef cyan fill:#00e5ff,stroke:#00a3b5,color:#06141a
    classDef violet fill:#7c3aed,stroke:#5b21b6,color:#ffffff
    classDef mint fill:#3ddc97,stroke:#15a36b,color:#04170f
    classDef red fill:#ff4d6a,stroke:#d91f3d,color:#ffffff
```

```sh
pnpm run verify                                        # clean, typecheck, lint, test, build, scan
cargo test --workspace                                 # every crate and the app
cargo clippy --workspace --all-targets -- -D warnings  # no warnings, anywhere
```

Test counts are as of October 2026 and grow with the code. The CI pipeline that runs these on Linux,
macOS and Windows is described in [Operations & releases](operations-and-releases.md).

---

<p align="center">
  <a href="apps-and-tools.md">← Apps, tools & games</a> &nbsp;·&nbsp;
  <a href="README.md">Documentation home</a> &nbsp;·&nbsp;
  <a href="troubleshooting.md">Next: Troubleshooting →</a>
</p>
