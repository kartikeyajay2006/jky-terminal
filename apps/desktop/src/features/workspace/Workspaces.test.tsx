import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspaces } from "./Workspaces";
import { getPlatform, type SavedWorkspace } from "../../platform";
import { useTabs } from "../../app/tabStore";
import { useNav } from "../../app/navStore";

function project(id: string, name: string, extra: Partial<SavedWorkspace> = {}): SavedWorkspace {
  return {
    id,
    name,
    folders: [],
    terminal_dir: null,
    terminals: 0,
    host: null,
    note: "",
    last_used: 0,
    ...extra,
  };
}

async function clean() {
  const api = getPlatform().workspaces;
  const saved = await api.list();
  for (const w of saved.workspaces) await api.forget(w.id);
  await api.leave();

  const files = getPlatform().files;
  for (const folder of await files.folders()) await files.closeFolder(folder.root);
}

describe("the workspaces section", () => {
  beforeEach(async () => {
    await clean();
    useTabs.setState({ tabs: [], activeId: null });
    useNav.setState({ pending: null });
    vi.restoreAllMocks();
  });

  it("says there are none rather than showing an empty table", async () => {
    render(<Workspaces />);
    expect(await screen.findByText(/None yet/)).toBeInTheDocument();
  });

  it("lists what each workspace holds, so one can be picked without opening it", async () => {
    await getPlatform().workspaces.save(
      project("w1", "jky-terminal", {
        folders: ["/tmp/sample"],
        terminals: 2,
        terminal_dir: "/tmp/sample",
        note: "the repo",
      }),
    );
    render(<Workspaces />);

    expect(await screen.findByText("jky-terminal")).toBeInTheDocument();
    expect(screen.getByText("the repo")).toBeInTheDocument();
    expect(screen.getByText("1 folder")).toBeInTheDocument();
    expect(screen.getByText("2 terminals")).toBeInTheDocument();
    expect(screen.getByText("starts in /tmp/sample")).toBeInTheDocument();
  });

  it("creates one, and refuses a name another already has", async () => {
    const user = userEvent.setup();
    render(<Workspaces />);
    await screen.findByText(/None yet/);

    await user.click(screen.getByRole("button", { name: "+ New workspace" }));
    await user.type(screen.getByLabelText("Name"), "work");
    await user.click(screen.getByRole("button", { name: "Save workspace" }));
    expect(await screen.findByText("work")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ New workspace" }));
    await user.type(screen.getByLabelText("Name"), "Work");
    await user.click(screen.getByRole("button", { name: "Save workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already the name");
  });

  it("adds folders to a workspace through the same picker the editor uses", async () => {
    vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
      start: 3,
      end: 3,
      word: "",
      items: [
        { value: "/tmp/sample", display: "/tmp/sample", kind: "directory", detail: "", from: 3 },
      ],
    });
    const user = userEvent.setup();
    render(<Workspaces />);
    await screen.findByText(/None yet/);

    await user.click(screen.getByRole("button", { name: "+ New workspace" }));
    await user.type(screen.getByLabelText("Name"), "work");

    const folderField = screen.getAllByLabelText("Folder")[0];
    await user.type(folderField, "/tmp/sam");

    // Take the suggestion into the field, then add it — the same two steps
    // the editor's picker takes, because it is the same picker.
    await user.click(await screen.findByRole("option", { name: /\/tmp\/sample/ }));
    await user.click(screen.getAllByRole("button", { name: "Add" })[0]);

    expect(
      await screen.findByRole("button", { name: "Remove /tmp/sample" }),
    ).toBeInTheDocument();
  });

  it("starts a workspace from what is open, so naming it is the only step", async () => {
    await getPlatform().files.openFolder("/tmp/sample");
    useTabs.getState().openTab("terminal", "one");
    const user = userEvent.setup();
    render(<Workspaces />);
    await screen.findByText(/None yet/);

    await user.click(screen.getByRole("button", { name: "Save what is open" }));
    expect(await screen.findByText("/tmp/sample")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminals to open")).toHaveValue(1);
  });

  it("switching opens the folders it names and marks it active", async () => {
    await getPlatform().workspaces.save(
      project("w1", "one", { folders: ["/tmp/sample"] }),
    );
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Switch to one" }));

    await waitFor(() => expect(screen.getByText("active")).toBeInTheDocument());
    const folders = await getPlatform().files.folders();
    expect(folders.map((f) => f.root)).toEqual(["/tmp/sample"]);
  });

  it("switching opens the terminals it asks for and lands you in them", async () => {
    // A switch that left you looking at a list of workspaces has only done
    // half of what it said.
    await getPlatform().workspaces.save(project("w1", "one", { terminals: 2 }));
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Switch to one" }));

    await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2));
    expect(useNav.getState().pending?.section).toBe("terminal");
  });

  it("switching replaces the folders the last one had open", async () => {
    await getPlatform().files.openFolder("/tmp/other");
    await getPlatform().workspaces.save(project("w1", "one", { folders: ["/tmp/sample"] }));
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Switch to one" }));

    await waitFor(async () => {
      const folders = await getPlatform().files.folders();
      expect(folders.map((f) => f.root)).toEqual(["/tmp/sample"]);
    });
  });

  it("says which folders were not there, and keeps them in the workspace", async () => {
    // A drive that is unplugged is a folder that comes back.
    await getPlatform().workspaces.save(
      project("w1", "one", { folders: ["/tmp/sample", "/tmp/gone"] }),
    );
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Switch to one" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Not there: /tmp/gone");

    const saved = await getPlatform().workspaces.list();
    expect(saved.workspaces[0].folders).toEqual(["/tmp/sample", "/tmp/gone"]);
  });

  it("leaves a workspace without forgetting it", async () => {
    // Working outside one is an ordinary state, not an error.
    await getPlatform().workspaces.save(project("w1", "one"));
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Switch to one" }));
    await waitFor(() => expect(screen.getByText("active")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Leave one" }));
    await waitFor(() => expect(screen.queryByText("active")).toBeNull());
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("edits a workspace without counting it as using it", async () => {
    await getPlatform().workspaces.save(project("w1", "old name"));
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "new name");
    await user.click(screen.getByRole("button", { name: "Save workspace" }));

    expect(await screen.findByText("new name")).toBeInTheDocument();
  });

  it("forgets a workspace", async () => {
    await getPlatform().workspaces.save(project("w1", "one"));
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(await screen.findByRole("button", { name: "Forget one" }));
    await waitFor(() => expect(screen.queryByText("one")).toBeNull());
  });

  it("reports a failure to read rather than looking empty", async () => {
    vi.spyOn(getPlatform().workspaces, "list").mockRejectedValueOnce(new Error("disk on fire"));
    render(<Workspaces />);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk on fire");
  });
});
