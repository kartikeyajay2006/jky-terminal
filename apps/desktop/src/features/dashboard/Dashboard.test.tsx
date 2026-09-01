import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dashboard, SECTIONS } from "./Dashboard";
import { useDashboard } from "./dashboardStore";
import { EVENT_COLOURS, __setPlatformForTests, createWebPlatform } from "../../platform";

function reset() {
  // The board's arrangement is stored, so one test's edits would otherwise
  // be the next test's starting board.
  localStorage.clear();
  __setPlatformForTests(createWebPlatform());
  useDashboard.setState({
    notes: [],
    todos: [],
    events: [],
    reminders: [],
    loaded: false,
    errors: {},
  });
}

describe("dashboard navigation", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  it("opens on the overview", async () => {
    render(<Dashboard />);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("offers every section the user asked for", () => {
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    for (const label of ["Notes", "Todos", "Calendar", "Reminders"]) {
      expect(within(nav).getByRole("button", { name: new RegExp(label, "i") })).toBeTruthy();
    }
  });

  for (const section of SECTIONS) {
    it(`reaches ${section.label} and gives it the shared masthead`, async () => {
      const user = userEvent.setup();
      const { container } = render(<Dashboard />);
      const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
      await user.click(within(nav).getByRole("button", { name: new RegExp(section.label, "i") }));

      const mast = container.querySelector(".panel > .mast");
      expect(mast, `${section.label} has no masthead`).not.toBeNull();
      expect(mast!.querySelector("h2")!.textContent).toBe(section.label);
    });
  }

  it("says plainly that nothing is pruned", async () => {
    // The user asked for this specifically, so it is stated in the UI rather
    // than only being true in the code.
    render(<Dashboard />);
    expect(screen.getByText(/stays until you delete it/i)).toBeInTheDocument();
  });
});

describe("the overview grid", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  /*
   * An empty dashboard used to look broken rather than new.
   *
   * With nothing written yet every card collapses to its smallest, and a
   * board laid out by content alone becomes a thin ribbon across the top of
   * a laptop screen with black below it. The calendar is the one card that is
   * never empty — dates exist whether or not you have written anything — so
   * it leads the board and is told to take two rows, and the rest fill in
   * around it.
   */
  it("leads with the calendar, the one card that is never empty", async () => {
    const { container } = render(<Dashboard />);
    await screen.findByRole("heading", { name: "Overview" });

    const cards = [...container.querySelectorAll(".card")];
    expect(cards[0].getAttribute("aria-label")).toBe("Calendar");
    // Its height is a size on the board now, not a class of its own — the
    // same fact, expressed in the thing that can also be changed.
    expect(cards[0].getAttribute("data-size")).toBe("medium");
  });

  // Only the anchor is tall. If every card claimed two rows the board would
  // be a column of tall empty boxes, which is the same failure with more
  // scrolling.
  it("makes exactly one card the tall one", async () => {
    const { container } = render(<Dashboard />);
    await screen.findByRole("heading", { name: "Overview" });
    expect(container.querySelectorAll('.card:not([data-size="small"])')).toHaveLength(1);
  });

  describe("the layout editor", () => {
    const edit = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: /edit board/i }));
    };

    /*
     * Editing is a mode, as it is in Apps. A card carries live controls —
     * a checkbox, a "new note" button — and putting five more on every one of
     * them permanently would make the board unusable for the thing it is for.
     */
    it("shows no editing controls until asked", async () => {
      render(<Dashboard />);
      await screen.findByRole("heading", { name: "Overview" });
      expect(screen.queryByRole("button", { name: /hide card/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /edit board/i })).toBeInTheDocument();
    });

    it("offers hide and resize on every card once editing", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      expect(within(card).getByRole("button", { name: /hide card/i })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: /size/i })).toBeInTheDocument();
    });

    it("hides a card, and says how many are hidden", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      await user.click(within(card).getByRole("button", { name: /hide card/i }));

      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: /restore 1/i })).toBeInTheDocument();
    });

    it("brings everything back", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      await user.click(within(card).getByRole("button", { name: /hide card/i }));
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument(),
      );

      await user.click(screen.getByRole("button", { name: /restore 1/i }));
      expect(await screen.findByRole("region", { name: "Notes" })).toBeInTheDocument();
    });

    it("resizes a card", async () => {
      const user = userEvent.setup();
      const { container } = render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      await user.click(within(card).getByRole("button", { name: /size/i }));

      await waitFor(() =>
        expect(container.querySelector('[aria-label="Notes"]')).toHaveAttribute(
          "data-size",
          "medium",
        ),
      );
    });

    /*
     * The board can be emptied, and that has to be a state it can come back
     * from. A dashboard showing nothing with no visible way out is one you
     * would have to clear storage to fix.
     */
    it("can be emptied and still offers the way back", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);

      for (const name of ["Calendar", "Notes", "Reminders", "Upcoming Events", "Todos", "Quick Actions"]) {
        const card = screen.getByRole("region", { name });
        await user.click(within(card).getByRole("button", { name: /hide card/i }));
      }

      expect(await screen.findByRole("button", { name: /restore 6/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /restore 6/i }));
      expect(await screen.findByRole("region", { name: "Calendar" })).toBeInTheDocument();
    });

    // An arrangement lost on every restart is not an arrangement.
    it("remembers the board across a remount", async () => {
      const user = userEvent.setup();
      const view = render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      await user.click(within(card).getByRole("button", { name: /hide card/i }));
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument(),
      );

      view.unmount();
      render(<Dashboard />);
      await screen.findByRole("heading", { name: "Overview" });
      expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument();
    });

    it("puts the board back the way it shipped", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);

      const card = screen.getByRole("region", { name: "Notes" });
      await user.click(within(card).getByRole("button", { name: /hide card/i }));
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument(),
      );

      await user.click(screen.getByRole("button", { name: /reset/i }));
      expect(await screen.findByRole("region", { name: "Notes" })).toBeInTheDocument();
    });

    it("leaves edit mode", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      await edit(user);
      await user.click(screen.getByRole("button", { name: /done/i }));
      expect(screen.queryByRole("button", { name: /hide card/i })).not.toBeInTheDocument();
    });
  });

  it("gives every card its own colour", async () => {
    // The point of six colours is finding the widget you want before reading
    // a word. A card added later with no tone would be the grey one.
    const { container } = render(<Dashboard />);
    await screen.findByRole("heading", { name: "Overview" });

    const cards = [...container.querySelectorAll(".card")];
    expect(cards.length).toBeGreaterThan(0);

    const tones = cards.map((c) => c.getAttribute("data-tone"));
    expect(tones.every(Boolean), "a card has no tone").toBe(true);
    expect(new Set(tones).size, `two cards share a colour: ${tones}`).toBe(tones.length);
  });

  it("uses only colours the themes define", async () => {
    const { container } = render(<Dashboard />);
    await screen.findByRole("heading", { name: "Overview" });

    for (const card of container.querySelectorAll(".card")) {
      expect(EVENT_COLOURS).toContain(card.getAttribute("data-tone"));
    }
  });

  it("shows every widget the user asked for", async () => {
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "Overview" });

    for (const name of [
      "Notes",
      "Calendar",
      "Reminders",
      "Upcoming Events",
      "Todos",
      "Quick Actions",
    ]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
  });

  it("quick actions reach the panels they name", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const quick = await screen.findByRole("region", { name: "Quick Actions" });

    await user.click(within(quick).getByRole("button", { name: /add event/i }));
    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
  });

  it("ticking a reminder on the overview ticks it everywhere", async () => {
    // The cards are views of the same store, not copies of it.
    const user = userEvent.setup();
    // Seeded through the platform, not the store: the dashboard loads on
    // mount, and state set beforehand would be overwritten by that load.
    const platform = createWebPlatform();
    await platform.store.reminders.save({
      id: "r1",
      text: "Exercise",
      at: "07:00",
      done: false,
    });
    __setPlatformForTests(platform);

    render(<Dashboard />);
    const card = await screen.findByRole("region", { name: "Reminders" });
    const box = await within(card).findByRole("checkbox");

    await user.click(box);
    await waitFor(() => expect(useDashboard.getState().reminders[0].done).toBe(true));
  });
});

describe("notes", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  async function openNotes(user: ReturnType<typeof userEvent.setup>) {
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /^Notes/i }));
  }

  it("starts with an empty state that says what to do", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    expect(screen.getByText(/start one with new note/i)).toBeInTheDocument();
  });

  it("creates a note and opens it", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));

    expect(await screen.findByRole("textbox", { name: /note body/i })).toBeInTheDocument();
  });

  it("keeps what is typed", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));

    const body = await screen.findByRole("textbox", { name: /note body/i });
    await user.type(body, "buy milk");

    await waitFor(() => expect(useDashboard.getState().notes[0].body).toBe("buy milk"));
  });

  it("lists every saved note", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));
    await user.click(screen.getByRole("button", { name: /new note/i }));

    await waitFor(() => expect(useDashboard.getState().notes).toHaveLength(2));
    const list = screen.getByRole("complementary", { name: /saved notes/i });
    expect(within(list).getAllByRole("button", { name: /untitled/i })).toHaveLength(2);
  });

  it("asks before deleting, because a note does not come back", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));
    await screen.findByRole("textbox", { name: /note body/i });

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    // Still there: one click is not enough.
    expect(useDashboard.getState().notes).toHaveLength(1);
    expect(screen.getByText(/delete for good\?/i)).toBeInTheDocument();
  });

  it("keeps the note when the second answer is keep", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));
    await screen.findByRole("textbox", { name: /note body/i });

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await user.click(screen.getByRole("button", { name: /^keep$/i }));
    expect(useDashboard.getState().notes).toHaveLength(1);
  });

  it("deletes on the second, deliberate click", async () => {
    const user = userEvent.setup();
    await openNotes(user);
    await user.click(screen.getByRole("button", { name: /new note/i }));
    await screen.findByRole("textbox", { name: /note body/i });

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(useDashboard.getState().notes).toHaveLength(0));
  });
});

describe("todos and reminders", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  async function open(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: label }));
  }

  it("adds a todo", async () => {
    const user = userEvent.setup();
    await open(user, /^Todos/i);
    await user.type(screen.getByRole("textbox", { name: /new todo/i }), "ship it");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(useDashboard.getState().todos[0].text).toBe("ship it"));
  });

  it("will not add an empty todo", async () => {
    const user = userEvent.setup();
    await open(user, /^Todos/i);
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
  });

  it("ticks a todo without removing it", async () => {
    // Done is a record of what you did, not a reason to disappear.
    const user = userEvent.setup();
    await open(user, /^Todos/i);
    await user.type(screen.getByRole("textbox", { name: /new todo/i }), "ship it");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await screen.findByRole("checkbox");

    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(useDashboard.getState().todos[0].done).toBe(true));
    expect(useDashboard.getState().todos).toHaveLength(1);
  });

  it("removes a todo when asked", async () => {
    const user = userEvent.setup();
    await open(user, /^Todos/i);
    await user.type(screen.getByRole("textbox", { name: /new todo/i }), "ship it");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await screen.findByRole("checkbox");

    await user.click(screen.getByRole("button", { name: /remove ship it/i }));
    await waitFor(() => expect(useDashboard.getState().todos).toHaveLength(0));
  });

  it("adds a reminder at a wall-clock time", async () => {
    const user = userEvent.setup();
    await open(user, /^Reminders/i);
    await user.type(screen.getByRole("textbox", { name: /new reminder/i }), "exercise");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const [r] = useDashboard.getState().reminders;
      expect(r.text).toBe("exercise");
      expect(r.at).toMatch(/^\d{2}:\d{2}$/);
    });
  });
});

describe("events", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  async function openEvents(user: ReturnType<typeof userEvent.setup>) {
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /^calendar/i }));
  }

  it("stores a new event as a UTC instant", async () => {
    // The shape the Rust side validates. A local time here would be rejected
    // at the boundary and lost.
    const user = userEvent.setup();
    await openEvents(user);
    await user.type(screen.getByRole("textbox", { name: /event title/i }), "Team meeting");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    await waitFor(() => {
      const [e] = useDashboard.getState().events;
      expect(e.title).toBe("Team meeting");
      expect(e.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  it("carries the chosen alert lead time, needing no setup", async () => {
    const user = userEvent.setup();
    await openEvents(user);
    await user.type(screen.getByRole("textbox", { name: /event title/i }), "Standup");
    await user.selectOptions(screen.getByRole("combobox"), "60");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    await waitFor(() =>
      expect(useDashboard.getState().events[0].alert_minutes_before).toBe(60),
    );
  });

  it("defaults to no alert", async () => {
    const user = userEvent.setup();
    await openEvents(user);
    await user.type(screen.getByRole("textbox", { name: /event title/i }), "Quiet one");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    await waitFor(() =>
      expect(useDashboard.getState().events[0].alert_minutes_before).toBeNull(),
    );
  });
});
