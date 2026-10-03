# JKY Terminal — Showcase & Tour

<p align="center">
  <img src="img/hero.svg" alt="An animated tour of JKY Terminal in four scenes: output becomes a panel, shells outlive the window, the assistant has to ask, and one command changes the whole theme" width="100%">
</p>

A visual tour of what makes JKY Terminal different, in the order you would meet it. Every animation on
this page shows behaviour the app really has; the [documentation](README.md) has the details, the
limits and the reasoning.

**On this page:** [Panels](#1-any-command-can-become-an-app) · [Persistence](#2-shells-outlive-the-window) ·
[Themes](#3-seven-purpose-built-design-themes) · [Security](#4-zero-ambient-authority-security-model) ·
[One window](#5-ten-sections-in-one-window) · [Workflows](#6-real-world-workflows)

---

## 1. Any command can become an app

A shell answers in text because a pipe is the only thing it can answer in. `df` reports how full your
disks are and `docker ps` the state of your containers — both are tables flattened on the way out. JKY
reads the flattening back and draws a panel **beneath** the raw output.

<p align="center">
  <img src="img/command-panels.svg" alt="Four panels building themselves: git log as a timeline, df -h as disk bars fullest first, git status -s split into staged and unstaged, and JSON as a tree" width="100%">
</p>

Eight deterministic recognisers — `git status`, `git log`, `docker ps`, `df`, `ps`, `ls`, `mkdir` and
JSON — run in the interface over text the window already has. No model is involved, and three rules
make them safe to leave on:

1. **Never replaces output.** The raw text stays in the scrollback; a panel can be dismissed.
2. **Actions type, never run.** A button places a command at your prompt. You press <kbd>Enter</kbd>.
3. **Pipes decline.** `docker ps | grep api` prints grep's output, so every recogniser declines.

`df -h`, `ps aux` and `docker ps` can also stay **live**: Rust re-runs one of those three fixed commands
itself, with no shell in between. [More →](terminal-guide.md#every-command-can-become-a-panel)

---

## 2. Shells outlive the window

In most terminals, closing the window ends every shell in it. In JKY, each pane's shell is held by a
small **supervisor** — the same binary run with `--supervise` — and the window is only a client of it.

- Close the window mid-build and the build keeps going.
- Reopen JKY and each pane rejoins its shell, drawing the tail of what it printed while you were away.
- **Closing a pane ends its shell; quitting does not.** They are different acts.
- Supervisor sockets live in a directory only your user can enter; on Windows each named pipe admits
  only its owner.
- A reboot or logging out still ends shells — this is continuity for the window, not immortality.

[More →](terminal-guide.md#shells-that-outlive-the-window)

---

## 3. Seven purpose-built design themes

JKY Terminal ships with **seven themes**, and every one of them is a set of values for the same design
tokens. No component contains a literal colour — a lint rule rejects one — and a test checks every
theme's text contrast against its own ground.

<p align="center">
  <img src="img/themes-live.svg" alt="One JKY Terminal window cycling live through all seven themes" width="900">
</p>

| Theme | Character | Ground | Accent | Second accent | Text on ground |
|---|---|:-:|:-:|:-:|:-:|
| **Cyberpunk** | default · dark · neon kept for what is active | ![#08080c](https://img.shields.io/badge/%2308080c-08080c?style=flat-square) | ![#00e5ff](https://img.shields.io/badge/%2300e5ff-00e5ff?style=flat-square) | ![#ff3cf0](https://img.shields.io/badge/%23ff3cf0-ff3cf0?style=flat-square) | **16.4 : 1** |
| **Dracula** | dark · the Dracula palette | ![#21222c](https://img.shields.io/badge/%2321222c-21222c?style=flat-square) | ![#8be9fd](https://img.shields.io/badge/%238be9fd-8be9fd?style=flat-square) | ![#bd93f9](https://img.shields.io/badge/%23bd93f9-bd93f9?style=flat-square) | **14.8 : 1** |
| **Nord** | dark · arctic blues, low glare | ![#2e3440](https://img.shields.io/badge/%232e3440-2e3440?style=flat-square) | ![#88c0d0](https://img.shields.io/badge/%2388c0d0-88c0d0?style=flat-square) | ![#a3be8c](https://img.shields.io/badge/%23a3be8c-a3be8c?style=flat-square) | **10.8 : 1** |
| **Solarized** | dark · the Solarized palette | ![#002b36](https://img.shields.io/badge/%23002b36-002b36?style=flat-square) | ![#2aa198](https://img.shields.io/badge/%232aa198-2aa198?style=flat-square) | ![#b58900](https://img.shields.io/badge/%23b58900-b58900?style=flat-square) | **12.3 : 1** |
| **Light** | light · crisp daylight | ![#f7f7fa](https://img.shields.io/badge/%23f7f7fa-f7f7fa?style=flat-square) | ![#0f62fe](https://img.shields.io/badge/%230f62fe-0f62fe?style=flat-square) | ![#6929c4](https://img.shields.io/badge/%236929c4-6929c4?style=flat-square) | **16.8 : 1** |
| **Gold** | light · warm parchment, amber to bronze | ![#fbf7ef](https://img.shields.io/badge/%23fbf7ef-fbf7ef?style=flat-square) | ![#8a6108](https://img.shields.io/badge/%238a6108-8a6108?style=flat-square) | ![#2f7d55](https://img.shields.io/badge/%232f7d55-2f7d55?style=flat-square) | **14.0 : 1** |
| **High Contrast** | WCAG AAA · loud borders, no shadows | ![#000000](https://img.shields.io/badge/%23000000-000000?style=flat-square) | ![#00ffff](https://img.shields.io/badge/%2300ffff-00ffff?style=flat-square) | ![#ffd24d](https://img.shields.io/badge/%23ffd24d-ffd24d?style=flat-square) | **21.0 : 1** |

Switch from **Settings → Appearance**, or from any terminal with `jky theme <name>`.

---

## 4. Zero-ambient-authority security model

<p align="center">
  <img src="img/security-flow.svg" alt="A file request travels down through the window, the pinned IPC commands and the Rust core to the machine and back; the window's own attempt to reach the internet is blocked; the API key stays in the keychain" width="100%">
</p>

- **`connect-src 'self'`.** The webview can connect to the app itself and Tauri's IPC channel, nothing
  else. Even code injected into the window would have nowhere to send anything.
- **No secret getters.** No IPC command returns a key. Keys live in the OS keychain and are read only by
  Rust, only to make a request, in a type that is zeroed when dropped.
- **121 commands, pinned.** A test lists every IPC command by name; adding one fails the build until it
  is justified.
- **Folders you open.** The editor and the assistant's file tools reach only folders you chose, checked
  beneath an open handle to the folder, so `../`, links out and mid-operation swaps are refused.
- **A local audit log** records key reads, provider requests, the assistant's tool calls, approved and
  declined commands, account links and captures. It is append-only, and the window cannot read it.

[More →](security-and-privacy.md)

---

## 5. Ten sections in one window

| | Section | What is in it |
|:-:|---|---|
| `❯` | **Terminal** | xterm.js with WebGL2, geometric splits, supervised shells, panels, completions |
| `✎` | **Editor** | CodeMirror 6 over several folders; images and PDFs preview |
| `▦` | **Workspaces** | Named setups — folders, start folder, terminals, a host — and Git worktrees |
| `⇄` | **Remote** | Saved SSH hosts run through your own `ssh`, agent and config |
| `↺` | **History** | Subsequence search: `dkrps` finds `docker ps` |
| `✦` | **Assistant** | Anthropic, OpenAI or local Ollama; every command waits for approval |
| `⌂` | **Dashboard** | Notes, todos, a calendar and daily reminders, also scriptable with `jky` |
| `⌥` | **Developer** | Twelve tools — JSON, YAML, Diff, Hash, JWT, Regex, HTTP, System Monitor, Processes, Ports, Environment, DNS |
| `⊞` | **Apps** | GitHub, Gmail (read-only), Browser, Weather, News, Map, Calculator, Timer |
| `◈` | **Games** | Dino Run, Snake, Tic Tac Toe, Flappy Bird, 2048 |

---

## 6. Real-world workflows

### The full-stack engineer

1. Save a workspace for the project: its folders, a start folder, and three terminals.
2. Switch to it from the palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>) — the editor opens the folders and three
   terminals start in the right place. Split them how you like with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>.
3. Run the server, the tests and the database client. Close the app at lunch; they keep running.
4. Paste an API response into **Developer → JSON**, or decode a token in **JWT** — offline.

### The infrastructure lead

1. Save production hosts in **Remote**. JKY uses your own `ssh`, agent and `known_hosts`; it stores no
   credential and never reconnects on its own after a restart.
2. Watch `df -h` and `docker ps` as **live** panels while you work.
3. Give production its own workspace, with a note that says so.

### The AI-assisted developer

1. Open the **Assistant** from the rail, or ask from any terminal: `jky ask why is this slow`.
2. It reads the project freely to understand the problem — inside the project folder only.
3. **Every command it proposes waits for you**, labelled by risk; destructive ones must be typed back.
4. Prefer it offline? Choose **Ollama** in Settings → Providers.

---

<p align="center">
  <a href="README.md">📚 Documentation home</a> &nbsp;·&nbsp; <a href="comparison.md">⚖️ How JKY compares</a>
</p>

*Authored and engineered by **kartikeyajay2006** under the MIT License.*
