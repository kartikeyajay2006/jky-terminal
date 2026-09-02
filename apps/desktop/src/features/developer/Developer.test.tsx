import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Developer, DEV_GROUPS } from "./Developer";
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

  /*
   * Distinct within a group, not across all twelve.
   *
   * The palette has six event colours and there are twelve tools. Colour here
   * tells a tile from the ones beside it, and the board groups them — so the
   * rule is per group, the same conclusion the Apps registry reached when it
   * ran out of hues.
   */
  it("gives each tool its own colour among the ones it sits with", () => {
    for (const group of DEV_GROUPS) {
      const tones = TOOLS.filter((t) => group.holds(t)).map((t) => t.tone);
      expect(new Set(tones).size, `two tools in "${group.name}" share a colour: ${tones}`)
        .toBe(tones.length);
    }
    for (const tool of TOOLS) expect(EVENT_COLOURS).toContain(tool.tone);
  });

  // Every tool has to land in a group, or the board would silently drop it.
  it("puts every tool in exactly one group", () => {
    for (const tool of TOOLS) {
      const groups = DEV_GROUPS.filter((g) => g.holds(tool)).map((g) => g.name);
      expect(groups, `${tool.name} is in ${groups.length} groups`).toHaveLength(1);
    }
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
  /*
   * Scoped to the tile, not the board.
   *
   * A tile's button is named by everything written on it, and one tool's
   * blurb mentions another by name — YAML converts "to JSON and back" — so an
   * unscoped query matches two.
   */
  const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const tile = screen.getByRole("group", { name });
    await user.click(within(tile).getByRole("button"));
  };

  it("opens on the board, showing every tool", () => {
    render(<Developer />);
    const board = screen.getByRole("region", { name: /developer tools/i });
    for (const tool of TOOLS) {
      expect(within(board).getByRole("group", { name: tool.name })).toBeInTheDocument();
    }
  });

  /*
   * A tile has to say what the tool is for.
   *
   * "JSON" tells you nothing you did not know. The board is where someone
   * decides whether a tool is the one they want, so the reason to open it
   * belongs there rather than inside.
   */
  it("says on the tile what each tool is for", () => {
    render(<Developer />);
    const board = screen.getByRole("region", { name: /developer tools/i });
    for (const tool of TOOLS) {
      expect(within(board).getByText(tool.blurb)).toBeInTheDocument();
    }
  });

  it("opens a tool when its tile is chosen", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await open(user, "JSON");
    expect(await screen.findByRole("textbox", { name: /json/i })).toBeInTheDocument();
  });

  it("goes back to the board", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await open(user, "Hash");
    await user.click(screen.getByRole("button", { name: /all tools/i }));
    expect(screen.getByRole("region", { name: /developer tools/i })).toBeInTheDocument();
  });

  /*
   * Which tool you were in survives leaving the section.
   *
   * A workbench that resets every time you glance at the terminal is one you
   * stop using for anything that takes two visits.
   */
  it("comes back to the tools you had open", async () => {
    const user = userEvent.setup();
    const view = render(<Developer />);
    await open(user, "Diff");
    view.unmount();

    render(<Developer />);
    expect(screen.getByRole("textbox", { name: /before/i })).toBeInTheDocument();
  });

  // A stored id from a version that had a tool this one does not.
  it("shows the board when a stored tool is gone", () => {
    localStorage.setItem(
      "jky.developer.session",
      JSON.stringify({ open: ["a-tool-that-was-removed"], active: "a-tool-that-was-removed" }),
    );
    render(<Developer />);
    expect(screen.getByRole("region", { name: /developer tools/i })).toBeInTheDocument();
  });

  it("can be rearranged, like the Apps grid", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await user.click(screen.getByRole("button", { name: /edit layout/i }));

    const tile = screen.getByRole("group", { name: "JSON" });
    for (const name of [/pin/i, /hide/i, /duplicate/i, /remove/i, /size/i]) {
      expect(within(tile).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("keeps its arrangement apart from the Apps one", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await user.click(screen.getByRole("button", { name: /edit layout/i }));
    await user.click(within(screen.getByRole("group", { name: "JSON" })).getByRole("button", { name: /hide/i }));

    expect(localStorage.getItem("jky.developer.layout")).not.toBeNull();
    expect(localStorage.getItem("jky.apps.layout")).toBeNull();
  });

  /*
   * Every tool teaches itself.
   *
   * The complaint that produced these was "I cannot understand how to use
   * this", and an empty box with a clever name is the reason. Each tool has
   * to say what it is for and when you would reach for it — and a tool added
   * later must too, which is what this test is for.
   */
  it("gives every tool a use and a reason", async () => {
    const user = userEvent.setup();

    for (const tool of TOOLS) {
      const view = render(<Developer />);
      await open(user, tool.name);

      // "Reach for it when…" — the sentence that says why the app has this.
      expect(
        await screen.findByText(/reach for it/i),
        `${tool.name} never says when you would want it`,
      ).toBeInTheDocument();

      view.unmount();
      localStorage.clear();
    }
  });

  /*
   * Examples where there is something to put in.
   *
   * A tool you paste into opens empty and teaches nothing, so it carries
   * examples. A tool that reads this machine opens showing the machine — it
   * is already the example, and a button labelled "load an example computer"
   * would be nonsense.
   */
  it("gives every tool that takes input something to try", async () => {
    const user = userEvent.setup();
    const readsTheMachine = ["monitor", "processes", "env"];

    for (const tool of TOOLS.filter((t) => !readsTheMachine.includes(t.id))) {
      const view = render(<Developer />);
      await open(user, tool.name);

      const examples = await screen.findByRole("region", { name: /examples/i });
      expect(
        within(examples).getAllByRole("button").length,
        `${tool.name} offers no examples`,
      ).toBeGreaterThanOrEqual(2);

      view.unmount();
      localStorage.clear();
    }
  });

  // An example that loads nothing is a button that lies.
  it("puts something in the tool when an example is chosen", async () => {
    const user = userEvent.setup();
    render(<Developer />);
    await open(user, "JSON");

    const examples = screen.getByRole("region", { name: /examples/i });
    await user.click(within(examples).getAllByRole("button")[0]);

    const box = screen.getByRole("textbox", { name: /json/i }) as HTMLTextAreaElement;
    expect(box.value).toContain("users");
  });

  describe("more than one at a time", () => {
    const tabs = () => screen.getByRole("tablist", { name: /open tools/i });

    /*
     * The same as Apps, and for the same reason: comparing two things is the
     * ordinary case here. Formatting the JSON you are about to diff, hashing
     * the file you are checking against a token — being sent back to the
     * board between each is a step nobody asked for.
     */
    it("keeps the first tool open when a second is opened", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");
      await user.click(screen.getByRole("button", { name: /all tools/i }));
      await open(user, "Hash");

      expect(within(tabs()).getByRole("tab", { name: /json/i })).toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /hash/i })).toBeInTheDocument();
    });

    it("switches between them by their tabs", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");
      await user.click(screen.getByRole("button", { name: /all tools/i }));
      await open(user, "Hash");

      await user.click(within(tabs()).getByRole("tab", { name: /json/i }));
      expect(screen.getByRole("textbox", { name: /json/i })).toBeInTheDocument();
    });

    /*
     * What you typed is still there when you come back.
     *
     * The whole point of two being open: a tool that forgot its input on
     * every switch would make the tabs decoration.
     */
    it("keeps what was typed in a tool you switched away from", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");
      await user.click(screen.getByRole("textbox", { name: /json/i }));
      await user.paste('{"kept":true}');

      await user.click(screen.getByRole("button", { name: /all tools/i }));
      await open(user, "Hash");
      await user.click(within(tabs()).getByRole("tab", { name: /json/i }));

      const box = screen.getByRole("textbox", { name: /json/i }) as HTMLTextAreaElement;
      expect(box.value).toContain("kept");
    });

    it("closes one and stays in the other", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");
      await user.click(screen.getByRole("button", { name: /all tools/i }));
      await open(user, "Hash");

      const tab = within(tabs()).getByRole("tab", { name: /json/i });
      tab.focus();
      await user.keyboard("{Delete}");

      expect(within(tabs()).queryByRole("tab", { name: /json/i })).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /text/i })).toBeInTheDocument();
    });

    it("goes back to the board when the last one closes", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");

      const tab = within(tabs()).getByRole("tab", { name: /json/i });
      tab.focus();
      await user.keyboard("{Delete}");

      expect(screen.getByRole("region", { name: /developer tools/i })).toBeInTheDocument();
    });

    // Its own session, so closing a tool does not close an app.
    it("keeps its open tools apart from the open apps", async () => {
      const user = userEvent.setup();
      render(<Developer />);
      await open(user, "JSON");
      expect(localStorage.getItem("jky.developer.session")).not.toBeNull();
      expect(localStorage.getItem("jky.apps.session")).toBeNull();
    });
  });

  // The palette can ask for a named tool; the request survives the switch.
  it("opens the tool the palette asked for", async () => {
    render(<Developer />);
    useNav.getState().go("developer", "jwt");
    expect(await screen.findByRole("textbox", { name: /token/i })).toBeInTheDocument();
  });
});
