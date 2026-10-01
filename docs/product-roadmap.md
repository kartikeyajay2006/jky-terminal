# Product roadmap

This roadmap is a prioritised product direction, not a claim that every idea is already available. JKY becomes a great terminal by making the core loop faster and safer first—not by adding every possible panel.

## Product principles

1. **The shell remains primary.** Every extra interface must preserve direct command visibility and keyboard control.
2. **Local-first is the default.** Remote providers and integrations are explicit choices, not invisible background dependencies.
3. **Approval is a product feature.** AI and native actions must be inspectable before they carry out meaningful side effects.
4. **Cross-platform means tested, not claimed.** Linux, macOS, and Windows require real build, package, and interaction validation.
5. **Trust compounds.** Honest limits, predictable updates, and clear recovery paths matter more than feature count.

## Now: strengthen what exists

The current codebase already covers a substantial product surface: local PTYs, terminal panes, session supervision, workspaces, an editor, history, assistant capabilities, remote-oriented workflows, developer tools, and a themed desktop shell.

The near-term priority is to make those capabilities dependable under real use:

- publish repeatable benchmarks for first prompt, high-output commands, split operations, memory, and reconnects;
- add native end-to-end tests for interactive shells, terminal resizing, paste, Unicode, remote sessions, file safety, and approval flow;
- remove test-suite warning noise so a green result is a trustworthy result;
- improve recoverability for workspace, session, and failure states;
- document platform support and known terminal-protocol limits clearly.

## Next: release trust

Public packages need more than a successful build. The release direction is:

| Capability | Why it matters | Status |
|---|---|---|
| Signed Windows packages | Reduces installation warnings and supports trust signals. | Planned |
| macOS signing and notarisation | Lets users install a verified desktop application. | Planned |
| Signed updater | Provides safe, verifiable upgrades and rollback policy. | Planned |
| SBOM and provenance | Helps organisations assess supply-chain risk. | Planned |
| Public support matrix | Sets clear expectations by OS, shell, and architecture. | Planned |
| Security reporting policy | Gives researchers a safe private disclosure path. | Planned |

## Later: intentional extension

The repository is modular, which creates a good base for extension. A public plugin system must be designed as a security product, not merely an API:

- sandbox untrusted logic with minimal capabilities;
- make permissions visible and revocable;
- version the plugin API and define upgrade behaviour;
- provide a test harness and supply-chain policy;
- avoid letting extensions bypass native approval boundaries.

A sandboxed plugin SDK and marketplace are **planned**. They are not a current public capability.

## Explicit scope boundaries

These are worthwhile ideas, but they should not be described as shipped:

- **Database cockpit:** first-class PostgreSQL, SQLite, Redis, and other database explorers are planned future work.
- **Automatic updates:** updater signing, hosted metadata, rollback policy, and release channels need completion before this can be promised.
- **Broad account integrations:** OAuth integrations must be evaluated provider by provider, with minimum scopes and clear local storage rules.
- **Universal offline AI:** local model support needs a supported runtime, model lifecycle, hardware guidance, and privacy documentation.
- **Plugins:** a public SDK needs sandboxing, permissions, compatibility, and governance.
- **Mobile or team-hosted services:** these are outside the core local desktop terminal focus until the core is proven.

## What “best terminal” means here

JKY should not try to win by copying every editor, browser, dashboard, or chat product. It should become the terminal people trust during serious work:

1. Starts quickly and renders consistently.
2. Behaves correctly with real shells and interactive programs.
3. Makes sessions, history, and output easier to recover.
4. Protects secrets and avoids hidden authority.
5. Gives AI useful context without silently widening access.
6. Ships signed, reproducible, well-tested releases.
7. Opens a safe extension path after the foundation is solid.

That sequence is the roadmap. Features that do not improve one of those outcomes should have a high bar before they compete with core reliability work.
