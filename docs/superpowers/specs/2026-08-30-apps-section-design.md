# Apps section — Design Spec

**Date:** 2026-08-30
**Implements:** the Apps workspace section — eight integrated apps
**Supersedes nothing.** Extends `2026-08-26-jky-terminal-v0.1-design.md`, which
deferred the integrations hub to v0.2. This spec defines what that hub actually
is, having measured what is possible rather than assumed it.

---

## 1. Purpose

A sixth workspace section holding eight apps a person reaches for beside their
work: GitHub, YouTube, Reddit, News, Weather, Map, Timer, Calculator.

The governing rule, stated by the user:

> if someone opens it, open there only

An app opens **inside JKY Terminal**, not in the system browser. Clicking
through to another app opens a switcher panel listing the rest, so moving
between apps never means going back out to a grid first.

That rule is the whole design constraint, and satisfying it honestly required
measuring what the web actually permits. §3 records those measurements, because
the naive reading of this requirement — put each service in an iframe — does
not work, and the design only makes sense once that is on the page.

---

## 2. What is being built, and what is not

### In scope — eight apps

| App | Render mode | Auth |
|---|---|---|
| Calculator | `local` | none |
| Timer | `local` | none |
| Weather | `data` | none |
| News | `data` | none |
| Map | `frame` | none |
| YouTube | `frame` | Google |
| Reddit | `data` | Reddit |
| GitHub | `data` | GitHub |

Plus the section itself: rail destination, app grid, the switcher overlay, the
app registry, and the `jky-apps` crate.

### Explicitly not in scope

**The Browser app.** It was the ninth app in the original list and is deferred,
for a specific reason: arbitrary URLs cannot be framed (§3), so a browser needs
a real webview, and a webview *docked as a pane inside an existing window* is
behind Tauri's `unstable` Cargo feature with open bugs on positioning and
blank-on-load. Every other app in this spec rests on stable ground. Browser
gets its own spec once that feature stabilises or a separate webview window is
accepted as the shape.

Also out: notifications from apps, offline caching of fetched data, and any app
beyond the eight listed.

---

## 3. The embedding constraint

This section records measurements taken on 2026-08-30, not recollection. Every
verdict below came from reading real response headers.

### 3.1 Iframes are not an option for real sites

Response headers for candidate services:

| Service | `X-Frame-Options` | CSP `frame-ancestors` |
|---|---|---|
| GitHub | `deny` | `'none'` |
| Jira | `deny` | `'none'` |
| Gmail | `DENY` | `'self'` |
| Google Calendar | `DENY` | — |
| Grafana | `DENY` | — |
| Slack | `SAMEORIGIN` | — |
| Notion | `SAMEORIGIN` | `'self'` + named hosts |
| Figma | `SAMEORIGIN` | — |
| YouTube (main) | `SAMEORIGIN` | — |
| Reddit (main) | `SAMEORIGIN` | — |
| OpenStreetMap (main) | `SAMEORIGIN` | `'self'` |
| Claude.ai | `SAMEORIGIN` | — |
| ChatGPT | — | `'self'` + extensions |
| Spotify | — | `'self'` + named hosts |
| Linear | — | `'self'` + named host |
| Excalidraw | — | — |

Every major service refuses to be framed. An iframe-based app grid is dead on
arrival, and no amount of client-side effort changes it — these are headers the
*server* sends and the browser enforces.

### 3.2 But dedicated embed endpoints are open

The main sites block framing; their purpose-built embed endpoints do not:

| Endpoint | `X-Frame-Options` | `frame-ancestors` |
|---|---|---|
| `youtube.com/embed/<id>` | — | — |
| `openstreetmap.org/export/embed.html` | — | — |

Both returned HTTP 200 with no framing restriction of any kind. These exist to
be embedded, and they are why YouTube and Map can be `frame` mode while
everything else cannot.

### 3.3 Native webviews are not iframes

`X-Frame-Options` and `frame-ancestors` govern *nested* browsing contexts only.
A native child webview is a top-level context — the same as a browser tab — so
none of §3.1 applies to it. This is the escape hatch that makes a Browser app
possible at all, and the reason it is deferred rather than declared impossible.

### 3.4 Google will not authenticate inside an embedded webview

Since 24 July 2023 Google detects embedded-webview user agents at its OAuth
endpoint and returns `disallowed_useragent`. There is no setting that disables
this; the stated rationale is that a host app owning the webview could read a
password or a one-time code.

The consequence for this design: **the Google sign-in step must open the user's
real browser.** That is the single place where "open there only" cannot hold,
it is imposed externally, and it is also the flow Google documents as correct
for desktop apps (PKCE with a loopback redirect).

### 3.5 Keyless sources, verified working

Confirmed to return usable data with no API key and no account:

- `api.open-meteo.com` — weather, returned live JSON
- `hacker-news.firebaseio.com` — news, returned a story-id array
- `tile.openstreetmap.org` — map tiles, returned HTTP 200 `image/png`

Reddit's `.json` suffix, historically usable unauthenticated, returned HTML for
a generic user agent. It is no longer a supported path; Reddit's official OAuth
API is the only route, which is why Reddit is `data` + auth rather than keyless.

---

## 4. Auth model

Three tiers, deliberately unequal, because a uniform rule would be worse.

### 4.1 No auth — Calculator, Timer, Weather, News, Map

These never ask for anything. Calculator and Timer touch no network at all;
Weather, News and Map use the keyless sources in §3.5.

Gating these behind a sign-in was considered and rejected: it adds friction,
buys nothing, and breaks the app for a user with no connection. A calculator
that requires a network login is a worse calculator.

### 4.2 Google — YouTube, and the JKY account

One Google sign-in serves two purposes: it is JKY Terminal's own account
identity, and it is what lights up YouTube, because the YouTube Data API *is*
Google OAuth. Signing in is optional; YouTube plays public videos without it.

Flow: Authorization Code + PKCE, loopback redirect, opened in the system
browser (§3.4 makes this mandatory, not a preference).

### 4.3 Per-service — GitHub, Reddit

A Google identity grants Google scopes. It cannot authenticate GitHub or
Reddit, which run their own authorization servers; there is no mechanism by
which signing into one connects the other. Each therefore has its own Connect
action, shown in-app when the user first opens it.

- **GitHub:** OAuth 2.0 Device Authorization Grant. The app shows a short code,
  the user approves on another device. This suits a terminal, needs no redirect
  URI, and triggers GitHub's own mobile push approval where enabled.
- **Reddit:** OAuth 2.0 installed-app flow with PKCE.

### 4.4 Client secrets

All three flows are secret-less by design — device flow and PKCE both exist
precisely because a distributed desktop binary cannot keep a client secret. No
client secret is compiled into the app or stored anywhere.

### 4.5 Token storage

Every token goes into the OS keychain through the existing `jky-secrets` crate,
under the rule already governing the Anthropic key: **no IPC command returns a
token.** Rust reads them when making a request; the frontend never holds one.
The existing "no command shaped like a secret getter" test is extended to cover
the new token names.

---

## 5. The registry

One record describes an app. The grid, the switcher and the Ctrl+K palette all
read from this single list, so app number nine is a registry entry plus a
panel — not a refactor.

```ts
type RenderMode = "local" | "data" | "frame";
type AuthKind = "none" | "google" | "github" | "reddit";

interface AppDef {
  id: string;          // "calculator", "github", …
  name: string;        // shown in the grid and switcher
  glyph: string;       // rail/grid mark, consistent with existing sections
  mode: RenderMode;
  auth: AuthKind;
  blurb: string;       // one line, shown on the grid tile
}
```

### The three render modes

**`local`** — Calculator, Timer. Pure React. No network, no IPC, no CSP
implication. Works offline.

**`data`** — Weather, News, Reddit, GitHub. A React panel renders; Rust performs
every outbound request and returns the result over IPC. This is the existing
architecture rather than a new one — *the window asks, only Rust acts* — and it
is why four apps ship without touching the CSP.

**`frame`** — YouTube, Map. An iframe pointed at one of the embed endpoints
measured open in §3.2. This is the only mode requiring a CSP change (§9).

---

## 6. `jky-apps` crate

New crate at `crates/jky-apps/`, following the workspace rule that real logic
lives in `crates/` and `src-tauri/src/commands/` holds thin wrappers only. It
is testable with `cargo test` without launching a window.

Responsibilities:

- The canonical app list, mirrored to TypeScript by a test that fails if the
  two drift.
- Fetchers for each `data` app, each returning a typed struct.
- The three OAuth flows, and token read/write through `jky-secrets`.

`reqwest` is already a workspace dependency with `rustls-tls`; no new HTTP
stack is introduced.

### Failure handling

A fetch that fails returns a typed error the panel renders as a retry state,
never a blank panel and never a thrown exception. Three cases are distinguished
because they need different words: **not connected** (no token — offer Connect),
**offline** (request never left), and **service error** (it answered badly).
A rate-limited response is a service error carrying its retry-after.

---

## 7. IPC surface

Every command is additive; nothing existing changes shape.

| Command | Purpose |
|---|---|
| `apps_list` | the registry, with per-app connection state |
| `apps_weather` | current conditions + short forecast |
| `apps_news` | top stories |
| `apps_reddit_feed` | posts for a subreddit |
| `apps_github_summary` | repos, issues, PRs, notifications |
| `apps_connect_start` | begin a flow; returns device code or auth URL |
| `apps_connect_poll` | poll a device flow to completion |
| `apps_disconnect` | delete a token from the keychain |

No command returns a token. `apps_list` reports connection as a boolean per
app, which is all the UI needs.

---

## 8. UI

### Navigation

A sixth rail destination, `⊞ Apps`, placed after Games and before the Settings
divider. `Rail.tsx` already drives the rail from a `DESTINATIONS` array; this is
one entry.

### The grid

Entering Apps shows all eight as tiles: glyph, name, one-line blurb, and
connection state where relevant. A tile that needs connecting says so rather
than failing after the user clicks it.

### The switcher

The user's requirement, taken literally: with an app open, a switcher control
opens an overlay listing the other apps, so switching never routes back through
the grid. Reachable by click and by keyboard.

`Ctrl+1`–`Ctrl+9` are already bound to terminal tabs, so the switcher takes
**`Ctrl+Shift+A`**. The existing Ctrl+K palette also gains an entry per app,
reading the same registry.

### Empty and unconnected states

Every app renders something useful before it has data: Weather asks for a
location, GitHub shows a Connect card explaining what it will read, Reddit the
same. No spinner-only screens.

---

## 9. Security posture

### The one CSP change

Current policy:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost
```

`frame-src` is added, naming exactly two hosts:

```
frame-src https://www.youtube.com https://www.openstreetmap.org
```

**`connect-src` is not widened, and must never be.** The distinction matters:
`frame-src` lets the window *display* an isolated document from those origins;
same-origin policy still prevents the app's own JavaScript from reading into
that frame or making requests to those hosts. The property that a compromised
frontend has nowhere to send data is preserved exactly.

A test pins the full CSP string so that widening it is a deliberate, visible
act rather than a quiet edit.

### Frame hardening

Both iframes carry a restrictive `sandbox` and `referrerpolicy`, and are built
from a validated app id and parameters — never from a URL supplied by the
window.

---

## 10. Testing

Per app, before its commit is pushed:

- Unit tests for the Rust fetcher, including its error cases, against recorded
  responses rather than the live network.
- Component tests for the panel: loading, loaded, empty, error, and — where it
  applies — unconnected.
- An a11y pass, matching the existing `a11y.test.tsx` coverage of dashboard
  panels.

Across the section:

- The Rust registry and the TypeScript registry agree.
- The CSP string matches its pin exactly.
- No IPC command is shaped like a token getter.
- Keyless endpoints are never called from tests; responses are fixtures, so the
  suite stays deterministic and offline.

The gate before every push is the project's existing one, unchanged:

```sh
pnpm run verify
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

---

## 11. Build order

Eight commits, one per app, each verified before it is pushed. Cheap apps come
first so the shared scaffolding is proven before the OAuth work lands on top of
it.

| # | App | What it establishes |
|---|---|---|
| 1 | Calculator | the section, rail entry, registry, grid, switcher |
| 2 | Timer | that the registry carries a second app cleanly |
| 3 | Weather | the `data` mode — `jky-apps`, Rust fetch, IPC, error states |
| 4 | News | reuse of that pattern with no new machinery |
| 5 | Map | the `frame` mode and the CSP change |
| 6 | YouTube | the second frame host, and Google OAuth |
| 7 | Reddit | Reddit OAuth, reusing the connect scaffolding |
| 8 | GitHub | device flow and the richest panel, on a mature foundation |

Steps 1–5 depend on nothing external. Steps 6–8 each require the user to
register an OAuth application with that service first; this is a signup the
maintainer must perform, and it is a genuine prerequisite rather than a detail.

---

## 12. Known costs, stated plainly

- **Reddit's API is rate-limited**, and commercial use sits behind a paid tier.
  Fine for a free, open-source app, but it is a constraint on the free tier, not
  an unlimited source.
- **YouTube `/embed/` gives playback, not a personalised feed.** Subscriptions
  need the YouTube Data API layered on the Google login — real work, not a
  checkbox.
- **The Google sign-in leaves the app**, once, by external mandate (§3.4).
- **Browser is absent** from this release (§2).
