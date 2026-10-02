# Security policy

JKY Terminal runs your shells, holds your API keys in the OS keychain, and can run commands an AI
proposes once you approve them. A vulnerability here can matter, so please report one privately and
give the project a chance to fix it before it is public.

## Supported versions

JKY is pre-1.0 and has not published a release yet. Security fixes land on **`main`**; there are no
maintained release branches.

| Version | Supported |
|---|---|
| `main` | ✅ |
| Anything older | ❌ — update to `main` |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request that describes the problem.**

1. **Preferred:** use GitHub's private vulnerability reporting —
   **Security → Report a vulnerability** on
   [the repository](https://github.com/kartikeyajay2006/jky-terminal/security). If that button is not
   available yet, use option 2.
2. Open a **public issue titled only "Security contact request"**, with no details at all. The
   maintainer, [@kartikeyajay2006](https://github.com/kartikeyajay2006), will reply with a private
   channel.

Include, privately:

- what an attacker can do, and what they need first (local access? a malicious repository? a crafted
  terminal output? a compromised provider?);
- the JKY commit (`git rev-parse --short HEAD`), your OS and shell;
- a minimal reproduction — **with no real API keys, tokens, hostnames or private code**;
- whether you have told anyone else.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement | Within 7 days |
| An assessment and a plan | Within 14 days |
| A fix on `main` for a confirmed high-severity issue | As fast as it can be done properly; you will be kept informed |
| Public disclosure | Coordinated with you, after the fix — and credited to you unless you prefer otherwise |

This is a one-maintainer project, so these are honest targets rather than a contractual SLA.

## Scope

**In scope** — anything that breaks a boundary JKY claims to enforce. The claims are listed, with the
tests that enforce them, in [Security & privacy](docs/security-and-privacy.md):

- the window reaching the network, a secret, or a native capability it should not have
  (`connect-src 'self'`, the pinned IPC command list, the capability files);
- reading or writing outside a folder you opened — through the editor or the assistant's tools —
  including by racing the folder's contents;
- the assistant running a command without your approval, or a destructive one without typed
  confirmation;
- a recogniser, panel action, completion or history entry *running* a command instead of typing it;
- an `ssh` argument injection through a saved host;
- forging, altering or silently truncating the audit log in a way `jky audit` does not detect;
- a credential reaching a log, an error message, the bundle, or the window.

**Out of scope:**

- commands you type, or approve, doing what they say — a terminal runs what you tell it;
- attacks that require already running arbitrary code as your user (they can read your keychain on
  some platforms; [the docs say which](docs/security-and-privacy.md#tamper-evident-and-checkable));
- the security of the AI providers, Ollama, `ssh`, Git, or your OS webview themselves;
- unsigned builds producing OS warnings — signing is [on the roadmap](docs/product-roadmap.md).

## Hardening already in place

The boundary is enforced by tests, not by prose: the IPC surface is pinned by name, the CSP and the
window's capabilities are pinned, files are opened beneath a directory handle so a path cannot be
swapped between a check and its use, every AI command needs approval, the audit log is hash-chained
with a keychain-held key, and CI scans the bundle and the repository for committed credentials. See
[Security & privacy](docs/security-and-privacy.md) for the full list and the known limits.
