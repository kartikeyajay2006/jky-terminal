import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Settings } from "./Settings";

describe("Settings", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => __setPlatformForTests(null));

  it("opens on appearance", async () => {
    render(<Settings />);
    expect(await screen.findByRole("heading", { name: /appearance/i })).toBeInTheDocument();
  });

  it("lists its sections", () => {
    render(<Settings />);
    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(nav).toHaveTextContent(/appearance/i);
    expect(nav).toHaveTextContent(/providers/i);
  });

  it("reaches providers from settings", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /providers/i }));
    // The vault names how many keys are stored; that line only exists there.
    expect(await screen.findByLabelText(/of \d+ keys added/i)).toBeInTheDocument();
  });

  it("lists the jky commands", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /commands/i }));

    // Scoped to the list: the hint above it also mentions `jky commands`, so
    // an unscoped query matches twice and proves nothing about the list.
    const list = await screen.findByRole("list", { name: /jky commands/i });
    expect(within(list).getByText("jky-terminal")).toBeInTheDocument();
    expect(within(list).getByText("jky ask <question>")).toBeInTheDocument();
    expect(within(list).getByText("jky commands")).toBeInTheDocument();
  });

  it("shows the alternative spellings of a command", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /commands/i }));
    // Knowing only the canonical spelling is knowing two thirds of nothing.
    expect(await screen.findByText(/jkyterminal, jkyTerminal/)).toBeInTheDocument();
    expect(screen.getByText(/jky asks/)).toBeInTheDocument();
  });

  it("explains what each command does, not just its name", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /commands/i }));
    expect(
      await screen.findByText(/Ask the assistant without leaving the terminal/),
    ).toBeInTheDocument();
  });

  it("says the same list is available from the terminal", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /commands/i }));
    expect(await screen.findByText(/prints the same list/i)).toBeInTheDocument();
  });

  it("changes the theme from the swatch grid", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /^nord$/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
  });

  it("changes the theme from the dropdown", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("combobox", { name: /theme/i }));
    await user.click(await screen.findByRole("option", { name: /dracula/i }));

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dracula"),
    );
  });

  it("remembers the theme choice", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /^solarized$/i }));
    expect(localStorage.getItem("jky.theme")).toBe("solarized");
  });

  it("marks the active theme so it is findable without reading every label", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /^nord$/i }));
    expect(screen.getByRole("button", { name: /^nord$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers every theme as a swatch, not only in the dropdown", () => {
    render(<Settings />);
    const swatches = screen.getByRole("group", { name: /theme previews/i });
    expect(within(swatches).getAllByRole("button")).toHaveLength(6);
  });

  it("points at the accessible theme for anyone struggling to read the others", () => {
    render(<Settings />);
    expect(screen.getByText(/WCAG AAA/)).toBeInTheDocument();
  });
});
