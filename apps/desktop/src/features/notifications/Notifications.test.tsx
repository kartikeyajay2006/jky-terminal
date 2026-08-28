import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications";
import { BANNER_LIFETIME_MS } from "./NotificationBanners";
import { useNotifications } from "./notificationStore";
import { useDashboard } from "../dashboard/dashboardStore";
import { __setPlatformForTests, createWebPlatform } from "../../platform";
import type { Event, Reminder, Todo } from "../../platform";

function open(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Notifications" }));
}

/** The centre, once opened — scoped so banner copy cannot satisfy a query. */
function centre() {
  return screen.getByRole("dialog", { name: "Notifications" });
}

function setStore(over: { events?: Event[]; reminders?: Reminder[]; todos?: Todo[] } = {}) {
  useDashboard.setState({
    notes: [],
    todos: over.todos ?? [],
    events: over.events ?? [],
    reminders: over.reminders ?? [],
    loaded: true,
    errors: {},
  });
}

/** An event whose alert window is open right now. */
function dueEvent(): Event {
  return {
    id: "e1",
    title: "Team meeting",
    starts_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    colour: "rose",
    alert_minutes_before: 30,
  };
}

describe("notifications", () => {
  beforeEach(() => {
    localStorage.clear();
    __setPlatformForTests(createWebPlatform());
    useNotifications.setState({
      open: false,
      dismissed: new Set(),
      seen: new Set(),
      now: new Date(),
    });
    setStore();
  });

  it("keeps the centre shut until asked", () => {
    render(<Notifications />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says you are caught up when nothing is due", async () => {
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);
    expect(within(centre()).getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("carries no badge when nothing is due", () => {
    render(<Notifications />);
    expect(screen.getByRole("button", { name: "Notifications" })).not.toHaveAttribute(
      "data-alert",
    );
  });

  it("counts everything due on the bell", async () => {
    setStore({
      events: [dueEvent()],
      reminders: [{ id: "r1", text: "Stretch", at: "00:00", done: false }],
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    render(<Notifications />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps the badge rather than letting it widen without limit", () => {
    setStore({
      todos: Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`,
        text: `Todo ${i}`,
        done: false,
        created_at: new Date().toISOString(),
      })),
    });
    render(<Notifications />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("shows an open todo, even though it has no time on it", async () => {
    // The behaviour asked for explicitly: a todo that is not done is worth
    // saying so, whether or not anything is scheduled.
    setStore({
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    expect(within(centre()).getByText("Ship it")).toBeInTheDocument();
    expect(within(centre()).getByText(/still open/i)).toBeInTheDocument();
  });

  it("leaves a completed todo out", async () => {
    setStore({
      todos: [{ id: "t1", text: "Done already", done: true, created_at: new Date().toISOString() }],
    });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);
    expect(within(centre()).queryByText("Done already")).toBeNull();
  });

  it("groups what is due by kind", async () => {
    setStore({
      events: [dueEvent()],
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    expect(within(centre()).getByText(/happening soon/i)).toBeInTheDocument();
    expect(within(centre()).getByText(/still open/i)).toBeInTheDocument();
  });

  it("dismisses one notification without touching what it is about", async () => {
    setStore({ events: [dueEvent()] });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    await user.click(
      within(centre()).getByRole("button", { name: /dismiss "team meeting"/i }),
    );
    expect(within(centre()).getByText(/all caught up/i)).toBeInTheDocument();
    // Untouched: dismissing is a tray preference, not a delete.
    expect(useDashboard.getState().events).toHaveLength(1);
  });

  it("clears everything at once", async () => {
    setStore({
      events: [dueEvent()],
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    await user.click(within(centre()).getByRole("button", { name: /clear all/i }));
    expect(within(centre()).getByText(/all caught up/i)).toBeInTheDocument();
    expect(useDashboard.getState().events).toHaveLength(1);
    expect(useDashboard.getState().todos).toHaveLength(1);
  });

  it("remembers a dismissal across remounts", async () => {
    setStore({ events: [dueEvent()] });
    const user = userEvent.setup();
    const { unmount } = render(<Notifications />);
    await open(user);
    await user.click(
      within(centre()).getByRole("button", { name: /dismiss "team meeting"/i }),
    );
    unmount();

    useNotifications.setState({ seen: new Set() });
    render(<Notifications />);
    expect(screen.getByRole("button", { name: "Notifications" })).not.toHaveAttribute(
      "data-alert",
    );
  });

  it("ticking a due reminder off completes it, rather than merely hiding it", async () => {
    setStore({ reminders: [{ id: "r1", text: "Stretch", at: "00:00", done: false }] });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    await user.click(within(centre()).getByRole("button", { name: /mark "stretch" done/i }));
    await waitFor(() =>
      expect(useDashboard.getState().reminders.find((r) => r.id === "r1")?.done).toBe(true),
    );
  });

  it("ticking a todo off completes it too", async () => {
    setStore({
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    await user.click(within(centre()).getByRole("button", { name: /mark "ship it" done/i }));
    await waitFor(() =>
      expect(useDashboard.getState().todos.find((t) => t.id === "t1")?.done).toBe(true),
    );
  });

  it("offers no tick on an event, which is not a thing you complete", async () => {
    setStore({ events: [dueEvent()] });
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    expect(
      within(centre()).queryByRole("button", { name: /mark "team meeting" done/i }),
    ).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Notifications />);
    await open(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Notifications />
        <button type="button">elsewhere</button>
      </div>,
    );
    await open(user);

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("remembers being left open across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Notifications />);
    await open(user);
    unmount();

    render(<Notifications />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("heads-up banners", () => {
  beforeEach(() => {
    localStorage.clear();
    __setPlatformForTests(createWebPlatform());
    useNotifications.setState({
      open: false,
      dismissed: new Set(),
      seen: new Set(),
      now: new Date(),
    });
    setStore();
  });

  it("pops up on its own when something is due, without opening the centre", () => {
    setStore({ events: [dueEvent()] });
    render(<Notifications />);

    const banners = screen.getByRole("status", { name: /new notifications/i });
    expect(within(banners).getByText("Team meeting")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gets out of the way on its own, leaving the row in the centre", async () => {
    vi.useFakeTimers();
    try {
      setStore({ events: [dueEvent()] });
      render(<Notifications />);
      expect(screen.getByRole("status", { name: /new notifications/i })).toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(BANNER_LIFETIME_MS + 100));

      expect(screen.queryByRole("status", { name: /new notifications/i })).toBeNull();
      // Still counted — retiring the banner is not dismissing the item.
      expect(screen.getByText("1")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never raises a banner for a todo, which has no moment to interrupt for", () => {
    setStore({
      todos: [{ id: "t1", text: "Ship it", done: false, created_at: new Date().toISOString() }],
    });
    render(<Notifications />);
    expect(screen.queryByRole("status", { name: /new notifications/i })).toBeNull();
  });

  it("shows at most three at once", () => {
    setStore({
      reminders: Array.from({ length: 6 }, (_, i) => ({
        id: `r${i}`,
        text: `Reminder ${i}`,
        at: "00:00",
        done: false,
      })),
    });
    render(<Notifications />);

    const banners = screen.getByRole("status", { name: /new notifications/i });
    expect(within(banners).getAllByRole("button", { name: /^dismiss/i })).toHaveLength(3);
  });

  it("dismissing a banner takes the row out of the centre too", async () => {
    setStore({ events: [dueEvent()] });
    const user = userEvent.setup();
    render(<Notifications />);

    const banners = screen.getByRole("status", { name: /new notifications/i });
    await user.click(within(banners).getByRole("button", { name: /dismiss "team meeting"/i }));

    await open(user);
    expect(within(centre()).getByText(/all caught up/i)).toBeInTheDocument();
  });
});
