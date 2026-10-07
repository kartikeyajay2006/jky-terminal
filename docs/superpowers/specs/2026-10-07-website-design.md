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
| Look | "Neon Noir": the app's own Cyberpunk theme — its ground, its cyan → violet → magenta emblem light, JetBrains Mono. Neon only where something is alive or interactive, as in the app. |
| Stack | Astro 7 (static HTML first, small per-component scripts), GSAP + ScrollTrigger + SplitText, Lenis smooth scroll, a hand-written WebGL2 glyph field. |
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
4. **Three stories that pin as you scroll:** close the window mid-build and it keeps going (with the
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
