# Assistant and approvals

JKY's assistant is designed as an informed collaborator, not an invisible operator. It can help explain a failure, inspect selected project context, suggest commands, and request tool actions. The important word is **request**: a useful assistant must make its context and proposed actions visible enough for you to judge them.

## Before connecting a provider

An AI provider can receive the prompt and any context you choose to send. Read the provider's terms, data policy, model availability, and billing details before entering credentials. JKY is local-first by default, but provider-backed assistance is not offline when you ask it to call a remote model.

Use a dedicated API key where the provider supports it. Keep a spending limit or usage alert at the provider. Do not paste a key into a terminal command, source file, issue, screenshot, or chat transcript.

## Context is an explicit choice

Helpful context can include the current working directory, Git state, selected files, recent terminal output, or a conversation's earlier messages. Each category can be sensitive. Treat context selection like attaching files to an external message.

Before you send a request, ask:

1. Does this project contain credentials, customer data, or proprietary code?
2. Is the relevant error already visible in a small, sanitised excerpt?
3. Does the model need the entire file, or only the current function and error?
4. Is the active terminal connected to a production system?

Choose the smallest sufficient context. Small context is cheaper, faster, easier to inspect, and less likely to include material you did not intend to disclose.

## Approval-first actions

The assistant can propose a command or request a tool action. You should see what it intends to do before native code acts. In practice, use the following review sequence:

| Step | What to inspect |
|---|---|
| Intent | Is this action necessary to answer the task? |
| Target | Which repository, file, process, host, or account is affected? |
| Command | Does it include deletes, force flags, redirection, network calls, or broad globs? |
| Consequence | Is it reversible? Is there a backup or diff? |
| Approval | Approve only this action, not a vague future category, unless you consciously choose otherwise. |

For shell actions, the safest interaction is often to place the proposed command in the prompt, read it, edit it if needed, and press Enter yourself. That preserves normal terminal agency and creates an obvious point to stop.

## High-risk requests

Treat these as heightened-review operations even if an assistant says they are routine:

- deleting files, branches, containers, volumes, or cloud resources;
- modifying Git history or force pushing;
- changing production systems, permissions, secrets, or firewall rules;
- sending messages, creating tickets, or calling external APIs;
- reading `.env` files, credential stores, SSH configuration, or customer data;
- running package-manager scripts from an untrusted repository.

An approval dialog is a decision aid, not a guarantee that an operation is safe. The assistant may misunderstand a repository or command. You remain the authority for every side effect.

## Useful requests that stay bounded

Good assistant prompts state a goal, scope, and desired output. For example:

```text
Explain this TypeScript error using only the pasted stack trace.
Do not run commands or read files.
```

```text
Inspect the current repository's Git status and propose a safe test command.
Show the command, but do not execute it.
```

```text
Summarise changes in these two selected files. Do not include secrets,
do not modify files, and give me a checklist for manual review.
```

Bounded requests are easier to verify and usually lead to better answers than “fix everything.”

## Conversation records and auditability

Conversation history can be useful when returning to a task. It can also contain private code, prompts, and decisions. Treat saved conversations as project data: manage them with the same care you apply to notes, terminal history, and local logs.

The native-side audit model is intended to record privileged actions locally. Review an audit trail when debugging unexpected effects, but do not confuse a record with a rollback mechanism. Backups, Git commits, database migrations, and operational change management remain essential.

## Failure modes to expect

Models can be wrong, incomplete, stale, or overconfident. They can suggest commands that are syntactically valid but inappropriate for your environment. A failed tool call may expose an error but should not silently retry a dangerous operation without your review.

When an answer matters:

- check primary documentation and command help;
- inspect the actual diff or command output;
- test in a safe environment first;
- ask for an explanation of assumptions and alternatives;
- use version control before broad changes.

## Provider and offline status

JKY includes provider-oriented capabilities, but a local/offline model stack and a public plugin-style provider ecosystem are future product work rather than universal guarantees today. See [Product roadmap](product-roadmap.md) for explicit scope. See [Security and privacy](security-and-privacy.md) for how native secret handling is intended to work.
