# JKY Terminal Documentation

<p align="center">
  <img src="img/terminal-studio-hero.png" alt="A colourful professional terminal workstation with command panes, code, and live data visualisations" width="100%">
</p>

Welcome to the product documentation for JKY Terminal. This guide is written for people who use terminals all day and want a local-first workspace that can keep sessions alive, make command output easier to understand, and use AI without handing it silent authority.

JKY is a desktop application built with Tauri, Rust, React, and xterm.js. It is not a hosted shell, a remote desktop, or an IDE that happens to contain a terminal. The product centre is still the shell: commands, output, keyboard control, working directories, and the user's own tools. Everything else is designed to make that loop safer and easier to continue.

> **Documentation promise:** this site distinguishes what JKY currently ships from planned work. A feature marked **planned** is not available in the current release.

## Start here

| Guide | Use it when you want to |
|---|---|
| [Getting started](getting-started.md) | Install from source, launch the desktop app, and understand the first workspace. |
| [Terminal guide](terminal-guide.md) | Work with tabs, splits, search, shell sessions, output cards, and persistent shells. |
| [Workspaces and editor](workspaces-and-editor.md) | Organise projects, edit files safely, and restore useful working context. |
| [Assistant and approvals](assistant-and-approvals.md) | Connect a provider, understand shared context, and approve or reject tool actions. |
| [Security and privacy](security-and-privacy.md) | Understand the native boundary, local storage, key handling, audit trail, and limits. |
| [Operations and releases](operations-and-releases.md) | Run checks, package a build, understand support status, and report an issue well. |
| [Product roadmap](product-roadmap.md) | See the focused direction and the items deliberately not promised yet. |

## What JKY is today

The current application brings together a real local PTY, geometric terminal splits, shell persistence through a local supervisor, a file editor, searchable command history, remote-session support, offline developer utilities, workspaces, an approval-first assistant, and several optional application panels. The project also includes a cross-platform CI pipeline and a release workflow that makes draft packages for Linux, macOS, and Windows.

The details matter. For example, rich command panels are supplemental views: terminal output remains in the scrollback, and an action is designed to type a command for the user to review rather than execute it in the background. The assistant can propose or request actions, but native code mediates the authority boundary.

## A quick map

```text
┌───────────────────────────────────────────────────────────────────────┐
│ JKY Terminal                                                           │
│                                                                       │
│  Terminal  → real local shell, panes, history, output interpretation │
│  Workspace → folders, saved layouts, editor, project context          │
│  Assistant → provider-backed help with visible approval boundaries     │
│  Remote    → SSH-oriented sessions using your existing local setup    │
│  Tools     → local utilities for data, text, and developer workflows  │
└───────────────────────────────────────────────────────────────────────┘
```

The most reliable way to learn the product is to open one small project, run a familiar command, then add only the extra panels you actually need. JKY should make a developer's existing habits more legible—not ask them to abandon those habits for a new workflow.

## Capability status

| Area | Current direction | Read next |
|---|---|---|
| Terminal engine | Native PTYs, xterm rendering, panes, history, command views, and session supervision are the core. | [Terminal guide](terminal-guide.md) |
| Files and editing | Explicitly opened folders, an integrated CodeMirror editor, previews for selected file types, and safe save/close behaviour. | [Workspaces and editor](workspaces-and-editor.md) |
| AI assistance | Provider configuration, streaming conversation UI, local project context controls, tool approvals, and an audit-oriented model. | [Assistant and approvals](assistant-and-approvals.md) |
| Privacy | A restrictive webview boundary, native secret storage, canonical path checks, and local-only audit records. | [Security and privacy](security-and-privacy.md) |
| Distribution | Source builds and tag-driven draft packages. Code signing and auto-update distribution are not complete. | [Operations and releases](operations-and-releases.md) |
| Extensibility | The codebase is intentionally modular; a public sandboxed plugin SDK is **planned**, not shipped. | [Product roadmap](product-roadmap.md) |

## Documentation conventions

- **Current** means the capability exists in the checked-in application and is part of the intended product surface.
- **Planned** means it is a direction, not a release promise.
- **Local** means the relevant data remains on the machine unless you deliberately configure a provider or remote service.
- **Approval required** means the interface should show you the action before native code carries it out.

When documentation and behaviour disagree, treat behaviour and the repository's automated tests as the source of truth, then open an issue so the documentation can be corrected. Please do not use product copy as a security guarantee by itself; the security guide explains the boundary and its limits in practical terms.

## Need a fast answer?

- **I only want to run it:** see [Getting started](getting-started.md).
- **My shell or long-running job matters:** see [Terminal guide](terminal-guide.md#persistent-sessions).
- **I am connecting an AI provider:** read [Assistant and approvals](assistant-and-approvals.md) and then [Security and privacy](security-and-privacy.md).
- **I am preparing a release:** read [Operations and releases](operations-and-releases.md) before creating a tag.
- **I want to contribute:** start with the repository [contribution guide](../CONTRIBUTING.md).

## Visual tour

The [Showcase and tour](SHOWCASE.md) is the visual companion to these operational guides. It includes colour-led diagrams for command-to-app views, the seven built-in themes, the security boundary, and the major workspace areas.

<p align="center">
  <a href="SHOWCASE.md"><img src="img/sections.svg" alt="Colourful map of JKY Terminal product sections" width="860"></a>
</p>

---

Maintained for JKY Terminal contributors and users. Last reviewed against the `main` branch product structure in October 2026.
