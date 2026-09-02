import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Developer } from "./Developer";
import { TOOLS, findTool } from "./registry";
import { EVENT_COLOURS, __setPlatformForTests, createWebPlatform } from "../../platform";
import { useNav } from "../../app/navStore";

beforeEach(() => {
  localStorage.clear();
  __setPlatformForTests(createWebPlatform());
});
afterEach(() => __setPlatformForTests(null));

describe("the tool registry", () => {
  it("gives every tool an id, a name, a glyph and a blurb", () => {
    for (const tool of TOOLS) {
      expect(tool.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(tool.name.trim()).not.toBe("");
      expect(tool.glyph.trim()).not.toBe("");
      expect(tool.blurb.trim()).not.toBe("");
    }
  });

  it("gives each tool its own colour from the theme's palette", () => {
    const tones = TOOLS.map((t) => t.tone);
    expect(new Set(tones).size).toBe(tones.length);
    for (const tone of tones) expect(EVENT_COLOURS).toContain(tone);
  });

  it("has no duplicate ids", () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
  });

  it("finds a tool by id, and nothing by a wrong one", () => {
    expect(findTool("json")?.name).toBe("JSON");
    expect(findTool("nope")).toBeUndefined();
  });
});

describe("Developer", () => {
  it("lists every tool", () => {
    render(<Developer />);
    const nav = screen.getByRole("navigation", { name: /tools/i });
    for (const tool of TOOLS) {
      expect(within(nav).getByRole("button", { name: new RegExp(tool.name, "i") }))
        .toBeInTheDocument();
    }
  });

  // Opening on an empty pane would waste the first visit.
  it("opens on the first tool", () => {
    render(<Developer />);
    expect(screen.getByRole("textbox", { name: /json/i })).toBeInTheDocument();
  });

  it("switches tool", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await user.click(screen.getByRole("button", { name: /hash/i }));
    expect(await screen.findByRole("textbox", { name: /text/i })).toBeInTheDocument();
  });

  it("marks which tool is showing", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await user.click(screen.getByRole("button", { name: /regex/i }));
    expect(screen.getByRole("button", { name: /regex/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  /*
   * Which tool you were in survives leaving the section.
   *
   * A workbench that resets to the first tool every time you glance at the
   * terminal is one you stop using for anything that takes two visits.
   */
  it("comes back to the tool you were using", async () => {
    const user = userEvent.setup();
    const view = render(<Developer />);
    await user.click(screen.getByRole("button", { name: /diff/i }));
    view.unmount();

    render(<Developer />);
    expect(screen.getByRole("textbox", { name: /before/i })).toBeInTheDocument();
  });

  // A stored id from a version that had a tool this one does not.
  it("falls back to the first tool when the stored one is gone", () => {
    localStorage.setItem("jky.developer.tool", '"a-tool-that-was-removed"');
    render(<Developer />);
    expect(screen.getByRole("textbox", { name: /json/i })).toBeInTheDocument();
  });

  it("says which tools do their work in Rust", () => {
    render(<Developer />);
    const nav = screen.getByRole("navigation", { name: /tools/i });
    const hash = within(nav).getByRole("button", { name: /hash/i });
    expect(hash).toHaveAttribute("data-backend", "rust");
  });

  // The palette can ask for a named tool; the request survives the switch.
  it("opens the tool the palette asked for", async () => {
    render(<Developer />);
    useNav.getState().go("developer", "jwt");
    expect(await screen.findByRole("textbox", { name: /token/i })).toBeInTheDocument();
  });
});
