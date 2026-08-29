import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES } from "../../app/theme";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Settings } from "./Settings";
import { TERM_FONT_EVENT, loadTermFont, saveTermFont } from "../terminal/termFont";

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

  it("does not offer an activity panel", () => {
    // The audit log is still written — it is beside the settings file and
    // readable with `cat` — but the window has no way to read it back, so
    // there is nothing here to show.
    render(<Settings />);
    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(nav).not.toHaveTextContent(/activity/i);
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

  const PANELS = ["Appearance", "Providers", "Commands"];

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

describe("terminal font settings", () => {
  beforeEach(() => localStorage.clear());

  async function openTerminalPanel() {
    const user = userEvent.setup();
    render(<Settings />);
    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    await user.click(within(nav).getByRole("button", { name: /^Terminal/ }));
    return user;
  }

  it("is reachable from the settings nav", async () => {
    await openTerminalPanel();
    expect(screen.getByRole("heading", { name: "Terminal" })).toBeInTheDocument();
  });

  it("shows the current size", async () => {
    await openTerminalPanel();
    expect(screen.getByLabelText(/terminal font size/i)).toHaveValue("13");
  });

  it("makes the text bigger", async () => {
    const user = await openTerminalPanel();
    await user.click(screen.getByRole("button", { name: /larger/i }));
    expect(screen.getByLabelText(/terminal font size/i)).toHaveValue("14");
  });

  it("makes the text smaller", async () => {
    const user = await openTerminalPanel();
    await user.click(screen.getByRole("button", { name: /smaller/i }));
    expect(screen.getByLabelText(/terminal font size/i)).toHaveValue("12");
  });

  it("remembers the size across a restart", async () => {
    const user = await openTerminalPanel();
    await user.click(screen.getByRole("button", { name: /larger/i }));
    expect(loadTermFont().size).toBe(14);
  });

  it("offers a choice of typeface", async () => {
    await openTerminalPanel();
    expect(screen.getByRole("combobox", { name: /terminal typeface/i })).toBeTruthy();
  });

  it("changes the typeface and remembers it", async () => {
    const user = await openTerminalPanel();
    await user.click(screen.getByRole("combobox", { name: /terminal typeface/i }));
    await user.click(await screen.findByRole("option", { name: /fira code/i }));

    await waitFor(() => expect(loadTermFont().family).toBe("fira"));
  });

  it("previews the actual face and size, not a description of them", async () => {
    // A font size is something you judge by looking at it.
    const user = await openTerminalPanel();
    await user.click(screen.getByRole("button", { name: /larger/i }));

    const preview = screen.getByLabelText(/font preview/i);
    expect(preview).toHaveStyle({ fontSize: "14px" });
  });

  it("tells open terminals, so a change needs no new tab", async () => {
    const heard = vi.fn();
    window.addEventListener(TERM_FONT_EVENT, heard);

    const user = await openTerminalPanel();
    await user.click(screen.getByRole("button", { name: /larger/i }));

    expect(heard).toHaveBeenCalled();
    window.removeEventListener(TERM_FONT_EVENT, heard);
  });
});

describe("only offering faces this machine has", () => {
  beforeEach(() => localStorage.clear());

  /** Pretend only the named faces are installed. */
  function withFonts(present: string[]) {
    const stub = {
      font: "",
      measureText(text: string) {
        void text;
        const asked = /^\d+px "([^"]+)"/.exec(stub.font)?.[1];
        return { width: asked && present.includes(asked) ? 200 : 100 };
      },
    };
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error a deliberately narrow stub
    HTMLCanvasElement.prototype.getContext = () => stub;
    return () => {
      HTMLCanvasElement.prototype.getContext = original;
    };
  }

  async function openTypeface() {
    const user = userEvent.setup();
    render(<Settings />);
    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    await user.click(within(nav).getByRole("button", { name: /^Terminal/ }));
    await user.click(screen.getByRole("combobox", { name: /terminal typeface/i }));
    return user;
  }

  it("leaves a missing face out of the list entirely", async () => {
    // Offering one the machine does not have is offering a setting that does
    // nothing: it falls back to whatever was already on screen.
    const restore = withFonts(["Fira Code"]);
    try {
      await openTypeface();
      expect(screen.queryByRole("option", { name: /cascadia/i })).toBeNull();
      expect(screen.getByRole("option", { name: /fira code/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("always keeps the app default, which needs no face of its own", async () => {
    const restore = withFonts([]);
    try {
      await openTypeface();
      expect(screen.getByRole("option", { name: /app default/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("keeps a saved choice listed even when this machine lacks it", async () => {
    // A setting carried over from another machine should not leave the
    // control showing a blank.
    saveTermFont({ size: 13, family: "cascadia" });
    const restore = withFonts([]);
    try {
      await openTypeface();
      expect(
        screen.getByRole("option", { name: /cascadia code.*not installed/i }),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("keeps everything when it cannot measure, since unknown is not absent", async () => {
    // jsdom has no canvas, so nothing can be ruled out.
    await openTypeface();
    expect(screen.getByRole("option", { name: /courier new/i })).toBeInTheDocument();
  });
});
