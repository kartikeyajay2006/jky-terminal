# Glossary

The words these docs use, defined once. Terms are grouped, then alphabetical.

## In JKY

| Term | Meaning |
|---|---|
| **Approval card** | What appears when the assistant wants to run a command: the exact command, a risk label, the model's reason, and **Run** / **Don't run**. See [Assistant](assistant-and-approvals.md#how-approval-works). |
| **Audit log** | `audit.jsonl` — an append-only, local record of key reads, provider requests, tool calls, approvals, sign-ins and captures. Each record is chained to the one before with a keychain-held key, so `jky audit` can tell whether it was altered. The window can cause entries but cannot read it. |
| **Command block** | One finished command — prompt, command, output, exit status, duration — as reported by the shell. It has a bar in the gutter. |
| **Command panel** | The structured view a recogniser draws beneath a command's raw output. |
| **Failure help** | The offer under a failed command. Nothing is sent until you press a button. |
| **Focus mode** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>: the terminal takes the whole window. |
| **Live panel** | A panel for `df -h`, `ps aux` or `docker ps` that re-runs and refreshes while you watch. |
| **Pane** | One terminal inside a tab. A tab can be split into several. |
| **Platform adapter** | `apps/desktop/src/platform/` — the single door from the interface to native code. |
| **Private terminal** | A tab that keeps no history and saves no scrollback, marked with a **private** badge. |
| **Project folder** | The folder the assistant's tools are confined to, and where new terminals start. Set in Settings → Privacy, or by switching to a workspace with a terminal folder. |
| **Rail** | The column of section glyphs down the left of the window. |
| **Recogniser** | A deterministic parser that turns one command's output into a panel, or declines. |
| **Risk label** | *destructive*, *publish*, *network*, *writes files* or *runs locally* — the clearest reason a proposed command needs attention. |
| **Session strip** | Marks down the left edge of a terminal, one per command, sized by duration on a log scale. |
| **Supervisor** | The small process — `jky-terminal --supervise` — that holds a pane's shell so it outlives the window. |
| **Work Memory** | Every run of every command, kept in `memory.sqlite3` with its folder, git branch and commit, exit status, duration, output tail, pin and note — redacted, and searchable by any word in any of them. The **Runs & output** view of History. |
| **Workspace** | A named setup: editor folders, a terminal folder, a number of terminals, and optionally a host. |
| **Worktree** | A second Git checkout of a repository on another branch; manageable from Workspaces. |

## Terminal and security terms

| Term | Meaning |
|---|---|
| **Canonicalise** | Resolve a path fully — every `..` and symlink — so you know where it really points. |
| **CSP** | Content Security Policy — the browser rule set that limits what the webview may load and connect to. |
| **IPC** | Inter-process communication — here, the named commands the window may ask Rust to run. |
| **OSC** | Operating System Command — an escape sequence a program prints to tell the terminal something. JKY reads OSC 133, OSC 7 and its own OSC 1337 messages, and blocks OSC 52. |
| **OSC 133** | The shell-integration convention for marking prompts, output and exit status. |
| **OSC 7** | The convention for reporting the working directory. |
| **OSC 52** | A convention that lets output write to your clipboard. Blocked in JKY. |
| **PKCE** | Proof Key for Code Exchange — an OAuth flow that keeps an intercepted code useless. Used for Gmail. |
| **PTY** | Pseudo-terminal — the device a shell talks to as if it were a real terminal. |
| **Secret Service** | The Linux D-Bus API (GNOME Keyring, KWallet) where JKY stores keys. |
| **Synchronized output** | DEC mode 2026: a program brackets a repaint so the terminal shows only finished frames. |
| **Tauri** | The Rust framework JKY is built on, which draws the interface in the system webview. |
| **Webview** | The operating system's browser engine — WebKitGTK, WKWebView or WebView2 — embedded in an app. |
| **xterm.js** | The terminal emulator library that renders JKY's terminals. |

---

<p align="center">
  <a href="faq.md">← Questions & answers</a> &nbsp;·&nbsp;
  <a href="README.md">Documentation home</a>
</p>
