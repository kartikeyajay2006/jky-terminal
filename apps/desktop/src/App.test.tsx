import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// xterm draws to a canvas and asks the window about media queries, neither of
// which jsdom has. The terminal's own tests mock it the same way; what is
// being checked here is whether the component survives a section change, not
// what it renders.
const disposed = { count: 0 };
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    // Copy-on-select subscribes to this.
    onSelectionChange() {
      return { dispose() {} };
    }
    getSelection() {
      return "";
    }
    clear() {}
    focus() {}
    loadAddon() {}
    parser = { registerOscHandler: () => ({ dispose() {} }) };
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
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate() {}
    dispose() {}
    onDidChangeResults() {
      return { dispose() {} };
    }
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    activate() {}
    dispose() {}
    serialize() {
      return "";
    }
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { App } from "./App";
import { useTabs } from "./app/tabStore";
import { useChat } from "./app/chatStore";
import { useDashboard } from "./features/dashboard/dashboardStore";
import { createWebPlatform, __setPlatformForTests, type Platform } from "./platform";

/** A platform whose pty spawns are counted. */
function counting(): { platform: Platform; spawns: () => number } {
  const base = createWebPlatform();
  const spawn = vi.fn(base.pty.spawn);
  return {
    platform: { ...base, pty: { ...base.pty, spawn } },
    spawns: () => spawn.mock.calls.length,
  };
}

describe("moving between sections", () => {
  beforeEach(() => {
    disposed.count = 0;
    useTabs.setState({ tabs: [], activeId: null });
    useChat.setState({ sessions: [], activeId: null, busy: false, tools: [], error: null });
    useDashboard.setState({
      notes: [], todos: [], events: [], reminders: [], loaded: false, errors: {},
    });
  });
  afterEach(() => __setPlatformForTests(null));

  async function openTerminal(user: ReturnType<typeof userEvent.setup>) {
    const rendered = render(<App />);
    // Through the app's own control, so the test exercises what a person does.
    await user.click(screen.getByRole("button", { name: /new terminal/i }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    return rendered;
  }

  function go(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    const rail = screen.getByRole("navigation", { name: /workspace/i });
    return user.click(within(rail).getByRole("button", { name }));
  }

  it("keeps the terminal alive across a trip to the dashboard", async () => {
    // The shell is a live process with scrollback. Unmounting the workspace
    // disposes the terminal and kills the shell, so everything typed is gone
    // and a new one is spawned on the way back.
    const { platform, spawns } = counting();
    __setPlatformForTests(platform);

    const user = userEvent.setup();
    await openTerminal(user);
    await waitFor(() => expect(spawns()).toBe(1));

    await go(user, /dashboard/i);
    await go(user, /terminal/i);

    expect(spawns(), "the terminal was respawned, so the session was lost").toBe(1);
    expect(disposed.count, "the terminal was disposed, killing its shell").toBe(0);
  });

  it("keeps the terminal alive across a trip to settings", async () => {
    const { platform, spawns } = counting();
    __setPlatformForTests(platform);

    const user = userEvent.setup();
    await openTerminal(user);
    await waitFor(() => expect(spawns()).toBe(1));

    await go(user, /settings/i);
    await go(user, /terminal/i);

    expect(spawns()).toBe(1);
  });

  it("keeps the terminal alive across a trip to the assistant", async () => {
    const { platform, spawns } = counting();
    __setPlatformForTests(platform);

    const user = userEvent.setup();
    await openTerminal(user);
    await waitFor(() => expect(spawns()).toBe(1));

    await go(user, /assistant/i);
    await go(user, /terminal/i);

    expect(spawns()).toBe(1);
  });

  it("survives several trips, not just one", async () => {
    const { platform, spawns } = counting();
    __setPlatformForTests(platform);

    const user = userEvent.setup();
    await openTerminal(user);
    await waitFor(() => expect(spawns()).toBe(1));

    for (const where of [/dashboard/i, /settings/i, /assistant/i, /dashboard/i]) {
      await go(user, where);
      await go(user, /terminal/i);
    }
    expect(spawns()).toBe(1);
  });

  it("still shows only the section that was chosen", async () => {
    // Keeping the workspace mounted must not leave it visible underneath.
    __setPlatformForTests(createWebPlatform());
    const user = userEvent.setup();
    const { container } = await openTerminal(user);
    const workspace = () => container.querySelector(".workspace")!;

    await go(user, /dashboard/i);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(workspace()).not.toBeVisible();

    await go(user, /terminal/i);
    expect(workspace()).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
  });

  it("takes the hidden workspace out of the accessibility tree", async () => {
    // Mounted but hidden must mean hidden to a screen reader too, or the tab
    // bar of an invisible section is still in the tab order.
    __setPlatformForTests(createWebPlatform());
    const user = userEvent.setup();
    await openTerminal(user);

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    await go(user, /dashboard/i);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
