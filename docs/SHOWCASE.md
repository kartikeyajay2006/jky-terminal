# JKY Terminal — Showcase & Tour

<p align="center">
  <img src="img/hero-showcase.svg" alt="JKY Terminal Interactive Hero Showcase" width="900">
</p>

Welcome to the definitive visual and architectural showcase of **JKY Terminal**. 

Traditional terminal emulators are passive windows into a TTY pipe. When a command finishes, its rich structured data is crushed into plain ASCII text. When you close the window, your running jobs die. When you need an editor, an AI helper, or developer utilities, you're forced to switch windows.

**JKY Terminal redesigns the terminal experience from first principles.**

---

## 1. Any Command Can Become An App

When commands like `docker ps`, `df -h`, `git log`, or `ls -l` run in standard terminals, their tabular output is flattened into text columns. JKY Terminal includes deterministic Rust-based recognizers that parse structured output into reactive, interactive GUI widgets directly below the text stream.

<p align="center">
  <img src="img/command-to-app-showcase.svg" alt="Command to App Showcase" width="900">
</p>

### The Three Safety Rules
1. **Never Replaces Output**: The raw stdout/stderr remains unaltered in the scrollback. You can dismiss the app card at any time.
2. **Actions Type, Never Silently Run**: Clicking an action button (such as stopping a container or switching a branch) pre-populates your shell prompt buffer so you retain 100% control before pressing <kbd>Enter</kbd>.
3. **Pipes Decline**: Commands connected with pipes (e.g. `docker ps | grep api`) are deliberately bypassed to ensure only true, authoritative output is parsed.

---

## 2. Shells Outlive The Window (tmux-less Persistence)

In standard terminal apps, closing the window sends `SIGHUP` and terminates your running builds and background processes. 

JKY Terminal introduces a lightweight, background **Session Supervisor** (`jky-detach`):
- Each shell pane is supervised by an independent background daemon process communicating over secure Unix domain sockets or Windows named pipes.
- Closing the window merely disconnects the UI client. Your long-running builds, servers, and scripts continue uninhibited.
- When you reopen JKY Terminal, it automatically rejoins the supervisor and streams the tail of everything printed while you were away.
- Sockets are strictly locked down to your local user UID with zero ambient network exposure.

---

## 3. Seven Purpose-Built Design Themes

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


---

## 4. Zero-Ambient-Authority Security Model

Security is not a plugin in JKY Terminal—it is the foundational boundary of the entire codebase.

<p align="center">
  <img src="img/architecture-diagram.svg" alt="Architecture &amp; Zero-Trust Security Perimeter" width="900">
</p>

- **`connect-src 'self'`**: The webview frontend has zero ambient networking authority. Even if an untrusted npm package or malicious escape code was injected, it cannot transmit a single byte to an external server.
- **Zero Secret Getters**: No IPC command exists to read secrets back into the frontend. API keys (e.g. Anthropic, OpenAI) are saved in the OS-native Keychain (Apple Keychain, Windows Credential Manager, Linux Secret Service over D-Bus) and handled exclusively inside Rust with memory zeroization (`zeroize`).
- **Bounded Filesystem Access**: The built-in editor and file tools can only read folders explicitly opened by the user, canonicalized and verified on every single syscall to prevent symlink traversal and relative path exploits (`../`).
- **Local-Only Audit Log**: Every privileged operation and shell execution is recorded in a tamper-resistant local audit log for full visibility.

---

## 5. Ten Integrated Workspaces in One Window

Why juggle 6 different applications when your development environment can be unified into a single lightweight desktop app?

```
┌────────────────────────────────────────────────────────────────────────┐
│                              JKY TERMINAL                              │
├────────────┬───────────────────────────────────────────────────────────┤
│ ❯ Terminal │ WebGL-accelerated xterm.js · Geometric splits · SSH       │
│ ✎ Editor   │ CodeMirror 6 · Multi-root · Image viewer · Inline PDFs    │
│ ▦ Workspaces│ Session state snapshots (folders, panes, SSH connections) │
│ ⇄ Remote   │ Native SSH with ~/.ssh/config & system key agent           │
│ ↺ History  │ Subsequence fuzzy search (dkrps → docker ps)              │
│ ✦ Assistant│ Claude / OpenAI streaming · Tool sandboxing · Safe auth   │
│ ⌂ Dashboard│ Local-first markdown notes, Kanban todos, calendar        │
│ ⌥ Developer│ 11 offline tools: JSON, YAML, JWT, Hash, Diff, Regex      │
│ ⊞ Apps     │ GitHub PRs, Gmail (read-only PKCE), Native Browser, Maps  │
│ ◈ Games    │ Built-in terminal games with persistent scorekeeping      │
└────────────┴───────────────────────────────────────────────────────────┘
```

---

## 6. Real-World Developer Workflows

### The Fullstack Engineer
1. Launch JKY Terminal: Workspace automatically restores the client Vite server, backend Rust API, and Docker database container in a 3-way split.
2. Edit configuration files in the integrated CodeMirror editor without spinning up a heavy IDE.
3. Open the **Developer Tools** tab to inspect and format an API response JSON or test a JWT token offline.

### The DevOps / Infrastructure Lead
1. Connect to production clusters via **Remote** using your system SSH key agent without ever copying private keys into the terminal.
2. Monitor host disk space (`df -h`) and Docker workloads with automatic interactive visual panels.
3. If your workstation reboots or your laptop lid closes, the background supervisor maintains your server shells undisturbed.

### The AI-Powered Hacker
1. Activate **Assistant** with <kbd>Ctrl</kbd>+<kbd>K</kbd>.
2. Stream suggestions and shell commands directly against local code context.
3. All destructive commands require a physical click on the tool approval card—preventing accidental deletions.

---

*Authored and engineered by **kartikeyajay2006** under the MIT License.*

