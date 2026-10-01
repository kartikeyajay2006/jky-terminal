# Getting started with JKY Terminal

This guide gets a local development build running, explains what the first window contains, and gives you a safe first-session checklist. It assumes you are using the source repository. Release packages follow the same product flow but have separate platform installation requirements; see [Operations and releases](operations-and-releases.md).

## Before you begin

JKY Terminal is a Tauri desktop application. A development build needs the following:

| Requirement | Why it is needed | Check |
|---|---|---|
| Node.js 22 or newer | Runs the frontend toolchain. | `node --version` |
| Corepack and pnpm | The repository pins pnpm through `package.json`. | `corepack --version` |
| Rust stable | Builds the native application and local services. | `rustc --version` |
| Platform webview dependencies | Tauri uses the operating-system webview. Linux commonly needs WebKitGTK development packages. | See the Tauri prerequisites for your OS. |
| A supported shell | JKY launches your normal local shell session. | `echo "$SHELL"` on Unix. |

On Linux, use the package names documented in the repository's CI workflow as a known-good baseline for a Tauri/WebKitGTK build. Those packages are platform dependencies, not application dependencies; do not add them to the repository merely to run the app locally.

## Install and launch

```sh
git clone https://github.com/kartikeyajay2006/jky-terminal.git
cd jky-terminal
corepack enable
pnpm install
pnpm dev:desktop
```

`pnpm dev:desktop` starts Vite and launches the native Tauri desktop window. The first native build can take longer because Rust dependencies must be downloaded and compiled. Later launches are normally much faster because Cargo reuses the build cache.

If you only need to inspect frontend layout in a browser, use:

```sh
pnpm dev
```

This browser mode is useful for UI work but is not a substitute for testing the product. It does not exercise the native PTY, OS keychain, native dialogs, local supervisor, or Tauri permission boundary.

## First-session checklist

When the desktop window opens, use this sequence before connecting any providers or opening sensitive work:

1. Create or select a terminal tab and confirm that the prompt belongs to the expected local shell.
2. Run a harmless command such as `pwd`, `git status`, or `echo JKY ready`.
3. Open Settings and pick a theme and terminal font that are comfortable for long sessions.
4. Open a non-sensitive project folder in the editor before granting it trust through normal file operations.
5. If you plan to use the assistant, read [Assistant and approvals](assistant-and-approvals.md) before entering an API key or enabling project context.

Do not begin by pasting a production token, a private key, or a destructive shell command. A terminal is powerful because it gives you direct control; a good first session validates that the working directory, shell, and project boundaries are exactly the ones you intended.

## Understand the window

JKY groups work into sections rather than forcing every task into one pane.

| Section | What it is for |
|---|---|
| Terminal | Local shell sessions, splits, scrolling, search, and command-oriented views. |
| Editor | Files from folders you explicitly open, with save and close safeguards. |
| Workspaces | Restorable working context for projects and terminal layouts. |
| Remote | SSH-oriented connection workflows based on local configuration. |
| History | Searchable local command history. |
| Assistant | A provider-backed conversation with visible action approvals. |
| Dashboard and Developer | Local organisational and developer utilities. |
| Apps and Games | Optional panels separate from the core terminal workflow. |

The application is intentionally broad, but the terminal workflow should remain the anchor. You can ignore any section that is not useful to your work.

## Keyboard-first basics

The product documents common shortcuts in the root [README](../README.md#️-keyboard-shortcuts). A few habits are worth learning early:

- Use the command palette for navigation and command discovery instead of hunting through the rail.
- Create new terminal tabs for separate working directories or tasks.
- Split a terminal when two live commands need equal attention.
- Use terminal search for scrollback rather than rerunning a command just to rediscover output.
- Keep standard shell controls such as Ctrl+C and Ctrl+D as shell controls.

Key bindings may be configurable in Settings. Treat the on-screen binding list as authoritative if it differs from a guide or your platform remaps Ctrl to Command.

## Project folders and file safety

The editor works from folders you choose. This is an important security and usability boundary:

1. Choose the project folder deliberately.
2. Review the tree before opening or modifying files.
3. Save changes explicitly.
4. When closing a changed file, choose save, discard, or cancel; do not assume changes vanish safely.

File access is designed to be constrained to opened workspace folders after canonical path resolution. That reduces accidental traversal outside a project but does not replace normal operating-system permissions, backups, code review, or judgment about what a command may do.

## Use a workspace, not a pile of tabs

A productive setup generally starts with one workspace per project or responsibility. For example:

```text
API workspace
├── terminal 1: application server
├── terminal 2: test watcher
├── terminal 3: logs or database client
├── editor: project folder
└── assistant: optional, scoped to the same project
```

This gives you a coherent unit to reopen later. It is also easier to audit: the visible folder, terminal directory, remote host, and assistant context can all be checked against the same task.

Read [Workspaces and editor](workspaces-and-editor.md) for the everyday operating model.

## Troubleshooting a development launch

### The browser server starts but no native window appears

Run `pnpm dev:desktop`, not only `pnpm dev`. The latter deliberately starts only Vite. If the native command then fails, read the last Rust or Tauri error; it commonly identifies a missing platform dependency, compiler toolchain, or webview library.

### A first build takes several minutes

This is expected on a cold machine. Cargo must compile the Tauri stack and native crates. Keep the process running until it reaches the application launch line. Do not delete `target/` merely to make a first build look cleaner; it will force the work again.

### The wrong shell starts

Check your operating system's default shell and the terminal settings. On Unix, inspect `$SHELL`; on Windows, confirm the configured shell choice. Open a fresh tab after changing shell settings.

### I cannot see a native capability in browser mode

Browser mode intentionally uses a web platform adapter. Launch the desktop app to test PTY sessions, secret storage, native file selection, remote operations, and other Tauri-backed features.

## Where to go next

- Learn daily command and pane workflows in the [Terminal guide](terminal-guide.md).
- Learn how persisted project state and safe editor actions work in [Workspaces and editor](workspaces-and-editor.md).
- Read [Security and privacy](security-and-privacy.md) before treating a development build as a trusted daily driver.

---

The instructions above are for source users. If you are evaluating a package build, treat platform signing status and release notes as part of installation—not as an afterthought.
