import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEMES } from "../../app/theme";
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

  it("shows the activity log", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByRole("heading", { name: /^activity$/i })).toBeInTheDocument();
  });

  it("explains that the activity file is readable without the app", async () => {
    // An audit trail you can only inspect through the thing being audited is
    // worth less, and the user should know it is not the only way in.
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText(/without this app/i)).toBeInTheDocument();
  });

  it("says so when nothing has been recorded rather than showing an empty box", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText(/nothing recorded yet/i)).toBeInTheDocument();
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
    expect(within(swatches).getAllByRole("button")).toHaveLength(THEMES.length);
  });

  it("points at the accessible theme for anyone struggling to read the others", () => {
    render(<Settings />);
    expect(screen.getByText(/WCAG AAA/)).toBeInTheDocument();
  });
});

/**
 * Every settings panel is laid out the same way.
 *
 * Providers was built first and grew its own centred container and masthead;
 * the others were left with a bare heading against the left edge, so moving
 * between them shifted the content sideways and changed how the title looked.
 * These check the shared structure rather than the pixels — jsdom has no
 * layout engine, but a panel that skips the shared container is exactly the
 * regression that put them out of alignment in the first place.
 */
describe("settings panels", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  const PANELS = ["Appearance", "Providers", "Commands", "Activity"];

  for (const name of PANELS) {
    it(`${name} sits in the shared centred container`, async () => {
      const user = userEvent.setup();
      const { container } = render(<Settings />);
      await user.click(screen.getByRole("button", { name: new RegExp(name, "i") }));

      // One container per panel, and it is the shared one. Two would mean a
      // panel brought its own and drifted; none would mean it is not centred.
      expect(container.querySelectorAll(".settings__panel > .panel")).toHaveLength(1);
    });

    it(`${name} has the same masthead as every other panel`, async () => {
      const user = userEvent.setup();
      const { container } = render(<Settings />);
      await user.click(screen.getByRole("button", { name: new RegExp(name, "i") }));

      const mast = container.querySelector(".panel > .mast");
      expect(mast, `${name} has no masthead`).not.toBeNull();

      // The heading names the section, not the product: the brand repeated
      // as the heading on all four panels tells you nothing about where you
      // are, which is what it used to do on Providers.
      const heading = mast!.querySelector("h2");
      expect(heading?.textContent?.trim().toLowerCase()).toBe(name.toLowerCase());
    });

    it(`${name} names itself to a screen reader`, async () => {
      const user = userEvent.setup();
      render(<Settings />);
      await user.click(screen.getByRole("button", { name: new RegExp(name, "i") }));

      // The decorative brand must stay out of the accessible name.
      expect(
        screen.getByRole("region", { name: new RegExp(`^${name}$`, "i") }),
      ).toBeTruthy();
    });
  }
});
