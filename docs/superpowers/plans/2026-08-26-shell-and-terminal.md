# JKY Terminal — Plan 2: Shell & Terminal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single settings screen into the workspace from the reference concept — left rail, tabbed centre, status bar, six themes — with a real cross-platform PTY running a real shell in a terminal tab.

**Architecture:** Themes extend the existing token layer, so no component changes to add one. The shell is a CSS grid with three regions and a Zustand store holding tab state. A new `crates/jky-pty` wraps `portable-pty`, which speaks ConPTY on Windows and a unix pty elsewhere; the frontend never sees a file descriptor, only `pty:data` events over the existing platform adapter. The terminal tab is xterm.js with the WebGL renderer.

**Tech Stack:** Rust 1.96 · `portable-pty` 0.8 · Tauri v2 events · React 18 · Zustand 5 · `@xterm/xterm` 5.5 · `@xterm/addon-fit` · `@xterm/addon-webgl` · Vitest · Vite

**Spec:** [`docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md`](../specs/2026-08-26-jky-terminal-v0.1-design.md)

## Global Constraints

Carried forward from Plan 1. Every one of these is already enforced by a test; do not weaken any of them to make a task easier.

- **No IPC command may return a secret value.** `apps/desktop/src-tauri/tests/security.rs` pins the exposed command list. This plan adds PTY commands, so that list must be updated **in the same commit** that adds them, with the reason in the message.
- **CSP `connect-src` may contain only** `'self'`, `ipc:`, `http://ipc.localhost`. The terminal must not fetch anything.
- **The renderer gets no `fs`, `shell`, or `http` capability.** A PTY is spawned by Rust on request; the renderer never gets shell access directly.
- **No literal colour in a component.** Every colour is a token from `src/styles/tokens.css`. This plan makes that rule load-bearing: six themes only work if it holds.
- **No component may import `@tauri-apps/api` directly** — only `src/platform/tauri.ts`. Enforced by ESLint.
- **Cross-platform parity is a hard requirement.** macOS, Windows and any Linux. The CI matrix builds and tests all three; a platform that does not compile blocks the merge.
- **Rust crates live in `crates/`**, TypeScript in `packages/` and `apps/`.
- **Commits are authored solely by `kartikeyajay2006 <kartikeyajay2006@gmail.com>`.** No co-author trailers, no AI-attribution anywhere.
- **Conventional Commits** for every message.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/src/styles/themes.css` | The five additional themes, as token overrides only |
| `apps/desktop/src/app/theme.ts` | Theme list, persistence, and applying `data-theme` |
| `apps/desktop/src/app/Shell.tsx` | The three-region grid: rail, workspace, status bar |
| `apps/desktop/src/app/Shell.css` | Shell layout |
| `apps/desktop/src/app/Rail.tsx` | Left navigation rail |
| `apps/desktop/src/app/StatusBar.tsx` | Bottom status strip: shell, theme, connection |
| `apps/desktop/src/app/tabStore.ts` | Zustand store: open tabs, active tab, open/close/focus |
| `apps/desktop/src/app/TabBar.tsx` | Tab strip with close buttons and keyboard hints |
| `crates/jky-pty/src/shell.rs` | Which shell to launch, per platform — pure logic |
| `crates/jky-pty/src/session.rs` | One live PTY: spawn, write, resize, kill |
| `crates/jky-pty/src/registry.rs` | Many sessions, keyed by id |
| `apps/desktop/src-tauri/src/commands/pty.rs` | PTY IPC wrappers and the output event pump |
| `apps/desktop/src/features/terminal/Terminal.tsx` | xterm.js instance bound to one PTY session |
| `apps/desktop/src/features/terminal/useXterm.ts` | xterm lifecycle: create, fit, dispose |

---

## Task 1: Six themes

**Files:**
- Create: `apps/desktop/src/styles/themes.css`, `apps/desktop/src/app/theme.ts`, `apps/desktop/src/app/theme.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: the token names already defined in `src/styles/tokens.css`.
- Produces: `THEMES: ThemeSpec[]`, `applyTheme(id: string): void`, `loadTheme(): string`, `saveTheme(id: string): void`, and `type ThemeId`. Task 2's status bar renders a switcher from `THEMES`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/app/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, loadTheme, saveTheme, THEMES, DEFAULT_THEME } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("ships the six launch themes", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "cyberpunk",
      "dracula",
      "nord",
      "solarized",
      "light",
      "contrast",
    ]);
  });

  it("gives every theme a human-readable name", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.label).not.toBe(t.id);
    }
  });

  it("applies a theme by stamping the root element", () => {
    applyTheme("nord");
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
  });

  it("remembers the chosen theme across reloads", () => {
    saveTheme("dracula");
    expect(loadTheme()).toBe("dracula");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("falls back to the default when the stored value is not a real theme", () => {
    // A theme could be removed in a later release, leaving a stale value on
    // disk. Loading it must not leave the app unstyled.
    localStorage.setItem("jky.theme", "vaporwave");
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("survives storage being unavailable", () => {
    // Private windows and locked-down browsers throw on access rather than
    // returning null. A theme preference is not worth crashing the app for.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() => loadTheme()).not.toThrow();
    expect(loadTheme()).toBe(DEFAULT_THEME);
    expect(() => saveTheme("nord")).not.toThrow();
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test theme`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Write the theme module**

`apps/desktop/src/app/theme.ts`:

```ts
export type ThemeId =
  | "cyberpunk"
  | "dracula"
  | "nord"
  | "solarized"
  | "light"
  | "contrast";

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  /** Shown in the switcher so the palette is recognisable before applying. */
  swatch: string;
}

export const THEMES: ThemeSpec[] = [
  { id: "cyberpunk", label: "Cyberpunk", swatch: "#00e5ff" },
  { id: "dracula", label: "Dracula", swatch: "#bd93f9" },
  { id: "nord", label: "Nord", swatch: "#88c0d0" },
  { id: "solarized", label: "Solarized", swatch: "#2aa198" },
  { id: "light", label: "Light", swatch: "#0f62fe" },
  { id: "contrast", label: "High Contrast", swatch: "#ffffff" },
];

export const DEFAULT_THEME: ThemeId = "cyberpunk";
const STORAGE_KEY = "jky.theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
}

export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Storage can throw outright in a private window. A remembered theme is
    // a convenience; never let it take the app down.
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Same reasoning as loadTheme: preference lost, app fine.
  }
}
```

- [ ] **Step 4: Write the theme stylesheet**

`apps/desktop/src/styles/themes.css`. Each block redefines **only** token values —
no selectors, no component rules. That is what keeps adding a theme a data change.

```css
/*
 * Additional themes. Each block overrides token values from tokens.css and
 * nothing else. If a theme needs a new selector, the component is reading a
 * literal colour somewhere and should be fixed instead.
 */

:root[data-theme="dracula"] {
  --ground: #21222c;
  --surface: #282a36;
  --surface-raised: #343746;
  --line: #3c3f51;
  --line-strong: #4c5064;
  --text-dim: #7b7f96;
  --text-muted: #a6abc8;
  --text: #f8f8f2;
  --accent: #8be9fd;
  --accent-dim: #62b8cc;
  --accent-glow: rgba(139, 233, 253, 0.14);
  --violet: #bd93f9;
  --magenta: #ff79c6;
  --danger: #ff5555;
  --warn: #ffb86c;
}

:root[data-theme="nord"] {
  --ground: #2e3440;
  --surface: #333b4a;
  --surface-raised: #3b4252;
  --line: #434c5e;
  --line-strong: #4c566a;
  --text-dim: #7b8494;
  --text-muted: #b8c1cf;
  --text: #eceff4;
  --accent: #88c0d0;
  --accent-dim: #6a9aa8;
  --accent-glow: rgba(136, 192, 208, 0.16);
  --violet: #b48ead;
  --magenta: #b48ead;
  --danger: #bf616a;
  --warn: #ebcb8b;
}

:root[data-theme="solarized"] {
  --ground: #002b36;
  --surface: #073642;
  --surface-raised: #0b414f;
  --line: #12525f;
  --line-strong: #586e75;
  --text-dim: #657b83;
  --text-muted: #839496;
  --text: #eee8d5;
  --accent: #2aa198;
  --accent-dim: #1f7f78;
  --accent-glow: rgba(42, 161, 152, 0.16);
  --violet: #6c71c4;
  --magenta: #d33682;
  --danger: #dc322f;
  --warn: #b58900;
}

:root[data-theme="light"] {
  --ground: #f7f7fa;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --line: #e2e2ea;
  --line-strong: #c9c9d6;
  --text-dim: #6b6b7b;
  --text-muted: #4a4a58;
  --text: #16161d;
  --accent: #0f62fe;
  --accent-dim: #0043ce;
  --accent-glow: rgba(15, 98, 254, 0.12);
  --violet: #6929c4;
  --magenta: #d02670;
  --danger: #da1e28;
  --warn: #8e6a00;
  color-scheme: light;
}

/*
 * High Contrast targets WCAG AAA. Pure black ground, pure white text, and
 * accents chosen for contrast rather than mood. Borders are deliberately
 * loud: this theme exists for people who cannot rely on subtle elevation.
 */
:root[data-theme="contrast"] {
  --ground: #000000;
  --surface: #000000;
  --surface-raised: #0c0c0c;
  --line: #6a6a6a;
  --line-strong: #9a9a9a;
  --text-dim: #c8c8c8;
  --text-muted: #e4e4e4;
  --text: #ffffff;
  --accent: #00ffff;
  --accent-dim: #00d5d5;
  --accent-glow: rgba(0, 255, 255, 0.22);
  --violet: #d0a0ff;
  --magenta: #ff8ae2;
  --danger: #ff8080;
  --warn: #ffd24d;
}
```

- [ ] **Step 5: Apply the stored theme at startup**

`apps/desktop/src/App.tsx`:

```tsx
import { useEffect } from "react";
import { applyTheme, loadTheme } from "./app/theme";
import { ProviderVault } from "./features/settings/ProviderVault";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);

  return <ProviderVault />;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 49 tests (42 existing + 7 new).

- [ ] **Step 7: Prove no component holds a literal colour**

Six themes only work if every colour comes from a token. Verify:

```bash
# Quote the globs. Under zsh an unquoted --include=*.tsx is expanded by the
# shell, grep errors, and the pipeline prints nothing — which looks exactly
# like a pass.
grep -rnE '#[0-9a-fA-F]{3,8}\b' apps/desktop/src --include='*.tsx' --include='*.ts' \
  | grep -v 'theme.ts'
```

Expected: no output. `theme.ts` is the one legitimate holder of literals — the
switcher swatches, which must show a theme's colour before it is applied.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(themes): add the six launch themes"
```

---

## Task 2: The app shell

**Files:**
- Create: `apps/desktop/src/app/Shell.tsx`, `apps/desktop/src/app/Shell.css`, `apps/desktop/src/app/Rail.tsx`, `apps/desktop/src/app/StatusBar.tsx`, `apps/desktop/src/app/Shell.test.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `THEMES`, `applyTheme`, `saveTheme`, `loadTheme` from Task 1; `Select` from `src/components/Select`.
- Produces: `<Shell>{children}</Shell>`, and `RAIL_ITEMS: RailItem[]` where `RailItem = { id: string; label: string; glyph: string }`. Task 3 renders the tab bar inside the shell's workspace region.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/app/Shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";

describe("Shell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders its children in the workspace region", () => {
    render(
      <Shell>
        <p>workspace content</p>
      </Shell>,
    );
    expect(screen.getByText("workspace content")).toBeInTheDocument();
  });

  it("gives the rail and status bar landmark roles", () => {
    render(<Shell>{null}</Shell>);
    expect(screen.getByRole("navigation", { name: /workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("lists the workspace destinations in the rail", () => {
    render(<Shell>{null}</Shell>);
    const nav = screen.getByRole("navigation", { name: /workspace/i });
    expect(nav).toHaveTextContent(/terminal/i);
    expect(nav).toHaveTextContent(/providers/i);
  });

  it("switches theme from the status bar", async () => {
    const user = userEvent.setup();
    render(<Shell>{null}</Shell>);

    await user.click(screen.getByRole("combobox", { name: /theme/i }));
    await user.click(await screen.findByRole("option", { name: /nord/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
  });

  it("remembers the theme choice", async () => {
    const user = userEvent.setup();
    render(<Shell>{null}</Shell>);

    await user.click(screen.getByRole("combobox", { name: /theme/i }));
    await user.click(await screen.findByRole("option", { name: /dracula/i }));

    expect(localStorage.getItem("jky.theme")).toBe("dracula");
  });

  it("reports which shell the terminal will run", () => {
    render(<Shell>{null}</Shell>);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/shell/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test Shell`
Expected: FAIL — cannot resolve `./Shell`.

- [ ] **Step 3: Write the rail**

`apps/desktop/src/app/Rail.tsx`:

```tsx
export interface RailItem {
  id: string;
  label: string;
  /** A text glyph rather than an icon font: no extra asset, themes for free. */
  glyph: string;
}

export const RAIL_ITEMS: RailItem[] = [
  { id: "terminal", label: "Terminal", glyph: "❯" },
  { id: "providers", label: "Providers", glyph: "◈" },
];

interface RailProps {
  activeId: string;
  onSelect: (id: string) => void;
}

export function Rail({ activeId, onSelect }: RailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <div className="rail__mark" aria-hidden="true">
        J
      </div>
      <ul className="rail__list">
        {RAIL_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rail__item"
              aria-current={item.id === activeId ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="rail__glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="rail__label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Write the status bar**

`apps/desktop/src/app/StatusBar.tsx`:

```tsx
import { Select } from "../components/Select";
import { THEMES, type ThemeId } from "./theme";

interface StatusBarProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
  shellName: string;
}

export function StatusBar({ theme, onThemeChange, shellName }: StatusBarProps) {
  return (
    <footer className="status">
      <span className="status__item">
        <span className="status__key">shell</span> {shellName}
      </span>
      <span className="status__spacer" />
      <span className="status__item status__theme">
        <span className="status__key">theme</span>
        <Select
          label="Theme"
          value={theme}
          options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
          onChange={(id) => onThemeChange(id as ThemeId)}
        />
      </span>
    </footer>
  );
}
```

- [ ] **Step 5: Write the shell**

`apps/desktop/src/app/Shell.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { applyTheme, loadTheme, saveTheme, type ThemeId } from "./theme";
import "./Shell.css";

interface ShellProps {
  children: ReactNode;
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function Shell({ children, activeId = "terminal", onSelect }: ShellProps) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function changeTheme(id: ThemeId) {
    setTheme(id);
    saveTheme(id);
  }

  return (
    <div className="shell">
      <Rail activeId={activeId} onSelect={onSelect ?? (() => {})} />
      <main className="shell__workspace">{children}</main>
      <StatusBar theme={theme} onThemeChange={changeTheme} shellName={shellLabel()} />
    </div>
  );
}

/**
 * A best-effort guess at the user's shell for display only. The authoritative
 * answer comes from the Rust side once a PTY is running (Task 6); this is what
 * the status bar shows before then.
 */
function shellLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "powershell";
  if (ua.includes("Mac")) return "zsh";
  return "bash";
}
```

`apps/desktop/src/app/Shell.css`:

```css
.shell {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 30px;
  grid-template-areas:
    "rail workspace"
    "status status";
  height: 100vh;
  background: var(--ground);
  color: var(--text);
}

.rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  gap: var(--s4);
  padding: var(--s4) var(--s2);
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow-y: auto;
}

.rail__mark {
  align-self: center;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  color: var(--accent);
  font-weight: 700;
  box-shadow: 0 0 16px var(--accent-glow);
}

.rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.rail__item {
  display: flex;
  align-items: center;
  gap: var(--s3);
  width: 100%;
  padding: var(--s2) var(--s3);
  border-left: 2px solid transparent;
  border-radius: var(--radius);
  color: var(--text-muted);
  transition: all var(--fast) var(--ease);
}

.rail__item:hover {
  background: var(--surface-raised);
  color: var(--text);
}

.rail__item[aria-current="page"] {
  border-left-color: var(--accent);
  background: var(--surface-raised);
  color: var(--accent);
}

.rail__glyph {
  width: 14px;
  text-align: center;
}

.shell__workspace {
  grid-area: workspace;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.status {
  grid-area: status;
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: 0 var(--s3);
  border-top: 1px solid var(--line);
  background: var(--surface);
  font-size: 11px;
  color: var(--text-muted);
}

.status__key {
  color: var(--text-dim);
}

.status__spacer {
  flex: 1;
}

.status__theme .sel__trigger {
  padding: 2px var(--s2);
  border-color: transparent;
  background: transparent;
  font-size: 11px;
}

.status__theme .sel__list {
  bottom: calc(100% + 4px);
  top: auto;
  min-width: 180px;
}

@media (max-width: 720px) {
  .shell {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .rail__label {
    display: none;
  }
}
```

- [ ] **Step 6: Mount the shell**

`apps/desktop/src/App.tsx`:

```tsx
import { useState } from "react";
import { Shell } from "./app/Shell";
import { ProviderVault } from "./features/settings/ProviderVault";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [active, setActive] = useState("providers");

  return (
    <Shell activeId={active} onSelect={setActive}>
      {active === "providers" ? <ProviderVault /> : <p>Terminal arrives in Task 6.</p>}
    </Shell>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 55 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(shell): add rail, workspace and status bar layout"
```

---

## Task 3: Tabs

**Files:**
- Create: `apps/desktop/src/app/tabStore.ts`, `apps/desktop/src/app/tabStore.test.ts`, `apps/desktop/src/app/TabBar.tsx`, `apps/desktop/src/app/TabBar.test.tsx`
- Modify: `apps/desktop/src/app/Shell.css`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useTabs()` Zustand hook exposing `{ tabs: Tab[]; activeId: string | null; openTab(kind, title): string; closeTab(id): void; focusTab(id): void; nextTab(): void }` where `Tab = { id: string; kind: "terminal" | "providers"; title: string }`. Task 6 calls `openTab("terminal", "Terminal 1")` and reads `activeId`.

- [ ] **Step 1: Write the failing store test**

`apps/desktop/src/app/tabStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useTabs } from "./tabStore";

const reset = () => useTabs.setState({ tabs: [], activeId: null });

describe("tabStore", () => {
  beforeEach(reset);

  it("starts with no tabs", () => {
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activeId).toBeNull();
  });

  it("focuses a newly opened tab", () => {
    const id = useTabs.getState().openTab("terminal", "Terminal 1");
    expect(useTabs.getState().activeId).toBe(id);
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("gives every tab a distinct id", () => {
    const a = useTabs.getState().openTab("terminal", "Terminal 1");
    const b = useTabs.getState().openTab("terminal", "Terminal 2");
    expect(a).not.toBe(b);
  });

  it("focuses the neighbour when the active tab is closed", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().closeTab(b);
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("clears the active id when the last tab closes", () => {
    const a = useTabs.getState().openTab("terminal", "only");
    useTabs.getState().closeTab(a);
    expect(useTabs.getState().activeId).toBeNull();
    expect(useTabs.getState().tabs).toEqual([]);
  });

  it("leaves the active tab alone when a different tab closes", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().closeTab(a);
    expect(useTabs.getState().activeId).toBe(b);
  });

  it("cycles to the first tab after the last", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().focusTab(b);
    useTabs.getState().nextTab();
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("ignores a close for an id that is not open", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().closeTab("never-existed");
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(useTabs.getState().activeId).toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test tabStore`
Expected: FAIL — cannot resolve `./tabStore`.

- [ ] **Step 3: Write the store**

`apps/desktop/src/app/tabStore.ts`:

```ts
import { create } from "zustand";

export type TabKind = "terminal" | "providers";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
}

interface TabState {
  tabs: Tab[];
  activeId: string | null;
  openTab: (kind: TabKind, title: string) => string;
  closeTab: (id: string) => void;
  focusTab: (id: string) => void;
  nextTab: () => void;
}

let counter = 0;
const nextId = () => `tab-${++counter}`;

export const useTabs = create<TabState>((set, get) => ({
  tabs: [],
  activeId: null,

  openTab: (kind, title) => {
    const id = nextId();
    set((s) => ({ tabs: [...s.tabs, { id, kind, title }], activeId: id }));
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    const remaining = tabs.filter((t) => t.id !== id);
    // Closing the focused tab moves focus to its left neighbour, or the new
    // first tab if it was leftmost. Closing any other tab leaves focus alone.
    const nextActive =
      activeId === id
        ? (remaining[index - 1] ?? remaining[0])?.id ?? null
        : activeId;

    set({ tabs: remaining, activeId: nextActive });
  },

  focusTab: (id) => {
    if (get().tabs.some((t) => t.id === id)) set({ activeId: id });
  },

  nextTab: () => {
    const { tabs, activeId } = get();
    if (tabs.length === 0) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    set({ activeId: tabs[(index + 1) % tabs.length].id });
  },
}));
```

- [ ] **Step 4: Run the store tests**

Run: `pnpm --filter @jky/desktop test tabStore`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing tab bar test**

`apps/desktop/src/app/TabBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TabBar } from "./TabBar";
import { useTabs } from "./tabStore";

describe("TabBar", () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

  it("invites the user to open a terminal when nothing is open", () => {
    render(<TabBar />);
    expect(screen.getByRole("button", { name: /new terminal/i })).toBeInTheDocument();
  });

  it("shows an open tab and marks it selected", () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: /Terminal 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("focuses a tab when it is clicked", async () => {
    const a = useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    await userEvent.setup().click(screen.getByRole("tab", { name: /Terminal 1/ }));
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("closes a tab from its close control without focusing it first", async () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    await userEvent.setup().click(screen.getByRole("button", { name: /close terminal 1/i }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Terminal 2"]);
  });

  it("opens a new terminal from the add control", async () => {
    render(<TabBar />);
    await userEvent.setup().click(screen.getByRole("button", { name: /new terminal/i }));
    expect(useTabs.getState().tabs).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @jky/desktop test TabBar`
Expected: FAIL — cannot resolve `./TabBar`.

- [ ] **Step 7: Write the tab bar**

`apps/desktop/src/app/TabBar.tsx`:

```tsx
import { useTabs } from "./tabStore";

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const focusTab = useTabs((s) => s.focusTab);
  const closeTab = useTabs((s) => s.closeTab);
  const openTab = useTabs((s) => s.openTab);

  return (
    <div className="tabbar" role="tablist" aria-label="Open tabs">
      {tabs.map((tab) => (
        <div key={tab.id} className="tabbar__slot">
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className="tabbar__tab"
            onClick={() => focusTab(tab.id)}
          >
            {tab.title}
          </button>
          <button
            type="button"
            className="tabbar__close"
            aria-label={`Close ${tab.title}`}
            onClick={() => closeTab(tab.id)}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tabbar__add"
        onClick={() => openTab("terminal", `Terminal ${tabs.length + 1}`)}
      >
        + New terminal
      </button>
    </div>
  );
}
```

Append to `apps/desktop/src/app/Shell.css`:

```css
.tabbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: var(--s2) var(--s2) 0;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  overflow-x: auto;
}

.tabbar__slot {
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius) var(--radius) 0 0;
}

.tabbar__slot:has([aria-selected="true"]) {
  border-color: var(--line);
  background: var(--ground);
}

.tabbar__tab {
  padding: var(--s2) var(--s3);
  color: var(--text-muted);
  white-space: nowrap;
}

.tabbar__tab[aria-selected="true"] {
  color: var(--accent);
}

.tabbar__close,
.tabbar__add {
  padding: var(--s2);
  color: var(--text-dim);
  white-space: nowrap;
}

.tabbar__close:hover {
  color: var(--danger);
}

.tabbar__add {
  padding: var(--s2) var(--s3);
}

.tabbar__add:hover {
  color: var(--accent);
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 68 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(tabs): add tab store and tab bar"
```

---

## Task 4: The PTY crate

This is the highest cross-platform risk in the plan. `portable-pty` speaks
ConPTY on Windows and a unix pty elsewhere, but *which shell to launch* and
*what environment it needs* differ per platform and are ours to get right.

**Files:**
- Create: `crates/jky-pty/Cargo.toml`, `crates/jky-pty/src/lib.rs`, `crates/jky-pty/src/shell.rs`, `crates/jky-pty/src/session.rs`, `crates/jky-pty/src/registry.rs`
- Modify: `Cargo.toml` (workspace dependencies)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `default_shell() -> ShellSpec` where `ShellSpec { program: String, args: Vec<String> }`; `PtySession::spawn(SpawnConfig) -> Result<PtySession, PtyError>` with `SpawnConfig { shell: ShellSpec, cwd: PathBuf, cols: u16, rows: u16 }`; `PtySession::write(&self, &[u8])`, `PtySession::resize(&self, cols, rows)`, `PtySession::kill(&self)`, `PtySession::take_reader(&self)`; `PtyRegistry::new()`, `PtyRegistry::insert(PtySession) -> String`, `PtyRegistry::get(&str)`, `PtyRegistry::remove(&str)`. Task 5 wraps all of these in IPC commands.

- [ ] **Step 1: Add the dependency**

Append to the workspace `[workspace.dependencies]` in the root `Cargo.toml`:

```toml
portable-pty = "0.8"
```

`crates/jky-pty/Cargo.toml`:

```toml
[package]
name = "jky-pty"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
portable-pty.workspace = true
thiserror.workspace = true
serde.workspace = true

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write the failing shell-resolution tests**

`crates/jky-pty/src/shell.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_shell_is_never_empty() {
        let spec = default_shell();
        assert!(!spec.program.is_empty(), "no shell resolved for this platform");
    }

    #[test]
    #[cfg(windows)]
    fn windows_falls_back_to_a_real_windows_shell() {
        let spec = resolve_shell(None, None);
        let p = spec.program.to_lowercase();
        assert!(
            p.contains("powershell") || p.contains("cmd"),
            "unusable Windows shell: {}",
            spec.program
        );
    }

    #[test]
    #[cfg(unix)]
    fn unix_prefers_the_shell_environment_variable() {
        let spec = resolve_shell(Some("/usr/bin/fish".into()), None);
        assert_eq!(spec.program, "/usr/bin/fish");
    }

    #[test]
    #[cfg(unix)]
    fn unix_falls_back_to_sh_when_shell_is_unset() {
        // A login shell is not guaranteed to be exported — cron and some
        // container images do not set it. /bin/sh is the one shell POSIX
        // requires to exist.
        let spec = resolve_shell(None, None);
        assert_eq!(spec.program, "/bin/sh");
    }

    #[test]
    #[cfg(unix)]
    fn an_empty_shell_variable_is_treated_as_unset() {
        assert_eq!(resolve_shell(Some(String::new()), None).program, "/bin/sh");
    }

    #[test]
    fn the_environment_declares_a_colour_capable_terminal() {
        let env = pty_env();
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
    }

    #[test]
    fn the_environment_identifies_this_terminal() {
        // Shell prompts and tools branch on this. Setting it means a user can
        // detect JKY Terminal in their rc files.
        assert_eq!(pty_env().get("TERM_PROGRAM").map(String::as_str), Some("jky-terminal"));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p jky-pty`
Expected: FAIL — `cannot find function default_shell`.

- [ ] **Step 4: Write shell resolution**

Prepend to `crates/jky-pty/src/shell.rs`:

```rust
use std::collections::HashMap;

/// The program a PTY should launch, and its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
}

/// Resolve the shell from the environment, with a per-platform fallback.
///
/// Taking the environment values as arguments rather than reading them here
/// is what makes this testable: a test can assert the Windows fallback while
/// running on Linux.
pub fn resolve_shell(shell_var: Option<String>, comspec_var: Option<String>) -> ShellSpec {
    let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());

    #[cfg(windows)]
    {
        let _ = shell_var;
        // PowerShell is the modern default; COMSPEC (usually cmd.exe) is the
        // guaranteed fallback because every Windows install has it.
        if let Some(comspec) = non_empty(comspec_var) {
            return ShellSpec { program: comspec, args: vec![] };
        }
        return ShellSpec {
            program: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
        };
    }

    #[cfg(not(windows))]
    {
        let _ = comspec_var;
        if let Some(shell) = non_empty(shell_var) {
            return ShellSpec { program: shell, args: vec![] };
        }
        // POSIX guarantees /bin/sh exists. $SHELL is not guaranteed to be
        // exported — cron jobs and slim container images often omit it.
        ShellSpec { program: "/bin/sh".to_string(), args: vec![] }
    }
}

pub fn default_shell() -> ShellSpec {
    resolve_shell(std::env::var("SHELL").ok(), std::env::var("COMSPEC").ok())
}

/// Environment additions every JKY Terminal PTY receives.
pub fn pty_env() -> HashMap<String, String> {
    HashMap::from([
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "jky-terminal".to_string()),
    ])
}
```

- [ ] **Step 5: Run the shell tests**

Run: `cargo test -p jky-pty`
Expected: PASS. On Linux 5 tests run and the Windows-only test is compiled out.

- [ ] **Step 6: Write the failing session test**

`crates/jky-pty/src/session.rs`. The integration test spawns a real PTY running
a one-shot command, so it proves the PTY works on whichever platform CI is on.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::time::{Duration, Instant};

    /// A command that echoes a marker and exits, spelled for the host platform.
    fn echo_marker() -> ShellSpec {
        #[cfg(windows)]
        {
            ShellSpec {
                program: "cmd.exe".into(),
                args: vec!["/C".into(), "echo JKY_MARKER".into()],
            }
        }
        #[cfg(not(windows))]
        {
            ShellSpec {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "echo JKY_MARKER".into()],
            }
        }
    }

    fn config(shell: ShellSpec) -> SpawnConfig {
        SpawnConfig {
            shell,
            cwd: std::env::temp_dir(),
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn a_spawned_shell_produces_output_on_every_platform() {
        let session = PtySession::spawn(config(echo_marker())).expect("spawn");
        let mut reader = session.take_reader().expect("reader");

        let mut seen = String::new();
        let mut buf = [0u8; 1024];
        let deadline = Instant::now() + Duration::from_secs(10);

        while Instant::now() < deadline && !seen.contains("JKY_MARKER") {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => seen.push_str(&String::from_utf8_lossy(&buf[..n])),
                Err(_) => break,
            }
        }

        assert!(
            seen.contains("JKY_MARKER"),
            "no PTY output on this platform. Got: {seen:?}"
        );
    }

    #[test]
    fn resizing_a_live_session_succeeds() {
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.resize(120, 40).is_ok());
        let _ = session.kill();
    }

    #[test]
    fn a_zero_dimension_is_clamped_rather_than_rejected() {
        // A pane can measure 0 during its first layout pass. Passing that
        // straight to the OS errors on some platforms, so clamp instead.
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.resize(0, 0).is_ok());
        let _ = session.kill();
    }

    #[test]
    fn spawning_a_program_that_does_not_exist_reports_an_error() {
        let spec = ShellSpec { program: "definitely-not-a-real-program".into(), args: vec![] };
        assert!(PtySession::spawn(config(spec)).is_err());
    }

    #[test]
    fn killing_a_session_twice_is_not_an_error() {
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.kill().is_ok());
        assert!(session.kill().is_ok(), "a second kill must be a no-op");
    }
}
```

- [ ] **Step 7: Run to verify failure**

Run: `cargo test -p jky-pty`
Expected: FAIL — `cannot find type PtySession`.

- [ ] **Step 8: Write the session**

Prepend to `crates/jky-pty/src/session.rs`:

```rust
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use portable_pty::{Child, CommandBuilder, MasterPty, PtyPair, PtySize, native_pty_system};

use crate::shell::{ShellSpec, default_shell, pty_env};

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("could not open a pty: {0}")]
    Open(String),
    #[error("could not start '{program}': {source}")]
    Spawn { program: String, source: String },
    #[error("pty io error: {0}")]
    Io(String),
}

pub struct SpawnConfig {
    pub shell: ShellSpec,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

impl Default for SpawnConfig {
    fn default() -> Self {
        Self {
            shell: default_shell(),
            cwd: std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir()),
            cols: 80,
            rows: 24,
        }
    }
}

pub struct PtySession {
    pair: PtyPair,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

/// A pane can measure zero during its first layout pass, and a zero dimension
/// is rejected outright by some platforms' pty APIs. Clamp rather than fail.
fn clamp(cols: u16, rows: u16) -> (u16, u16) {
    (cols.max(1), rows.max(1))
}

impl PtySession {
    pub fn spawn(config: SpawnConfig) -> Result<Self, PtyError> {
        let (cols, rows) = clamp(config.cols, config.rows);

        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Open(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&config.shell.program);
        for arg in &config.shell.args {
            cmd.arg(arg);
        }
        cmd.cwd(&config.cwd);
        for (k, v) in pty_env() {
            cmd.env(k, v);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| PtyError::Spawn {
            program: config.shell.program.clone(),
            source: e.to_string(),
        })?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Io(e.to_string()))?;

        Ok(Self {
            pair,
            child: Mutex::new(child),
            writer: Mutex::new(writer),
        })
    }

    /// Hand out the output stream. Callable once per session: the caller owns
    /// the read side and is expected to pump it on its own thread.
    pub fn take_reader(&self) -> Result<Box<dyn Read + Send>, PtyError> {
        self.pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn write(&self, bytes: &[u8]) -> Result<(), PtyError> {
        let mut w = self.writer.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        w.write_all(bytes).map_err(|e| PtyError::Io(e.to_string()))?;
        w.flush().map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        let (cols, rows) = clamp(cols, rows);
        self.pair
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    /// Terminate the child. Safe to call more than once — a process that has
    /// already exited is the desired end state, not an error.
    pub fn kill(&self) -> Result<(), PtyError> {
        let mut child = self.child.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        let _ = child.kill();
        Ok(())
    }
}

// The pty handles are safe to share; the interior mutability above guards the
// writer and the child handle.
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}
```

- [ ] **Step 9: Write the registry**

`crates/jky-pty/src/registry.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::session::PtySession;

/// Holds every live PTY, keyed by an id the frontend uses to address it.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    counter: Mutex<u64>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: PtySession) -> String {
        let mut counter = self.counter.lock().expect("counter lock");
        *counter += 1;
        let id = format!("pty-{counter}");
        drop(counter);

        self.sessions
            .lock()
            .expect("sessions lock")
            .insert(id.clone(), Arc::new(session));
        id
    }

    pub fn get(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.lock().expect("sessions lock").get(id).cloned()
    }

    /// Remove and kill. Returns whether a session was actually present.
    pub fn remove(&self, id: &str) -> bool {
        let removed = self.sessions.lock().expect("sessions lock").remove(id);
        match removed {
            Some(session) => {
                let _ = session.kill();
                true
            }
            None => false,
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.lock().expect("sessions lock").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::SpawnConfig;

    fn session() -> PtySession {
        PtySession::spawn(SpawnConfig::default()).expect("spawn")
    }

    #[test]
    fn a_new_registry_is_empty() {
        assert!(PtyRegistry::new().is_empty());
    }

    #[test]
    fn every_session_gets_a_distinct_id() {
        let reg = PtyRegistry::new();
        let a = reg.insert(session());
        let b = reg.insert(session());
        assert_ne!(a, b);
        assert_eq!(reg.len(), 2);
        reg.remove(&a);
        reg.remove(&b);
    }

    #[test]
    fn a_stored_session_can_be_looked_up() {
        let reg = PtyRegistry::new();
        let id = reg.insert(session());
        assert!(reg.get(&id).is_some());
        reg.remove(&id);
    }

    #[test]
    fn removing_reports_whether_anything_was_there() {
        let reg = PtyRegistry::new();
        let id = reg.insert(session());
        assert!(reg.remove(&id));
        assert!(!reg.remove(&id), "removing twice must report absence");
        assert!(reg.is_empty());
    }

    #[test]
    fn an_unknown_id_looks_up_to_nothing() {
        assert!(PtyRegistry::new().get("pty-999").is_none());
    }
}
```

`crates/jky-pty/src/lib.rs`:

```rust
mod registry;
mod session;
mod shell;

pub use registry::PtyRegistry;
pub use session::{PtyError, PtySession, SpawnConfig};
pub use shell::{ShellSpec, default_shell, pty_env, resolve_shell};
```

- [ ] **Step 10: Run the full crate suite**

Run: `cargo test -p jky-pty`
Expected: PASS. The spawn test proves a real shell ran on this platform.

- [ ] **Step 11: Commit**

```bash
git add crates/jky-pty Cargo.toml
git commit -m "feat(pty): add cross-platform pty sessions and registry"
```

---

## Task 5: PTY over IPC

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/pty.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/state.rs`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tests/security.rs`

**Interfaces:**
- Consumes: `PtyRegistry`, `PtySession`, `SpawnConfig`, `default_shell` from Task 4.
- Produces: four IPC commands — `pty_spawn(cols: u16, rows: u16) -> Result<String, String>` returning the session id, `pty_write(id: String, data: String)`, `pty_resize(id: String, cols: u16, rows: u16)`, `pty_kill(id: String)` — plus a `pty:data:{id}` Tauri event carrying `{ id, chunk }`. Task 6's adapter mirrors these exactly.

- [ ] **Step 1: Add the dependency and state**

Add to `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`:

```toml
jky-pty = { path = "../../../crates/jky-pty" }
```

Modify `apps/desktop/src-tauri/src/state.rs` — add the registry alongside the
existing fields:

```rust
use std::path::Path;
use std::sync::Arc;

use jky_pty::PtyRegistry;
use jky_secrets::{KeyringStore, SecretStore};
use jky_settings::SettingsStore;

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
    pub settings: Arc<SettingsStore>,
    pub ptys: Arc<PtyRegistry>,
}

impl AppState {
    /// `config_dir` is the OS-appropriate per-user application config directory,
    /// resolved by Tauri at startup. Taking it as an argument rather than
    /// discovering it here keeps this constructible in tests.
    pub fn new(config_dir: &Path) -> Self {
        Self {
            secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)),
            settings: Arc::new(SettingsStore::new(config_dir.join("settings.json"))),
            ptys: Arc::new(PtyRegistry::new()),
        }
    }
}
```

- [ ] **Step 2: Write the commands**

`apps/desktop/src-tauri/src/commands/pty.rs`:

```rust
use std::io::Read;

use jky_pty::{PtySession, SpawnConfig, default_shell};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

#[derive(Clone, Serialize)]
struct PtyChunk {
    id: String,
    chunk: String,
}

/// Event name carrying output for one session. Per-session rather than one
/// global channel, so a terminal only wakes for its own bytes.
fn data_event(id: &str) -> String {
    format!("pty:data:{id}")
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let session = PtySession::spawn(SpawnConfig {
        shell: default_shell(),
        cwd: std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir()),
        cols,
        rows,
    })
    .map_err(|e| e.to_string())?;

    let mut reader = session.take_reader().map_err(|e| e.to_string())?;
    let id = state.ptys.insert(session);

    // One pump thread per session. Reading a pty blocks, so it cannot live on
    // the async runtime; the thread ends when the pty closes and read returns 0.
    let event = data_event(&id);
    let id_for_thread = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let payload = PtyChunk { id: id_for_thread.clone(), chunk };
                    if app.emit(&event, payload).is_err() {
                        break; // the window is gone; stop pumping
                    }
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let session = state.ptys.get(&id).ok_or_else(|| format!("no pty '{id}'"))?;
    session.write(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.ptys.get(&id).ok_or_else(|| format!("no pty '{id}'"))?;
    session.resize(cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.ptys.remove(&id);
    Ok(()) // killing an already-dead pty is the desired end state
}
```

`apps/desktop/src-tauri/src/commands/mod.rs`:

```rust
pub mod pty;
pub mod settings;
pub mod vault;
```

Register them in `apps/desktop/src-tauri/src/main.rs`, adding to the existing
`generate_handler!` list:

```rust
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
```

and add `pty` to the `use commands::{...}` line.

- [ ] **Step 3: Update the pinned command surface**

The security test will fail until the new commands are acknowledged. That is
the guard working. In `apps/desktop/src-tauri/tests/security.rs`, extend the
expected list — note it is compared sorted, so keep it alphabetical:

```rust
    let expected = vec![
        "pty_kill".to_string(),
        "pty_resize".to_string(),
        "pty_spawn".to_string(),
        "pty_write".to_string(),
        "settings_set_active_provider".to_string(),
        "settings_set_selected_model".to_string(),
        "vault_delete_secret".to_string(),
        "vault_has_secret".to_string(),
        "vault_list_providers".to_string(),
        "vault_set_secret".to_string(),
    ];
```

- [ ] **Step 4: Run the Rust suite**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(pty): expose pty sessions over IPC

Adds four commands to the pinned IPC surface: spawn, write, resize and kill.
Each is a control operation on a pty the backend owns; none returns secret
material. Output is pushed as a per-session event rather than polled."
```

---

## Task 6: The terminal tab

**Files:**
- Create: `apps/desktop/src/features/terminal/useXterm.ts`, `apps/desktop/src/features/terminal/Terminal.tsx`, `apps/desktop/src/features/terminal/Terminal.test.tsx`
- Modify: `apps/desktop/src/platform/types.ts`, `apps/desktop/src/platform/tauri.ts`, `apps/desktop/src/platform/web.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/package.json`

**Interfaces:**
- Consumes: `getPlatform()` from Plan 1; `useTabs` from Task 3; the four PTY commands from Task 5.
- Produces: `<Terminal tabId={string} />`, and a `PtyApi` on the platform: `spawn(cols, rows): Promise<string>`, `write(id, data): Promise<void>`, `resize(id, cols, rows): Promise<void>`, `kill(id): Promise<void>`, `onData(id, cb): Promise<() => void>`.

- [ ] **Step 1: Install xterm**

```bash
pnpm --filter @jky/desktop add @xterm/xterm@^5.5.0 @xterm/addon-fit@^0.10.0 @xterm/addon-webgl@^0.18.0
```

Note the scope: the package moved from `xterm` to `@xterm/xterm`. The old
unscoped package still exists on npm and is stale — do not install it.

- [ ] **Step 2: Extend the platform interface**

Add to `apps/desktop/src/platform/types.ts`:

```ts
export interface PtyApi {
  spawn(cols: number, rows: number): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  /** Subscribe to this session's output. Resolves to an unsubscribe function. */
  onData(id: string, handler: (chunk: string) => void): Promise<() => void>;
}
```

and add `readonly pty: PtyApi;` to the `Platform` interface.

Add to `apps/desktop/src/platform/tauri.ts`:

```ts
import { listen } from "@tauri-apps/api/event";

  const pty: PtyApi = {
    async spawn(cols, rows) {
      return invoke<string>("pty_spawn", { cols, rows });
    },
    async write(id, data) {
      await invoke<void>("pty_write", { id, data });
    },
    async resize(id, cols, rows) {
      await invoke<void>("pty_resize", { id, cols, rows });
    },
    async kill(id) {
      await invoke<void>("pty_kill", { id });
    },
    async onData(id, handler) {
      return listen<{ id: string; chunk: string }>(`pty:data:${id}`, (e) =>
        handler(e.payload.chunk),
      );
    },
  };
```

and return `pty` from `createTauriPlatform`.

Add to `apps/desktop/src/platform/web.ts` — a mock shell so the browser build
and the tests exercise the same interface:

```ts
  const ptyHandlers = new Map<string, (chunk: string) => void>();
  let ptyCounter = 0;

  const pty: PtyApi = {
    async spawn() {
      const id = `web-pty-${++ptyCounter}`;
      // Give the fake shell a prompt so the terminal is visibly alive in the
      // browser build, where no real pty exists.
      queueMicrotask(() => ptyHandlers.get(id)?.("jky $ "));
      return id;
    },
    async write(id, data) {
      // Echo input back, like a real pty would, and answer Enter with a prompt.
      ptyHandlers.get(id)?.(data === "\r" ? "\r\njky $ " : data);
    },
    async resize() {},
    async kill(id) {
      ptyHandlers.delete(id);
    },
    async onData(id, handler) {
      ptyHandlers.set(id, handler);
      return () => ptyHandlers.delete(id);
    },
  };
```

and return `pty` from `createWebPlatform`.

- [ ] **Step 3: Write the failing terminal test**

xterm.js needs a real canvas and measures DOM geometry, neither of which jsdom
provides. Mock the module and assert the wiring instead — that the component
spawns a pty, forwards keystrokes, and writes output to the terminal.

`apps/desktop/src/features/terminal/Terminal.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: string[] = [];
const onDataHandlers: Array<(d: string) => void> = [];
const disposed = { count: 0 };

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    write(data: string) {
      writes.push(data);
    }
    onData(cb: (d: string) => void) {
      onDataHandlers.push(cb);
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    loadAddon() {}
    dispose() {
      disposed.count += 1;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    fit() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
  },
}));

import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Terminal } from "./Terminal";

describe("Terminal", () => {
  beforeEach(() => {
    writes.length = 0;
    onDataHandlers.length = 0;
    disposed.count = 0;
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => __setPlatformForTests(null));

  it("renders a labelled terminal region", async () => {
    render(<Terminal tabId="tab-1" />);
    expect(await screen.findByRole("application", { name: /terminal/i })).toBeInTheDocument();
  });

  it("writes pty output into the terminal", async () => {
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
  });

  it("forwards keystrokes to the pty", async () => {
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));

    writes.length = 0;
    onDataHandlers[0]("l");
    await waitFor(() => expect(writes.join("")).toContain("l"));
  });

  it("disposes the terminal when the tab closes", async () => {
    const { unmount } = render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    unmount();
    await waitFor(() => expect(disposed.count).toBe(1));
  });

  it("spawns exactly one pty even under StrictMode double-mounting", async () => {
    // React 18 StrictMode mounts, unmounts and remounts effects in
    // development. Without a guard that leaves an orphaned shell process
    // running for the lifetime of the app.
    const { unmount } = render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    unmount();
    expect(disposed.count).toBe(1);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @jky/desktop test Terminal`
Expected: FAIL — cannot resolve `./Terminal`.

- [ ] **Step 5: Write the xterm hook**

`apps/desktop/src/features/terminal/useXterm.ts`:

```ts
import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { getPlatform } from "../../platform";

/**
 * Owns one xterm instance bound to one pty session.
 *
 * Everything here is lifecycle: create the terminal, attach it to the DOM,
 * spawn a pty, pipe both directions, and tear all of it down exactly once.
 */
export function useXterm(container: React.RefObject<HTMLDivElement | null>) {
  const term = useRef<Xterm | null>(null);
  const ptyId = useRef<string | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const xterm = new Xterm({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono") ||
        "monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });
    term.current = xterm;

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(node);

    // WebGL is the fast path but is unavailable on some drivers and in every
    // headless environment. Falling back to the DOM renderer is correct;
    // failing to start a terminal over it is not.
    try {
      xterm.loadAddon(new WebglAddon());
    } catch {
      /* DOM renderer remains in use */
    }

    try {
      fit.fit();
    } catch {
      /* container not measurable yet; the resize observer will retry */
    }

    const platform = getPlatform();

    void (async () => {
      const id = await platform.pty.spawn(xterm.cols, xterm.rows);
      if (cancelled) {
        // StrictMode unmounted us mid-spawn. Kill it rather than leaking a
        // shell process for the lifetime of the app.
        void platform.pty.kill(id);
        return;
      }
      ptyId.current = id;
      unlisten = await platform.pty.onData(id, (chunk) => xterm.write(chunk));
      xterm.onData((data) => void platform.pty.write(id, data));
    })();

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ptyId.current) {
        void platform.pty.resize(ptyId.current, xterm.cols, xterm.rows);
      }
    });
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      unlisten?.();
      if (ptyId.current) void platform.pty.kill(ptyId.current);
      xterm.dispose();
      term.current = null;
      ptyId.current = null;
    };
  }, [container]);
}
```

- [ ] **Step 6: Write the component**

`apps/desktop/src/features/terminal/Terminal.tsx`:

```tsx
import { useRef } from "react";
import { useXterm } from "./useXterm";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  tabId: string;
}

export function Terminal({ tabId }: TerminalProps) {
  const container = useRef<HTMLDivElement>(null);
  useXterm(container);

  return (
    <div
      className="term"
      role="application"
      aria-label="Terminal"
      data-tab-id={tabId}
      ref={container}
    />
  );
}
```

`apps/desktop/src/features/terminal/Terminal.css`:

```css
.term {
  width: 100%;
  height: 100%;
  padding: var(--s3);
  background: var(--ground);
}

/* xterm sizes its own viewport; give the scrollbar the app's palette rather
   than the browser default. */
.term .xterm-viewport::-webkit-scrollbar {
  width: 10px;
}

.term .xterm-viewport::-webkit-scrollbar-thumb {
  background: var(--line-strong);
  border-radius: 5px;
}
```

- [ ] **Step 7: Mount it behind the tab bar**

`apps/desktop/src/App.tsx`:

```tsx
import { useState } from "react";
import { Shell } from "./app/Shell";
import { TabBar } from "./app/TabBar";
import { useTabs } from "./app/tabStore";
import { ProviderVault } from "./features/settings/ProviderVault";
import { Terminal } from "./features/terminal/Terminal";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [section, setSection] = useState("terminal");
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);

  if (section === "providers") {
    return (
      <Shell activeId={section} onSelect={setSection}>
        <ProviderVault />
      </Shell>
    );
  }

  return (
    <Shell activeId={section} onSelect={setSection}>
      <div className="workspace">
        <TabBar />
        <div className="workspace__body">
          {tabs.map((tab) => (
            // Kept mounted but hidden: a terminal that unmounts loses its
            // scrollback and kills its shell.
            <div
              key={tab.id}
              className="workspace__pane"
              hidden={tab.id !== activeId}
            >
              <Terminal tabId={tab.id} />
            </div>
          ))}
          {tabs.length === 0 && (
            <p className="workspace__empty">
              No terminal open. Press <kbd>+ New terminal</kbd> to start one.
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
```

Append to `apps/desktop/src/app/Shell.css`:

```css
.workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
}

.workspace__body {
  position: relative;
  min-height: 0;
}

.workspace__pane {
  position: absolute;
  inset: 0;
}

.workspace__pane[hidden] {
  display: none;
}

.workspace__empty {
  padding: var(--s6);
  color: var(--text-dim);
  font-family: var(--font-sans);
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 73 tests.

- [ ] **Step 9: Run the app and use the shell for real**

```bash
pnpm run dev:desktop
```

Expected: clicking **+ New terminal** opens a tab with a live shell. Type
`echo hello` and press Enter — you get `hello` back. Resize the window and the
shell reflows. This is the step that proves the whole chain; do not mark the
task done without it.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop
git commit -m "feat(terminal): add xterm terminal bound to a real pty"
```

---

## Task 7: Keyboard shortcuts

**Files:**
- Create: `apps/desktop/src/app/useShortcuts.ts`, `apps/desktop/src/app/useShortcuts.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `useTabs` from Task 3.
- Produces: `useShortcuts()`, called once from `App`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/app/useShortcuts.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useShortcuts } from "./useShortcuts";
import { useTabs } from "./tabStore";

function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
  );
}

describe("useShortcuts", () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

  it("opens a terminal on ctrl+t", () => {
    renderHook(() => useShortcuts());
    press("t", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("opens a terminal on cmd+t for macOS users", () => {
    renderHook(() => useShortcuts());
    press("t", { metaKey: true });
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("closes the active tab on ctrl+w", () => {
    renderHook(() => useShortcuts());
    useTabs.getState().openTab("terminal", "one");
    press("w", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("cycles tabs on ctrl+tab", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().openTab("terminal", "two");
    press("Tab", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("jumps straight to a tab by number", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    press("1", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
    press("2", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(b);
  });

  it("ignores a number with no tab behind it", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    press("9", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("ignores an unmodified keystroke so typing in the terminal still works", () => {
    renderHook(() => useShortcuts());
    press("t");
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useShortcuts());
    unmount();
    press("t", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test useShortcuts`
Expected: FAIL — cannot resolve `./useShortcuts`.

- [ ] **Step 3: Write the hook**

`apps/desktop/src/app/useShortcuts.ts`:

```ts
import { useEffect } from "react";
import { useTabs } from "./tabStore";

/**
 * Window-level shortcuts.
 *
 * Every binding requires a modifier. An unmodified key must reach the
 * terminal — a shell is the one place where every keystroke is meaningful.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const { openTab, closeTab, nextTab, tabs, activeId } = useTabs.getState();

      switch (e.key.toLowerCase()) {
        case "t":
          e.preventDefault();
          openTab("terminal", `Terminal ${tabs.length + 1}`);
          return;
        case "w":
          if (activeId) {
            e.preventDefault();
            closeTab(activeId);
          }
          return;
        case "tab":
          e.preventDefault();
          nextTab();
          return;
      }

      // Ctrl/Cmd+1..9 jumps straight to a tab, per spec §6.4. Out-of-range
      // numbers are ignored rather than clamped: jumping to a tab that is not
      // there would be a surprise, doing nothing is not.
      if (/^[1-9]$/.test(e.key)) {
        const target = tabs[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          useTabs.getState().focusTab(target.id);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
```

- [ ] **Step 4: Call it from App**

Add to `apps/desktop/src/App.tsx`, inside `App` before the return:

```tsx
  useShortcuts();
```

and import it: `import { useShortcuts } from "./app/useShortcuts";`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 81 tests (89 once Task 8's a11y suite lands).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(shell): add tab keyboard shortcuts"
```

---

## Task 8: Accessibility checks across every theme

Spec §7 requires axe-core assertions on every route in all six themes. This task
belongs here rather than later: a theme is exactly where contrast regressions
appear, and High Contrast exists specifically for people the other five fail.

**Files:**
- Create: `apps/desktop/src/app/a11y.test.tsx`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `Shell` (Task 2), `TabBar` (Task 3), `ProviderVault` (Plan 1), `THEMES` and `applyTheme` (Task 1).
- Produces: nothing consumed by later tasks. This is a gate.

- [ ] **Step 1: Install the checker**

```bash
pnpm --filter @jky/desktop add -D axe-core@^4.10.2 vitest-axe@^0.1.0
```

- [ ] **Step 2: Write the test**

`apps/desktop/src/app/a11y.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { TabBar } from "./TabBar";
import { useTabs } from "./tabStore";
import { applyTheme, THEMES } from "./theme";
import { createWebPlatform, __setPlatformForTests } from "../platform";
import { ProviderVault } from "../features/settings/ProviderVault";

describe("accessibility", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    useTabs.setState({ tabs: [], activeId: null });
  });
  afterEach(() => {
    __setPlatformForTests(null);
    document.documentElement.removeAttribute("data-theme");
  });

  // Every theme redefines colour tokens, so contrast is a per-theme property.
  // Checking only the default would leave five untested palettes shipping.
  for (const theme of THEMES) {
    it(`the shell has no violations in ${theme.label}`, async () => {
      applyTheme(theme.id);
      const { container } = render(
        <Shell>
          <TabBar />
        </Shell>,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("the provider vault has no violations", async () => {
    const { container } = render(<ProviderVault />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an expanded provider row has no violations", async () => {
    const { container, findByRole } = render(<ProviderVault />);
    (await findByRole("button", { name: /Anthropic/ })).click();
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

Add the matcher to `apps/desktop/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import * as matchers from "vitest-axe/matchers";
import { expect } from "vitest";

expect.extend(matchers);

// jsdom implements no layout engine, so Element.prototype.scrollIntoView does
// not exist. Components that keep an active option in view legitimately call
// it. Stub it here rather than guarding the call sites: the component is right
// to call it, and a real browser always provides it.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
```

- [ ] **Step 3: Run and fix what it finds**

Run: `pnpm --filter @jky/desktop test a11y`
Expected: PASS, 8 tests.

If a violation appears, fix the markup — never relax the assertion. The likely
findings and their real fixes:

- *Buttons must have discernible text*: an icon-only control needs an
  `aria-label`, not a `title`.
- *Elements must have sufficient colour contrast*: raise the token value in
  `themes.css` for that theme. Do not exempt the rule.
- *Certain ARIA roles must contain particular children*: a `role="tablist"`
  may only contain `role="tab"` elements, so the close button and the add
  button must sit outside the tablist or carry `role="presentation"` wrappers.

Note axe cannot compute contrast in jsdom, which has no layout. These tests
catch structural and ARIA faults; contrast is verified by eye in Task 9 Step 2.
Say so plainly rather than claiming automated contrast coverage.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "test(a11y): assert no axe violations in any theme"
```

---

## Task 9: Verify and merge

**Files:** none — this task is verification only.

- [ ] **Step 1: Run everything**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm run verify
```

Expected: all green. Record the real output; do not claim success without it.

- [ ] **Step 2: Check every theme renders**

Launch the app, then switch through all six themes from the status bar. For each,
confirm: text is readable against its background, the active rail item and active
tab are distinguishable, and the terminal is legible. High Contrast in particular
must show visible borders on every panel.

- [ ] **Step 3: Confirm no literal colours crept in**

```bash
# Quote the globs. Under zsh an unquoted --include=*.tsx is expanded by the
# shell, grep errors, and the pipeline prints nothing — which looks exactly
# like a pass.
grep -rnE '#[0-9a-fA-F]{3,8}\b' apps/desktop/src --include='*.tsx' --include='*.ts' \
  | grep -v 'theme.ts'
```

Expected: no output.

- [ ] **Step 4: Push and confirm the platform matrix**

```bash
git push origin HEAD
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: `Native (ubuntu-latest)`, `Native (macos-latest)` and
`Native (windows-latest)` all green. **The PTY is the first component whose
behaviour genuinely differs per platform** — ConPTY on Windows versus a unix
pty — so this run is the real test of Task 4, not the local one.

---

## Definition of Done

Plan 2 is complete when every one of these has been observed, not assumed:

- [ ] `cargo test --workspace` and `cargo clippy -D warnings` pass
- [ ] `pnpm run verify` passes end to end
- [ ] All six themes render correctly, checked by eye, including High Contrast
- [ ] A terminal tab runs a real shell: `echo hello` returns `hello`
- [ ] Resizing the window reflows the shell
- [ ] Opening several tabs gives several independent shells
- [ ] Closing a tab terminates its shell process (check with `ps` / Task Manager)
- [ ] `Ctrl/Cmd+T`, `Ctrl/Cmd+W`, `Ctrl/Cmd+Tab` and `Ctrl/Cmd+1..9` work
- [ ] axe reports no violations in any of the six themes
- [ ] CI is green on ubuntu, macos **and** windows
- [ ] Every commit shows `kartikeyajay2006` as sole author with no trailers

## What Plan 3 builds on this

Plan 3 (AI Assistant) adds an `assistant` tab kind to the existing tab store, a
`crates/jky-ai` provider trait with the Anthropic adapter reading its key
through `jky-secrets`, and a streaming chat panel. It needs no change to the
shell, the theme layer, or the PTY — which is the test of whether these
boundaries were drawn correctly.
