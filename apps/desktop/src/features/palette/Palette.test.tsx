import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Palette } from "./Palette";
import { buildCommands, searchText } from "./commands";
import { useNav } from "../../app/navStore";
import { useTabs } from "../../app/tabStore";
import { useOpenGame } from "../games/openStore";
import { THEMES } from "../../app/theme";
import { __setPlatformForTests, createWebPlatform } from "../../platform";
import { useDashboard } from "../dashboard/dashboardStore";

function rows() {
  return screen.getAllByRole("option");
}

describe("the command registry", () => {
  it("reaches every rail destination", () => {
    const labels = buildCommands().map((c) => c.label);
    for (const section of ["Dashboard", "Terminal", "Assistant", "Games", "Settings"]) {
      expect(labels).toContain(section);
    }
  });

  it("reaches every dashboard panel", () => {
    const labels = buildCommands().map((c) => c.label);
    for (const panel of ["Overview", "Notes", "Todos", "Calendar", "Reminders"]) {
      expect(labels).toContain(`Dashboard · ${panel}`);
    }
  });

  it("reaches every settings panel", () => {
    const labels = buildCommands().map((c) => c.label);
    for (const panel of ["Appearance", "Providers", "Commands"]) {
      expect(labels).toContain(`Settings · ${panel}`);
    }
  });

  it("offers every game and the arcade", () => {
    const labels = buildCommands().map((c) => c.label);
    expect(labels).toContain("Arcade");
    for (const game of ["Dino Run", "Snake", "Tic Tac Toe", "Flappy Bird"]) {
      expect(labels).toContain(`Play ${game}`);
    }
  });

  it("offers every theme, so none is reachable only by mouse", () => {
    const labels = buildCommands().map((c) => c.label);
    for (const theme of THEMES) {
      expect(labels).toContain(`Theme · ${theme.label}`);
    }
  });

  it("gives every command a unique id", () => {
    // Two rows sharing a key would make React reuse the wrong one.
    const ids = buildCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches against the group as well as the label", () => {
    const command = buildCommands().find((c) => c.label === "Snake" || c.label === "Play Snake");
    expect(command && searchText(command)).toContain("Games");
  });
});

describe("the palette", () => {
  beforeEach(() => {
    useNav.setState({ pending: null });
    useOpenGame.setState({ pending: null });
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("opens focused, so a shortcut does not need a click after it", () => {
    render(<Palette onClose={() => {}} />);
    expect(screen.getByLabelText(/search commands/i)).toHaveFocus();
  });

  it("lists everything before anything is typed", () => {
    render(<Palette onClose={() => {}} />);
    expect(rows().length).toBeGreaterThan(10);
  });

  it("narrows as you type", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);
    const before = rows().length;

    await user.type(screen.getByLabelText(/search commands/i), "snake");
    expect(rows().length).toBeLessThan(before);
    expect(rows()[0]).toHaveTextContent(/snake/i);
  });

  it("finds a panel from its initials", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);
    await user.type(screen.getByLabelText(/search commands/i), "dscal");
    expect(rows()[0]).toHaveTextContent(/Dashboard · Calendar/);
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);
    await user.type(screen.getByLabelText(/search commands/i), "zzzzzz");
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it("highlights the first row to begin with", () => {
    render(<Palette onClose={() => {}} />);
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("moves down and up with the arrows", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.keyboard("{ArrowDown}");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around rather than sticking at the ends", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.keyboard("{ArrowUp}");
    const last = rows().length - 1;
    expect(rows()[last]).toHaveAttribute("aria-selected", "true");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Palette onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a click outside", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Palette onClose={onClose} />);

    await user.click(container.querySelector(".pal__backdrop")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open on a click inside", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Palette onClose={onClose} />);

    await user.click(screen.getByLabelText(/search commands/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("runs the highlighted command on Enter, and closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText(/search commands/i), "dashboard");
    await user.keyboard("{Enter}");

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(useNav.getState().pending?.section).toBe("dashboard"));
  });

  it("runs a command when its row is clicked", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.type(screen.getByLabelText(/search commands/i), "settings prov");
    await user.click(rows()[0]);

    await waitFor(() => {
      expect(useNav.getState().pending).toEqual({
        section: "settings",
        panel: "providers",
      });
    });
  });

  it("opens a game through the same path the shell command uses", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.type(screen.getByLabelText(/search commands/i), "play flappy");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(useOpenGame.getState().pending).toBe("flappy"));
  });

  it("opens a terminal tab", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.type(screen.getByLabelText(/search commands/i), "new terminal");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(1));
  });

  it("changes the theme", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);

    await user.type(screen.getByLabelText(/search commands/i), "theme nord");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("nord"),
    );
  });

  it("marks the letters that matched, so it is clear why a row is there", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);
    await user.type(screen.getByLabelText(/search commands/i), "snk");

    const marked = within(rows()[0]).getAllByText(/[snk]/i, { selector: "[data-hit]" });
    expect(marked.length).toBeGreaterThan(0);
  });

  it("shows the shortcut for a command that has one", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={() => {}} />);
    await user.type(screen.getByLabelText(/search commands/i), "new terminal");
    expect(within(rows()[0]).getByText("Ctrl+T")).toBeInTheDocument();
  });
});

describe("commands that need a line of text", () => {
  beforeEach(() => {
    localStorage.clear();
    __setPlatformForTests(createWebPlatform());
    useDashboard.setState({
      notes: [],
      todos: [],
      events: [],
      reminders: [],
      loaded: true,
      errors: {},
    });
  });

  afterEach(() => {
    __setPlatformForTests(null);
    localStorage.clear();
  });

  it("offers to create each kind of thing", () => {
    const labels = buildCommands().map((c) => c.label);
    expect(labels).toContain("New note…");
    expect(labels).toContain("New todo…");
    expect(labels).toContain("New reminder…");
  });

  it("asks for the text instead of running straight away", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText("Search commands"), "new note");
    await user.keyboard("{Enter}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title of the note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search commands")).not.toBeInTheDocument();
  });

  it("writes what was typed, through the same verb the shell sends", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText("Search commands"), "new note");
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Title of the note"), "Shopping list");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(useDashboard.getState().notes[0]?.title).toBe("Shopping list");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open and says why when the answer is not usable", async () => {
    // A mistyped reminder time is the one failure a person can reach from
    // here. Closing would take the message with it and it would look as
    // though nothing had happened.
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText("Search commands"), "new reminder");
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("07:00 Go for a run"), "7pm Run");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("HH:MM");
    expect(onClose).not.toHaveBeenCalled();
    expect(useDashboard.getState().reminders).toHaveLength(0);
  });

  it("clears the complaint as soon as the answer is edited", async () => {
    const user = userEvent.setup();
    render(<Palette onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Search commands"), "new reminder");
    await user.keyboard("{Enter}");
    const box = screen.getByLabelText("07:00 Go for a run");
    await user.type(box, "7pm Run");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.type(box, "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does nothing on an empty answer", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText("Search commands"), "new note");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(onClose).not.toHaveBeenCalled();
    expect(useDashboard.getState().notes).toHaveLength(0);
  });

  it("goes back to the list on escape rather than closing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);

    await user.type(screen.getByLabelText("Search commands"), "new note");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search commands")).toBeInTheDocument();
  });

  it("offers to tick each existing todo, and to untick a ticked one", async () => {
    await useDashboard.getState().saveTodo({
      id: "t1",
      text: "Buy milk",
      done: false,
      created_at: "2026-08-28T09:00:00Z",
    });
    expect(buildCommands().map((c) => c.label)).toContain("Tick · Buy milk");

    await useDashboard.getState().saveTodo({
      id: "t1",
      text: "Buy milk",
      done: true,
      created_at: "2026-08-28T09:00:00Z",
    });
    expect(buildCommands().map((c) => c.label)).toContain("Untick · Buy milk");
  });

  it("numbers reminders the way the listing does", async () => {
    // The row binds a handle at build time. If it bound the array position
    // instead of the listing position, ticking one row would tick another.
    const store = useDashboard.getState();
    await store.saveReminder({ id: "r1", at: "18:00", text: "Evening", done: false });
    await store.saveReminder({ id: "r2", at: "07:00", text: "Morning", done: false });

    const tick = buildCommands().find((c) => c.label.includes("Morning"));
    tick?.run?.();

    await waitFor(() => {
      const after = useDashboard.getState().reminders;
      expect(after.find((r) => r.id === "r2")?.done).toBe(true);
      expect(after.find((r) => r.id === "r1")?.done).toBe(false);
    });
  });

  it("does not offer to delete anything", () => {
    // Deleting from a fuzzy list on one Enter is too close to an accident.
    // It stays in the Dashboard, which asks first, and in the shell, where
    // you type `rm` and a number.
    const labels = buildCommands().map((c) => c.label.toLowerCase());
    expect(labels.some((l) => l.startsWith("delete"))).toBe(false);
  });
});
