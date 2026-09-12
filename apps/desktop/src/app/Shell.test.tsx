import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { useHud } from "./hudStore";
import { createWebPlatform, __setPlatformForTests } from "../platform";
import type { Platform } from "../platform/types";

describe("Shell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useHud.setState({ on: false });
    __setPlatformForTests(null);
  });

  /** A platform whose shell has a name. */
  function withShell(name: string, fail = false): Platform {
    const base = createWebPlatform();
    return {
      ...base,
      pty: {
        ...base.pty,
        async shell() {
          if (fail) throw new Error("no backend");
          return name;
        },
      },
    };
  }

  describe("the shell it names", () => {
    it("reports which shell the terminal will run", async () => {
      __setPlatformForTests(withShell("zsh"));
      render(<Shell>{null}</Shell>);
      expect(await screen.findByRole("contentinfo")).toHaveTextContent(/shell/i);
    });

    it("says the shell Rust reports, not one inferred from the browser", async () => {
      __setPlatformForTests(withShell("fish"));
      render(<Shell>{null}</Shell>);

      // The old code read navigator.userAgent and answered "bash" on every
      // Linux machine, whatever was actually running.
      expect(await screen.findByText("fish")).toBeInTheDocument();
      expect(screen.queryByText("bash")).not.toBeInTheDocument();
    });

    it("names powershell on a machine that runs it", async () => {
      __setPlatformForTests(withShell("powershell"));
      render(<Shell>{null}</Shell>);
      expect(await screen.findByText("powershell")).toBeInTheDocument();
    });

    it("says nothing at all when there is no shell to name", async () => {
      // The browser preview runs none. A label with nothing after it, or a
      // guessed name, are both worse than no label.
      __setPlatformForTests(withShell(""));
      render(<Shell>{null}</Shell>);
      await screen.findByRole("contentinfo");
      expect(screen.queryByText(/^shell$/i)).not.toBeInTheDocument();
    });

    it("stays quiet when the backend cannot be asked", async () => {
      __setPlatformForTests(withShell("zsh", true));
      render(<Shell>{null}</Shell>);
      const bar = await screen.findByRole("contentinfo");
      // Nothing depends on the answer, so a failure is not worth a word.
      expect(bar).not.toHaveTextContent(/shell/i);
    });
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
    expect(nav).toHaveTextContent(/assistant/i);
    expect(nav).toHaveTextContent(/settings/i);
  });

  it("offers Apps as a workspace destination", () => {
    render(<Shell>{null}</Shell>);
    const nav = screen.getByRole("navigation", { name: /workspace/i });
    expect(nav).toHaveTextContent(/apps/i);
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

  describe("focus mode", () => {
    it("keeps the navigation until asked", () => {
      render(<Shell>{null}</Shell>);
      expect(screen.getByRole("navigation", { name: /workspace/i })).toBeInTheDocument();
    });

    it("drops the chrome and gives the window to the work", () => {
      const { container } = render(
        <Shell>
          <p>workspace content</p>
        </Shell>,
      );
      act(() => useHud.getState().toggle());

      expect(container.querySelector(".shell")).toHaveAttribute("data-hud", "on");
      // The work itself is untouched. A focus mode that unmounted the
      // terminal would kill the shell and everything typed into it.
      expect(screen.getByText("workspace content")).toBeInTheDocument();
    });

    it("leaves one way out on screen, not only a chord", () => {
      render(<Shell>{null}</Shell>);
      act(() => useHud.getState().toggle());
      // A mode you can only leave by remembering a keystroke is a mode
      // people get stuck in once and then never enter again.
      expect(screen.getByRole("button", { name: /leave focus/i })).toBeInTheDocument();
    });

    it("goes back when that way out is taken", async () => {
      const user = userEvent.setup();
      render(<Shell>{null}</Shell>);
      act(() => useHud.getState().toggle());

      await user.click(screen.getByRole("button", { name: /leave focus/i }));
      expect(useHud.getState().on).toBe(false);
      expect(screen.getByRole("navigation", { name: /workspace/i })).toBeInTheDocument();
    });

    it("offers no way out when there is nothing to leave", () => {
      render(<Shell>{null}</Shell>);
      expect(screen.queryByRole("button", { name: /leave focus/i })).not.toBeInTheDocument();
    });
  });
});
