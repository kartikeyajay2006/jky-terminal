import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { TabBar } from "./TabBar";
import { useTabs } from "./tabStore";
import { applyTheme, THEMES } from "./theme";
import { createWebPlatform, __setPlatformForTests } from "../platform";
import { ProviderVault } from "../features/settings/ProviderVault";
import { Settings } from "../features/settings/Settings";
import { Assistant } from "../features/assistant/Assistant";
import { Dashboard } from "../features/dashboard/Dashboard";
import { SECTIONS } from "../features/dashboard/Dashboard";
import { useDashboard } from "../features/dashboard/dashboardStore";
import { ConversationHeader } from "../features/assistant/ConversationHeader";
import { SessionList } from "../features/assistant/SessionList";
import { Welcome } from "../features/assistant/Welcome";
import { useChat } from "./chatStore";
import { ToolCard } from "../features/assistant/ToolCard";

describe("accessibility", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    useTabs.setState({ tabs: [], activeId: null });
    useChat.setState({ sessions: [], activeId: null, busy: false, tools: [], error: null });
    useDashboard.setState({
      notes: [],
      todos: [],
      events: [],
      reminders: [],
      loaded: false,
      errors: {},
    });
  });
  afterEach(() => {
    __setPlatformForTests(null);
    document.documentElement.removeAttribute("data-theme");
  });

  // Every theme redefines colour tokens, so the markup is checked under each.
  // Checking only the default would leave five palettes shipping unexamined.
  for (const theme of THEMES) {
    it(`the shell has no violations in ${theme.label}`, async () => {
      applyTheme(theme.id);
      useTabs.getState().openTab("terminal", "Terminal 1");
      const { container } = render(
        <Shell>
          <TabBar />
        </Shell>,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("the provider vault has no violations", async () => {
    const { container } = render(<ProviderVault />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an expanded provider row has no violations", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = render(<ProviderVault />);
    await user.click(await findByRole("button", { name: /Anthropic/ }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the settings screen has no violations", async () => {
    const { container } = render(<Settings />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the assistant panel has no violations", async () => {
    const { container } = render(<Assistant />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the assistant's empty state has no violations", async () => {
    const { container } = render(<Welcome onPick={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the conversation header has no violations", async () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "a question");
    const { container } = render(<ConversationHeader />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the session list has no violations", async () => {
    useChat.getState().newSession();
    useChat.getState().addTurn("user", "a question");
    const { container } = render(<SessionList />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a tool approval card has no violations", async () => {
    // The card is the one place a wrong decision is expensive, so its
    // controls must be reachable and labelled for everyone.
    const { container } = render(
      <ToolCard
        request={{
          id: "toolu_1",
          name: "run_command",
          command: "rm -rf build",
          reason: "Clear stale artifacts",
          destructive: true,
        }}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  // Every dashboard panel, not just the one it opens on. Six panels behind a
  // single check would be five shipping unexamined.
  for (const section of SECTIONS) {
    it(`the dashboard's ${section.label} panel has no violations`, async () => {
      const user = userEvent.setup();
      const { container } = render(<Dashboard />);
      // Scoped to the nav: Quick Actions on the overview offers buttons with
      // the same names.
      const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
      await user.click(
        within(nav).getByRole("button", { name: new RegExp(section.label, "i") }),
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("a note open in the editor has no violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /^Notes/i }));
    await user.click(screen.getByRole("button", { name: /new note/i }));
    await screen.findByRole("textbox", { name: /note body/i });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the dashboard with content in it has no violations", async () => {
    // An empty panel exercises none of the rows, dots or checkboxes.
    useDashboard.setState({
      notes: [
        {
          id: "n1",
          title: "Plan",
          body: "line",
          created_at: "2026-08-27T00:00:00Z",
          updated_at: "2026-08-27T00:00:00Z",
        },
      ],
      todos: [{ id: "t1", text: "ship", done: false, created_at: "2026-08-27T00:00:00Z" }],
      events: [
        {
          id: "e1",
          title: "Team meeting",
          starts_at: "2099-08-27T10:00:00Z",
          colour: "rose",
          alert_minutes_before: 30,
        },
      ],
      reminders: [{ id: "r1", text: "Exercise", at: "07:00", done: false }],
      loaded: true,
      errors: {},
    });
    const { container } = render(<Dashboard />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an open date picker has no violations", async () => {
    // A calendar popover is a grid of forty-two buttons; getting its roles
    // and labels wrong would be easy and invisible.
    const user = userEvent.setup();
    const { container } = render(<Dashboard />);
    const nav = screen.getByRole("navigation", { name: /dashboard sections/i });
    await user.click(within(nav).getByRole("button", { name: /upcoming events/i }));
    await user.click(screen.getByRole("button", { name: "Event date" }));

    expect(await axe(container)).toHaveNoViolations();
  });

  it("an open dropdown has no violations", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = render(<Shell>{null}</Shell>);
    await user.click(await findByRole("combobox", { name: /theme/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
