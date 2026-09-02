import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CommandApp } from "./CommandApp";
import type { Recognised } from "./recognise";

const TABLE: Recognised = {
  kind: "docker-ps",
  title: "Containers",
  subtitle: "2 of 3 running",
  view: {
    kind: "table",
    columns: [
      { key: "name", label: "Container", mono: true },
      { key: "status", label: "Status" },
      { key: "image", label: "Image", secondary: true },
    ],
    rows: [
      { id: "a", tone: "good", cells: { name: "postgres", status: "Up 2 hours", image: "postgres:16" } },
      { id: "b", tone: "bad", cells: { name: "api", status: "Exited (137)", image: "me/api" } },
    ],
  },
  actions: [{ key: "a", label: "Include stopped", command: "docker ps -a" }],
};

const show = (
  found: Recognised,
  onRun: (command: string) => void = () => {},
  onDismiss: () => void = () => {},
) =>
  render(<CommandApp found={found} onRun={onRun} onDismiss={onDismiss} />);

describe("CommandApp", () => {
  it("names what it recognised", () => {
    show(TABLE);
    const panel = screen.getByRole("group", { name: /containers/i });
    expect(panel).toHaveTextContent("2 of 3 running");
  });

  it("draws a table with its columns and rows", () => {
    show(TABLE);
    const table = screen.getByRole("table", { name: /containers/i });
    expect(within(table).getByText("postgres")).toBeInTheDocument();
    expect(within(table).getByText("Exited (137)")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  /*
   * Every action types a command; nothing here runs anything.
   *
   * A panel that could quietly `docker stop` would be one you had to trust.
   * This one only has to be read — what it does is exactly what you would
   * have typed, and you still press Enter.
   */
  it("types a command rather than running one", async () => {
    const typed: string[] = [];
    const user = userEvent.setup();
    show(TABLE, (command) => typed.push(command));

    await user.click(screen.getByRole("button", { name: /include stopped/i }));
    expect(typed).toEqual(["docker ps -a"]);
  });

  it("takes the key shown beside an action", async () => {
    const typed: string[] = [];
    const user = userEvent.setup();
    show(TABLE, (command) => typed.push(command));

    await user.keyboard("a");
    expect(typed).toEqual(["docker ps -a"]);
  });

  it("goes away when dismissed, by button or by Escape", async () => {
    let dismissed = 0;
    const user = userEvent.setup();
    show(TABLE, () => {}, () => { dismissed += 1; });

    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));
    expect(dismissed).toBe(1);
    await user.keyboard("{Escape}");
    expect(dismissed).toBe(2);
  });

  // Colour says "running" and "stopped"; a screen reader needs the word.
  it("marks a row's state in text, not only in colour", () => {
    const { container } = show(TABLE);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].getAttribute("data-tone")).toBe("good");
    expect(within(rows[0] as HTMLElement).getByText("Up 2 hours")).toBeInTheDocument();
  });

  it("draws meters as proportions", () => {
    show({
      kind: "df",
      title: "Disks",
      view: {
        kind: "meters",
        meters: [
          { label: "/", used: 90, total: 100, usedText: "175G", totalText: "199G", note: "/dev/a" },
        ],
      },
    });
    const panel = screen.getByRole("group", { name: /disks/i });
    expect(panel).toHaveTextContent("/");
    expect(panel).toHaveTextContent("175G");
    expect(panel).toHaveTextContent("90%");
  });

  it("draws a timeline", () => {
    show({
      kind: "git-log",
      title: "History",
      view: {
        kind: "timeline",
        entries: [{ id: "abc", title: "fix: a thing", meta: ["abc1234", "Ada"], body: "why" }],
      },
    });
    const panel = screen.getByRole("group", { name: /history/i });
    expect(panel).toHaveTextContent("fix: a thing");
    expect(panel).toHaveTextContent("abc1234");
  });

  it("draws facts", () => {
    show({
      kind: "file-action",
      title: "Created project_name",
      view: { kind: "facts", facts: [{ label: "In", value: "/home/me" }] },
    });
    const panel = screen.getByRole("group", { name: /created project_name/i });
    expect(panel).toHaveTextContent("/home/me");
  });

  it("draws JSON as text, never as markup", () => {
    const { container } = show({
      kind: "json",
      title: "JSON",
      view: { kind: "json", text: '{\n  "a": "<img src=x onerror=alert(1)>"\n}' },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  // A panel with no actions must not draw an empty row of buttons.
  it("shows no action bar when there is nothing to do", () => {
    show({ kind: "json", title: "JSON", view: { kind: "json", text: "{}" } });
    const panel = screen.getByRole("group", { name: /json/i });
    expect(within(panel).getAllByRole("button")).toHaveLength(1); // dismiss only
  });
});
