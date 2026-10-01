# Workspaces and editor

A terminal becomes more useful when it remembers the project around the command: the folder, open files, useful terminal tabs, pane layout, and related context. JKY workspaces are intended to provide that continuity without turning a project into a proprietary format.

## Start with a project boundary

Open only folders you mean to work in. The folder boundary is visible to you, useful to the editor, and relevant to the native file-access policy. A good workspace begins with a clear answer to: “What project does this terminal session belong to?”

```text
payments-service
├── terminal: local development server
├── terminal: tests and diagnostics
├── editor: repository root
├── workspace: saved layout and context
└── assistant: optional, consciously scoped project context
```

Separate workspaces are especially valuable for client work, personal projects, production operations, and experiments. They reduce the chance of running a good command in the wrong directory or mixing different projects into one assistant context.

## Restore context deliberately

Workspace restoration saves time, but a restored workspace is not a substitute for verification. On reopening a project:

1. Check the current Git branch and working tree.
2. Confirm each terminal's working directory.
3. Inspect long-running process output before depending on it.
4. Revalidate remote host context if a remote session is involved.
5. Review unsaved files before making additional edits.

This takes seconds and prevents the most expensive category of terminal mistake: acting with the right intent in the wrong environment.

## Editor workflow

The integrated editor is designed for lightweight project work alongside a terminal. It uses CodeMirror and loads editing features on demand rather than trying to replace a full IDE in every scenario.

### Open and inspect

Open a folder, then use the file tree to locate a file. Before editing, read enough surrounding context to understand its role. For generated files, lockfiles, secrets, and vendored code, apply the same caution you would in any editor.

### Save and close safely

JKY should make state changes visible:

- An edited file is marked as changed until it is saved.
- Closing a modified file asks you to save, discard, or cancel.
- A failed save should leave the file open rather than pretending the change landed.
- File creation, renaming, and deletion should be explicit actions.

The practical rule is simple: never interpret a closed tab as proof that your change was saved. Confirm the save result, then use your version-control workflow.

### Preview non-text files

Some formats are better previewed than edited as text. JKY supports selected image and PDF-related workflows within the app's local boundary. Large or unsupported files should be described honestly rather than forcing a broken preview. Use a specialised tool when a format needs it.

## Version-control loop

The editor and terminal are strongest together when you keep the normal Git loop intact:

```sh
git status
git diff
# edit intentionally
git diff --check
git add -p
git commit
```

Use visual file navigation to find a change, and use Git's own output to validate it. Do not rely on an editor indicator alone for staging, branch state, merge conflicts, hooks, or repository policy.

## Good workspace patterns

| Pattern | When it helps | Example |
|---|---|---|
| One workspace per repository | The normal default. | App, service, or library. |
| One workspace per operational environment | Reduces environment mix-ups. | Staging investigation separate from production. |
| Multi-root editing | A task spans a few related folders. | Frontend plus a shared package. |
| Scratch workspace | Short-lived experiments with no restored critical processes. | Reproducing a bug. |

Avoid putting unrelated repositories, secrets, and remote production panes into the same always-restored workspace. Convenience should not turn into accidental authority.

## Recovering from mistakes

If you edit the wrong file, stop before doing more work. Use Git status and diff to understand the real state. If you have not saved, canceling a close action may preserve your options. If you have saved, use normal version-control recovery; do not rely on UI history as a substitute for a commit or backup.

For a file operation failure, keep the error message, path, and operation type. Do not repeatedly retry a destructive operation against an unclear target. Check the project root and operating-system permissions first.

## What the editor deliberately does not promise

JKY's editor is a focused companion to the terminal. It does not claim to be a full replacement for every language server, debugger, remote-development host, notebook environment, or IDE extension ecosystem. The product should integrate cleanly with those tools rather than imitate them badly.

Continue with [Assistant and approvals](assistant-and-approvals.md) if you want AI to read project context. Read [Security and privacy](security-and-privacy.md) for the boundaries that apply to paths, secrets, and local records.
