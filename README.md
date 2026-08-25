# JKY Terminal

**AI Terminal. Infinite Possibilities.**

JKY Terminal is an AI-native command center — a terminal, an AI assistant, a live dashboard, and a secure integrations hub (GitHub, Docker, Kubernetes, AWS, Google, Slack, Notion) fused into one fast, beautiful, cross-platform desktop app.

Built to be free and open for everyone, with mobile-grade security on every account connection (OAuth device-flow + biometric/passkey confirmation before any token is ever stored).

## Status

🟡 **Planning complete, build starting.** See [`ROADMAP.md`](./ROADMAP.md) for the full, detailed, phase-by-phase build plan (16 phases, tech stack decisions, architecture, and the security/auth design).

## Highlights (target v1.0)

- ⚡ GPU-accelerated terminal (xterm.js + WebGL) on a native Rust/Tauri shell — small, fast, secure
- 🤖 AI Assistant with real tool-use (reads your repo, checks CI/issues, explains errors, suggests and previews commands before running them)
- 🗂️ Multi-tab workspace: Terminal, Editor, AI Assistant, Browser, Database — all in one window
- 📊 Live dashboard: system monitor, calendar, notes, reminders
- 🔐 Integrations hub with mobile-authentication-grade validation (device-code + push/biometric approval, encrypted local vault — never plaintext tokens)
- 🎨 Theme engine (Cyberpunk, Dracula, Nord, Solarized, Light, High-Contrast) + a plugin/theme marketplace
- 🌍 Free core forever (MIT-licensed); optional Pro plan funds hosted AI credits and cloud sync

## Getting Started

This repository currently holds the product roadmap and planning docs. Implementation follows the phases in [`ROADMAP.md`](./ROADMAP.md), starting with Phase 0 (spec/brand) and Phase 1 (monorepo + Tauri scaffold).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Issues are organized by phase/milestone on the repo's Project board — look for `good first issue` once Phase 15 seeds the starter backlog.

## License

[MIT](./LICENSE)

---

Maintained by [@kartikeyajay2006](https://github.com/kartikeyajay2006).
