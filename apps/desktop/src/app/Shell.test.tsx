import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { useHud } from "./hudStore";

describe("Shell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useHud.setState({ on: false });
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

  it("reports which shell the terminal will run", () => {
    render(<Shell>{null}</Shell>);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/shell/i);
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
