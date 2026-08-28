import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { NotificationTray } from "./NotificationTray";
import { useDashboard } from "../dashboard/dashboardStore";
import { __setPlatformForTests, createWebPlatform } from "../../platform";

function open(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Notifications" }));
}

function dueEventState() {
  const now = new Date();
  const starts = new Date(now.getTime() + 10 * 60_000);
  useDashboard.setState({
    notes: [],
    todos: [],
    reminders: [],
    events: [
      {
        id: "e1",
        title: "Team meeting",
        starts_at: starts.toISOString(),
        colour: "rose",
        alert_minutes_before: 30,
      },
    ],
    loaded: true,
    errors: {},
  });
}

describe("the notification tray", () => {
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

  it("stays shut until asked", () => {
    render(<NotificationTray />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing due when nothing is due", async () => {
    const user = userEvent.setup();
    render(<NotificationTray />);
    await open(user);
    expect(screen.getByText(/nothing needs you/i)).toBeInTheDocument();
  });

  it("carries no badge when nothing is due", () => {
    render(<NotificationTray />);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("shows a due event, with a count badge", async () => {
    dueEventState();
    const user = userEvent.setup();
    render(<NotificationTray />);

    expect(screen.getByText("1")).toBeInTheDocument();
    await open(user);
    expect(screen.getByText("Team meeting")).toBeInTheDocument();
  });

  it("dismisses a notification without touching the underlying event", async () => {
    dueEventState();
    const user = userEvent.setup();
    render(<NotificationTray />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /dismiss "team meeting"/i }));
    expect(screen.getByText(/nothing needs you/i)).toBeInTheDocument();
    // Untouched: dismissing is a tray preference, not a delete.
    expect(useDashboard.getState().events).toHaveLength(1);
  });

  it("remembers a dismissal across remounts", async () => {
    dueEventState();
    const user = userEvent.setup();
    const { unmount } = render(<NotificationTray />);
    await open(user);
    await user.click(screen.getByRole("button", { name: /dismiss "team meeting"/i }));
    unmount();

    render(<NotificationTray />);
    expect(screen.queryByText("1")).toBeNull();
  });

  it("ticking a due reminder off marks it done, not merely dismissed", async () => {
    useDashboard.setState({
      notes: [],
      todos: [],
      events: [],
      loaded: true,
      errors: {},
      reminders: [{ id: "r1", text: "Stretch", at: "00:00", done: false }],
    });
    const user = userEvent.setup();
    render(<NotificationTray />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /mark "stretch" done/i }));
    await waitFor(() =>
      expect(useDashboard.getState().reminders.find((r) => r.id === "r1")?.done).toBe(true),
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<NotificationTray />);
    await open(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <NotificationTray />
        <button type="button">elsewhere</button>
      </div>,
    );
    await open(user);

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("remembers being left open across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NotificationTray />);
    await open(user);
    unmount();

    render(<NotificationTray />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
