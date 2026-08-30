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
});
