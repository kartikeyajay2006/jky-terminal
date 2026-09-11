<h1 align="center">JKY Terminal</h1>

<p align="center"><b>AI Terminal. Infinite Possibilities.</b></p>

<p align="center">
  A terminal, an editor, an assistant and your workspaces — one fast desktop
  app, on Linux, macOS and Windows.<br>
  Local-first, open source, and built so the window can ask but only Rust can act.
</p>

<p align="center">
  <a href="https://github.com/kartikeyajay2006/jky-terminal/actions/workflows/ci.yml"><img src="https://github.com/kartikeyajay2006/jky-terminal/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-00e5ff" alt="Linux, macOS, Windows">
  <img src="https://img.shields.io/badge/tests-2034%20frontend%20%C2%B7%20954%20Rust-3ddc97" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-7c3aed" alt="MIT">
</p>

<p align="center">
  <img src="docs/img/sections.svg" alt="Ten sections: Dashboard, Terminal, History, Remote, Editor, Workspaces, Assistant, Games, Apps, Developer" width="860">
</p>

---

## What it is

A terminal you do not have to leave. A real pty with splits and SSH, an editor
for the folders you are working in, an assistant that runs on your own API key,
and workspaces that put all of it back where you left it.

```sh
corepack enable && pnpm install
pnpm dev:desktop
```

---

## What is in it

| | | |
|---|---|---|
| ❯ | **Terminal** | A real pty. Split it any way. **Any command can become an app.** |
| ✎ | **Editor** | CodeMirror 6, several folders at once. Images and PDFs open too |
| ▦ | **Workspaces** | Folders, terminals and a machine, saved under a name |
| ⇄ | **Remote** | A terminal on another machine, over the `ssh` you already have |
| ↺ | **History** | Every command you have run — `dkrps` finds `docker ps` |
| ✦ | **Assistant** | Your key, in the OS keychain. Destructive tools need a click |
| ⌂ | **Dashboard** | Notes, todos, calendar, reminders. On disk, yours |
| ⌥ | **Developer** | Eleven tools. No account, no key |
| ⊞ | **Apps** | GitHub, Gmail, Browser, Weather, News, Map, Timer, Calculator |
| ◈ | **Games** | Four, with scores kept |

→ **[How each of these works, and why](docs/FEATURES.md)**

---

## Any command can become an app

Run a command; if its output has a shape, a panel appears under it.

| | | | |
|---|---|---|---|
| `ls -l` | a listing | `df -h` | bars, fullest first |
| `git status -s` | staged and unstaged | `ps aux` | a process table |
| `git log` | a timeline | `docker ps` | containers |
| `mkdir project` | the confirmation it never prints | anything JSON | laid out |

**No model is involved.** These are parsers, and every one refuses more than
it accepts. It never replaces the output, actions only *type* a command, and a
pipe makes it decline — because reading `docker ps | grep api` as docker's
output would be confidently reading the wrong thing.

---

## The one rule

<p align="center">
  <img src="docs/img/architecture.svg" alt="The window can ask. Only Rust can act." width="860">
</p>

The window has no ambient authority. Its CSP names no host but `'self'`, so a
compromised frontend has nowhere to send anything — every fetch, every secret,
every process is Rust's.

Four tests enforce it, and they read the source rather than trusting a comment:

| Test | What it refuses |
|---|---|
| pinned command list | an IPC command nobody reviewed |
| pinned capability list | a permission nobody reviewed |
| no secret getter | any command that returns a key |
| `connect-src 'self'` | any host the window could reach |

---

## Shortcuts

| | | | |
|---|---|---|---|
| `Ctrl+K` | palette | `Ctrl+B` | show or hide the sidebar |
| `Ctrl+T` | new terminal | `Ctrl+Shift+T` | split right |
| `Ctrl+W` | close tab | `Ctrl+Shift+D` | split down |
| `Ctrl+F` | find | `Ctrl+Shift+←↑↓→` | move between panes |

Every one is rebindable in **Settings → Keyboard**, by pressing the keys you
want rather than by typing their names.

---

## Getting it

### From a release

Installers for Linux (`.deb`, `.rpm`, `.AppImage`), macOS (`.dmg`, both
architectures) and Windows (`.msi`, `.exe`) are attached to each
[release](https://github.com/kartikeyajay2006/jky-terminal/releases).

Builds are currently **unsigned**, so macOS and Windows warn on first launch.
[`docs/RELEASING.md`](docs/RELEASING.md) explains what turning signing on
requires.

### From source

```sh
# Linux needs the webview headers first
sudo dnf install webkit2gtk4.1-devel libsoup3-devel openssl-devel \
  curl wget file libappindicator-gtk3-devel librsvg2-devel
# or: sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev \
#       libjavascriptcoregtk-4.1-dev build-essential libssl-dev \
#       libayatana-appindicator3-dev librsvg2-dev

corepack enable
pnpm install
pnpm dev:desktop      # the real app
pnpm dev              # UI only, in a browser, no Rust rebuild
```

---

---

## Working on it

```sh
pnpm run verify                 # typecheck, lint, test, build, credential scan
cargo test --workspace          # Rust
cargo clippy --workspace --all-targets -- -D warnings
```

**Building a binary that runs on its own** needs the `custom-protocol` feature,
not just `--release`. Tauri decides dev-versus-production from that feature and
not from the build profile — `let dev = !custom_protocol` — so a plain
`cargo build --release` still points at the dev server and opens a blank
window:

```sh
pnpm --filter @jky/desktop build                              # the frontend
cargo build --release -p jky-terminal --features tauri/custom-protocol
```

`pnpm dev:desktop` needs a file watcher for each of Vite and the Tauri CLI. On
Linux that is an inotify instance apiece, and the default
`fs.inotify.max_user_instances` of 128 is easy to exhaust with a desktop shell
running — the symptom is `Too many open files`. `sysctl -w
fs.inotify.max_user_instances=512` fixes it.

```
jky-terminal/
├─ apps/desktop/
│  ├─ src/                    React 18 + TypeScript + Vite
│  │  ├─ app/                 shell, rail, tabs, theme, stores
│  │  ├─ features/
│  │  │  ├─ terminal/         xterm.js + WebGL, find, links, scrollback
│  │  │  ├─ assistant/        streaming chat, tool cards, sessions
│  │  │  ├─ dashboard/        notes, todos, calendar, reminders
│  │  │  ├─ notifications/    banners and the notification centre
│  │  │  ├─ games/            grid engine + four games
│  │  │  ├─ apps/             registry and the eight apps
│  │  │  ├─ developer/        registry and the eleven tools
│  │  │  ├─ palette/          Ctrl+K
│  │  │  └─ settings/         themes, keys, command catalogue
│  │  ├─ components/          the shared board, tabs, spinner
│  │  ├─ lib/                 tile layout and board session, as plain data
│  │  ├─ platform/            the adapter — tauri.ts and web.ts
│  │  └─ styles/              tokens and seven themes
│  └─ src-tauri/              thin #[tauri::command] wrappers only
└─ crates/
   ├─ jky-secrets/            SecretStore + OS keychain
   ├─ jky-pty/                portable-pty, launchers, command catalogue
   ├─ jky-ai/                 AIProvider, Anthropic, tool sandbox
   ├─ jky-store/              collections + capped scrollback
   ├─ jky-apps/               weather, news, places, routes, github, gmail, browser
   ├─ jky-tools/              hashing, diffing, YAML
   ├─ jky-system/             processor, memory, disks, processes, DNS
   ├─ jky-settings/           preferences
   ├─ jky-capture/            naming, saving and copying a screenshot
   └─ jky-audit/              local-only audit log
```

**Two rules worth knowing before changing anything.** All real logic lives in
`crates/`, so it is testable with `cargo test` without launching a window —
`src-tauri/src/commands/` holds only thin wrappers. And every native
capability is reached through `src/platform/`; a component that calls
`invoke()` directly is a lint error, because that boundary is what lets the
whole UI run and be tested in a browser.

### CI

Every push runs, on **Linux, macOS and Windows** with `fail-fast: false`:

| Job | What it proves |
|---|---|
| Frontend | typecheck, lint, 1813 tests |
| Native ×3 | `cargo test`, `clippy -D warnings`, and the shippable binary **links** |
| Dependency audit | `pnpm audit` and `cargo audit`, failing on high or critical |
| Security assertions | the command surface, the CSP, and no key in the bundle |

Compiling the library is not proof of portability. Linking the real binary is
where a platform-specific keychain backend actually fails.

---

---

## What is not here yet

Stated plainly, because a README that only lists what works is a sales page.

- **YouTube.** It needs Google OAuth like Gmail does, and Gmail now has the
  loopback sign-in that makes that possible — so this is a matter of building
  it rather than of not being able to. What is not planned is stripping ads:
  it violates YouTube's terms, and this app ships under a real name.
- **Sending mail.** The scope is `gmail.readonly` and a test keeps
  `gmail.send` and `gmail.modify` out of it, so this is enforced rather than
  promised. Reading your mail is a terminal being useful; sending it is a
  terminal with your signature, and that is a different decision.
- **Signing and auto-update.** The release pipeline works; certificates and an
  updater keypair do not exist yet. See [`docs/RELEASING.md`](docs/RELEASING.md).
- **Database tab.** v0.2.
- **Plugins.** v0.3.
- **Trending and Explore in the GitHub app.** GitHub publishes no API for
  either; every client that shows them scrapes the page. Left out rather than
  shipped as dead menu entries.

---

---

## Licence

MIT — see [LICENSE](LICENSE). The core stays free and open, always.
