import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dashboard, SECTIONS } from "./Dashboard";
import { useDashboard } from "./dashboardStore";
import { __setPlatformForTests, createWebPlatform } from "../../platform";

function reset() {
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
    for (const label of [
      "Notes",
      "Todos",
      "Calendar",
      "Upcoming Events",
      "Reminders",
      "Mail Alerts",
    ]) {
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
    await user.click(within(nav).getByRole("button", { name: /upcoming events/i }));
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

  it("carries the chosen alert lead time", async () => {
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

describe("mail alerts", () => {
  beforeEach(reset);
  afterEach(() => __setPlatformForTests(null));

  it("says plainly that delivery is not built yet", async () => {
    // Promising a feature that does nothing is worse than saying where the
    // work has got to.
    const user = userEvent.setup();
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /mail alerts/i }));

    expect(screen.getByText(/not built yet/i)).toBeInTheDocument();
  });

  it("does not claim it works with the computer off", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /mail alerts/i }));

    expect(screen.getByText(/while your computer is off/i)).toBeInTheDocument();
  });
});
