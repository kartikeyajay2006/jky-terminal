# Terminal guide

The terminal is JKY's primary product surface. The goal is simple: preserve the directness of a local shell while making multi-command work easier to navigate, resume, and understand. This guide covers the intended operating model, not a replacement for shell documentation.

## The terminal contract

JKY aims to preserve several non-negotiable terminal expectations:

1. Your shell receives the input you type.
2. Standard terminal output stays in scrollback.
3. Shell controls such as interrupts remain shell controls.
4. A visual interpretation of command output is an addition, not a replacement.
5. A clickable action should prepare a command for review, not silently run it.

This contract makes the product useful even when an output recogniser does not understand a command. The fallback is always an ordinary terminal.

## Tabs, panes, and focus

Use a tab for an independently useful session: a project server, a production investigation, a scratch shell, or a remote host. Use a split when commands belong to the same task and you need to watch them together.

```text
┌─────────────────────────────────────────────────────────┐
│ project-api                                               │
├───────────────────────────┬─────────────────────────────┤
│ pnpm dev                  │ pnpm test --watch           │
│ server listening :3000    │ 82 passing                  │
├───────────────────────────┴─────────────────────────────┤
│ git status · logs · one-off diagnostics                  │
└─────────────────────────────────────────────────────────┘
```

Keep splits purposeful. A three-pane layout is often excellent for server, tests, and diagnostics; fifteen permanently open panes are usually a sign that tasks should be separated into workspaces. Name or organise tabs in a way that tells you what may still be running before you close a window.

### Safe focus habits

- Confirm the active pane before pasting a command.
- Use a distinctive prompt for production or remote sessions.
- Keep destructive and exploratory work in different tabs.
- Resize after a pane layout change, then visually confirm interactive programs have redrawn correctly.
- Close a pane only after checking whether it owns a running foreground job.

## Persistent sessions

JKY includes a local session supervisor so a window can disconnect from a terminal session without automatically ending the shell. This is designed for long-running local work such as development servers, compilers, test watchers, and logs.

The model is not magic process immortality. A process can still stop because of an operating-system restart, an explicit kill, resource pressure, the shell's own job-control rules, or the process exiting normally. Treat persistence as continuity across the application window lifecycle, not a replacement for deployment supervision, system services, tmux knowledge, or backups.

### Practical pattern

1. Start a service in a dedicated pane.
2. Confirm it is healthy with its own logs or health endpoint.
3. Leave that pane associated with the project workspace.
4. Reopen JKY and verify the recovered output before assuming the service remained healthy.

If a critical job must survive logout, reboot, or machine failure, run it through the appropriate system service, container orchestrator, CI worker, or remote host—not only through a desktop terminal.

## Scrollback, search, and history

Scrollback helps you recover the context of a session; history helps you find a command later. They are related but different:

| Tool | Best for | Example |
|---|---|---|
| Scrollback search | Text emitted during this session. | Find an error code from a build. |
| Command history | Commands run across sessions. | Recover a `docker` command from last week. |
| Shell history | Shell-native recall and expansion. | Repeat a recent command with `!!` or arrow keys. |

Use the narrowest tool that answers the question. Do not paste secrets into a terminal merely because history makes recovery convenient. If a command included a secret, rotate it where appropriate and use the product's forgetting controls or shell-history management.

## Command-to-app views

Some familiar commands can be recognised and shown as a structured panel beneath their original text output. Examples documented by the product include Git status and log output, Docker process listings, disk usage, process listings, directory listings, and JSON.

These panels are valuable when they make a dense answer faster to inspect. They should never conceal the underlying command or output.

### How to use them responsibly

- Read the raw output first when correctness matters.
- Treat the panel as a convenience view, not an authority on the system.
- If the command includes a pipe or changes its output shape, expect recognition to decline rather than guess.
- Review a command placed into the prompt by an action before pressing Enter.
- Prefer original command-line tools for unfamiliar formats or high-stakes operational decisions.

This approach preserves the composability that makes terminals powerful. Structured output improves scanning; text remains the source of record.

## Interactive programs

Full-screen and interactive programs are the real test of a terminal. Use the desktop app, not browser-only development mode, for editors, REPLs, SSH, and programs that depend on a real PTY.

When testing a workflow, cover:

- interactive input and cursor movement;
- terminal resize and redraw;
- copy/paste behaviour;
- Unicode, emoji, and wide characters used by your locale;
- interruption and exit signals;
- reconnecting after closing and reopening the desktop window.

Report terminal bugs with the command, shell, operating system, terminal size, exact observed output, and whether the issue reproduces in another terminal. Never include credentials, private hostnames, or private project contents in a public report.

## Remote sessions

The Remote area is designed around SSH-style workflows and local configuration. Use existing system agents and configuration where possible instead of copying keys into a graphical form. That keeps the operating system and your normal SSH tools in control of private-key handling.

Before connecting to a host:

1. Verify the host name, account, and environment.
2. Confirm host-key verification is enabled through your normal SSH setup.
3. Use a restrictive prompt marker or tab title for production.
4. Avoid combining a production SSH session with an assistant action you have not reviewed.

Remote access is powerful enough that it deserves a separate trust decision from merely opening a local project folder.

## Performance expectations

For a terminal to feel excellent, latency matters more than decorative features. The roadmap for JKY therefore prioritises measurements for first prompt, sustained output, frame stability, memory use, split operations, and reconnect time. Until those benchmarks are published and enforced, do not infer a universal performance guarantee from a demo or a single machine.

If you notice stutter, first identify whether it is caused by the command itself, the shell, the remote network, the webview renderer, or the local machine. A useful issue contains a reproducible high-output command and a description of the effect rather than simply “terminal slow.”

## Daily checklist

- Start each meaningful task in the correct directory.
- Use a separate pane for watching logs rather than burying them in the command pane.
- Search scrollback before rerunning expensive commands.
- Read any generated command before execution.
- Verify remote host identity and environment before changing state.
- Use persistence for convenience, but proper services for critical availability.

For the wider project setup, continue with [Workspaces and editor](workspaces-and-editor.md). For assistant-enabled terminal work, read [Assistant and approvals](assistant-and-approvals.md) before granting context or approving actions.
