# JKY Terminal website — design

**Date:** 2026-10-07 · **Status:** approved, in build · **Lives in:** `apps/website`
**Ships to:** https://kartikeyajay2006.github.io/jky-terminal/

## What it is for

A public home for JKY Terminal that makes a developer want to try it within one screen, then shows —
rather than claims — the three things that make JKY different, and puts the installer one copy away.
The visual bar is "people say wow"; the honesty bar is the docs': every number is the real one, and
every limit is written next to the feature it limits.

## Decisions

| Question | Decision |
|---|---|
| Hosting | GitHub Pages, built and deployed by `.github/workflows/pages.yml` through `actions/deploy-pages`. No bot ever commits. |
| Look | High Contrast by default, with the app's seven themes available and saved choices respected. The cyan → violet → magenta emblem light and JetBrains Mono remain the visual identity. Neon only where something is alive or interactive, as in the app. |
| Stack | Astro 7 (static HTML first, small per-component scripts), GSAP + ScrollTrigger, native CSS sticky story tracks, Lenis smooth scroll, a hand-written WebGL2 glyph field. |
| Fonts | JetBrains Mono (the app's) for anything the product says; Instrument Sans for anything we explain. Self-hosted from `@fontsource-variable`. |
| Colours | Only the app's tokens, imported from `apps/desktop/src/styles/{tokens,themes}.css`. A literal colour is a lint error, as in the app. This is what lets the whole site re-theme at once. |
| Numbers | Read from the repository at build time (`src/lib/facts.ts`): IPC commands counted the way `tests/security.rs` counts them, crates, themes and their WCAG ratios from the token files, test floors. A test cross-checks the command count against the pinned list. |
| Releases | `scripts/fetch-release.mjs` bakes the latest release (tag, assets, sizes) into the build; Pages rebuilds on `release: published`. |
| Privacy | No analytics, no third-party requests. A CSP meta written into every page after the build: `connect-src 'self'`, hashed inline scripts only — the app's own rule, applied to its website. Astro's build telemetry is off. |

## The concept: everything is made of character cells

The terminal's atom is the character cell, so the page is built from it: the hero's mark is drawn by
a field of glyphs, the theme change sweeps across the page with a ring of characters, and the footer
wordmark is cells. Motion always demonstrates something JKY really does; nothing animates only to
decorate.

## Signature moments

1. **The mark builds itself from glyphs.** A WebGL2 field of monospace characters assembles the real
   `>j` mark (geometry from `components/jkyGlyph.ts`), shimmering in the theme's light; glyphs scatter
   around the pointer. Falls back to the SVG emblem without WebGL2; one still frame under reduced motion.
2. **A terminal you can type in.** A faithful JKY window runs a short demo, then hands over the prompt:
   `help`, `docker ps` (a panel builds beneath the output), `git status -s`, `git log`, `df -h`,
   `ls -l`, JSON, `mkdir`, a pipe that makes the recogniser decline, Tab completion, history. Labelled
   as a simulation; on touch screens commands are tap-to-run chips.
3. **`jky theme <name>` re-themes the entire site** from the app's seven token sets, revealed from the
   pointer outward. Also a theme picker in the nav and in the themes section.
4. **Three stories that stick as you scroll:** close the window mid-build and it keeps going (with the
   limit: a reboot still ends shells); output becomes a panel (with the three guarantees); the assistant
   has to ask (approval card, typed confirmation for destructive commands).
5. **Security perimeter:** the window's request to the internet meets the CSP and is refused; keys stay
   in the keychain; the command surface is pinned.

## Page order

Nav → Hero (glyph field, headline, install one-liner for your OS, live terminal) → proof strip →
Shells outlive the window → Output becomes a panel → The assistant has to ask → Security → Seven
themes → Ten sections → Honest comparison, including where JKY is behind → Install & downloads →
Footer.

## Quality floor

- Every link works on every push; the nav only links to sections that exist.
- Readable without JavaScript; usable at 360 px; no horizontal scroll.
- `prefers-reduced-motion`: every effect off, final states shown.
- Lighthouse mobile performance ≥ 90, accessibility 100; Chrome, Firefox and Safari.
- Before every deploy, a headless browser checks for console errors and requests to other hosts,
  runs axe, and confirms the terminal answers `help`.

## Out of scope

Blog, docs mirror (the docs stay on GitHub), analytics of any kind, a live demo of the real app.

## Website polish — 2026-10-08

The next unfinished push after `8142700` was performance work: viewport-triggered reveals and
replacement of GSAP pins with CSS sticky tracks. The partial checkout still pinned the persistence
story while also reserving a sticky track. All three stories now use the same approach, reserve their
space immediately, wait for fonts before measuring, and rebuild their timelines on viewport changes.
Small or short screens and reduced motion keep the natural document layout.

Headings animate as existing elements, without line splitting or scroll-time DOM rewrites. Reveals use
opacity and translation rather than blur; the large comparison table stays visible throughout.
Simple entrances use the browser's animation engine, and GSAP/ScrollTrigger load only near a story,
so the first screen does not initialize the below-fold timeline engine. Lenis feeds those timelines
from its scroll events once they load.
Story timelines follow that already-smoothed scroll directly, without a second catch-up tween. Their
updates render in order, and the persistence percentage is drawn once after the timeline's children
update, avoiding stale intermediate percentages when Safari jumps straight to a story's end.
Guessed heights and `content-visibility` are avoided because navigation and story timelines depend on
stable section positions. Scenes are initialized near the viewport rather than on the first screen.

The demo terminal's inner grid can shrink to the window's fixed height, so output actually scrolls.
Nested wheel scrolling stays inside the terminal while there is output to read, then returns to the
page at either edge. Reading earlier output pauses automatic following until the reader returns to the
bottom or submits another command. Dragging and using the scrollbar do not focus the prompt.

The website defaults to High Contrast before first paint, including without scripts or with an invalid
saved preference. Valid saved choices are preserved. The automatic demo no longer changes the page's
theme; explicit theme commands and the picker still do. The High Contrast navigation bar is opaque so
scrolled content does not show through its labels. Desktop application behavior is outside this change.

The comparison scroller contains its layout and paint, keeping its sticky feature column's overflow
inside the scroller. Without that containment, Chromium on mobile can silently expand its layout
viewport to the table's width, causing pointer coordinates and page scrolling to drift. The overflow
check asserts the layout viewport's width as well as the document's scroll width.
Fragment navigation is aligned after layout and fonts settle, using the same destination as the nav
links. This also handles Safari's stale fragment position after resizing a story track, and avoids
moving the initial destination once the visitor has already interacted.

Software-rendered WebGL uses the existing SVG emblem, detected before shader compilation or a large
draw. Hardware renderers retain the animated glyph field. Both paths have browser assertions; reduced
motion checks the still vector fallback when a glyph field is unavailable.

Validation before this push: frontend unit tests passed (2,370 tests, three existing skips), Rust
workspace tests passed (1,336 tests, four ignored), and the final Chromium desktop/mobile, Firefox,
and WebKit run passed 94 browser tests. Two existing clipboard tests are skipped on Firefox/WebKit,
whose runners do not expose the same clipboard permission. Repository lint, type checks, both
production builds, Rust Clippy with warnings denied, and both dependency audit commands passed.
Cargo audit still reports its existing allowed dependency warnings.

Local Lighthouse 12.8.2 mobile runs against the built baseline and final site, using Headless Chrome
152 and standard simulated throttling, scored 66 and 97 for performance respectively. Total blocking
time fell from 2,110 ms to 110 ms; accessibility, best practices, and SEO scored 100, with zero layout
shift. These are local measurements, not a guarantee of scores on every device or network.
