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

JKY Terminal ships with **7 precision-crafted themes**, each verified against WCAG AAA/AA contrast standards. All colors are strictly tokenized through CSS design variables; zero literal hex values exist anywhere in UI components.

<p align="center">
  <img src="img/themes-palette.svg" alt="Seven Built-in Themes" width="900">
</p>

| Theme | Personality | Key Accents | WCAG Contrast |
|---|---|---|---|
| **Cyberpunk** (Default) | High-energy neon synthwave | `#00e5ff` Cyan · `#ff3cf0` Magenta · `#7c3aed` Violet | AAA (Enhanced) |
| **Dracula** | Beloved vampire palette | `#bd93f9` Purple · `#ff79c6` Pink · `#8be9fd` Cyan | AAA |
| **Nord** | Calm, arctic blue minimalism | `#88c0d0` Frost Ice · `#a3be8c` Aurora Green | AAA |
| **Solarized Dark** | Precision calibrated optical spectrum | `#2aa198` Teal · `#268bd2` Blue · `#859900` Lime | AAA |
| **Light** | Crisp, professional day-mode | `#0f62fe` Sapphire · `#6929c4` Royal Violet | AAA |
| **Gold** | Warm, vintage amber cockpit | `#ffb340` Gold · `#d97706` Amber · `#10b981` Emerald | AAA |
| **High Contrast** | Pure zero-compromise accessibility | `#ffffff` on `#000000` · `#ffff00` · `#00ffff` | AAA (21:1 Max) |

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
