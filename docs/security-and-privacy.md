# Security and privacy

JKY Terminal is built around a simple boundary: the webview can ask for native work, but it should not receive ambient authority to perform it on its own. This design reduces risk; it does not make a terminal harmless. You still run commands, open files, connect accounts, and choose which context to share.

This guide explains the intended security model in operational language. It is not a substitute for an independent security assessment or the security policy your organisation requires.

## Trust boundaries

```text
┌───────────────────────────────────────────────────────────────────┐
│ Webview UI                                                        │
│ React interface · terminal rendering · visible approvals          │
│ Restrictive Content Security Policy · no secret getter API        │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ reviewed IPC request
┌─────────────────────────────▼─────────────────────────────────────┐
│ Native Rust services                                              │
│ PTY · filesystem checks · keychain access · audit records         │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ operating-system permissions
┌─────────────────────────────▼─────────────────────────────────────┐
│ Your machine, shell, files, keychain, SSH agent, and providers    │
└───────────────────────────────────────────────────────────────────┘
```

The frontend security policy restricts webview network connections to the application's approved local IPC channels. That helps limit damage from a compromised renderer or terminal payload. It does not prevent a native command you explicitly approve from accessing the network, and it does not change the authority of tools you already run in a shell.

## Secrets and providers

Provider credentials are intended to be handled by native code and stored through operating-system credential facilities rather than exposed through a frontend “get key” API. This matters because terminal output, browser developer tools, and UI state are poor places for secrets.

Use these rules anyway:

- Create restricted, revocable API keys where possible.
- Never paste secrets into a public issue, commit, screenshot, or shell history.
- Rotate a credential if it appears in terminal output or a conversation.
- Keep provider account usage limits and alerts enabled.
- Remove credentials you no longer use.

Native keychain use reduces one risk; it cannot protect a key from every malware, account, or provider-side compromise. Your operating-system account and its keychain unlock policy remain important.

## Files and folders

File features are designed around folders you explicitly open. Native path handling canonicalises paths before permitting workspace operations, which is intended to defend against path traversal and symlink confusion. The boundary is useful but should be understood correctly:

- It is not a sandbox for arbitrary commands you run in the terminal.
- It does not grant access beyond your operating-system user permissions.
- It does not make an untrusted repository safe to install or execute.
- It does not replace code review, backups, or least-privilege accounts.

Open the smallest folder that contains the work you need. Do not open your whole home directory merely for convenience.

## Terminal output is untrusted input

Terminal output can contain escape sequences, links, copied commands, or text crafted to manipulate a user. Treat output from a remote machine, build log, package script, or AI response as untrusted until you understand it.

Avoid blindly copying commands from logs. Be especially suspicious of instructions that request a token, alter shell startup files, use `curl | sh`, ask for `sudo`, disable host-key checks, or claim that a safety control must be bypassed.

## Audit records

Privileged operations are designed to have a local audit trail. Audit records help answer “what happened?” but do not replace prevention or rollback. Keep ordinary operational records too: commits, backups, change tickets, deployment logs, and provider audit logs.

If something unexpected occurs, preserve the relevant audit and terminal evidence, revoke exposed credentials, and stop further destructive actions before attempting a repair.

## Remote and production work

Remote access combines several trust decisions: the local user account, SSH configuration, host identity, network path, remote account, and command. Use separate profiles or workspaces for production, visible prompt markers, minimal privileges, and a peer-review/change-control process for high-impact work.

An AI tool approval or a colourful UI does not lower the risk of a production command. It only makes the proposed action more inspectable.

## Known limits and planned hardening

The project has security-oriented tests and CI checks, but it should not claim a completed formal audit, universal platform signing, a public vulnerability disclosure programme, or a fully mature plugin sandbox until those deliverables exist and are independently verifiable. Planned work includes signed distribution, update verification, SBOMs, fuzzing of boundary parsers, and a published coordinated-disclosure path.

## Report a concern safely

Do not put a suspected vulnerability, private key, token, customer data, or exploit instructions in a public issue. Use the repository's published security contact when one exists; until then, contact the maintainer privately through a verified channel and include a minimal reproduction without secrets.

For normal bugs, include operating system, JKY version or commit, steps to reproduce, expected result, observed result, and redacted logs. This lets maintainers distinguish a security boundary problem from a shell, webview, or configuration issue.
