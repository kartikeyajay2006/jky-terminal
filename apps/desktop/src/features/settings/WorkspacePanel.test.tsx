import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "./WorkspacePanel";
import { getPlatform } from "../../platform";

function suggests(...folders: string[]) {
  return vi.spyOn(getPlatform().complete, "suggest").mockResolvedValue({
    start: 3,
    end: 3,
    word: "",
    items: folders.map((value) => ({
      value,
      display: value,
      kind: "directory" as const,
      detail: "",
      from: 3,
    })),
  });
}

describe("choosing the editor's folder", () => {
  beforeEach(async () => {
    await getPlatform().files.openWorkspace("");
    vi.restoreAllMocks();
  });

  it("says nothing is open until one is", async () => {
    render(<WorkspacePanel />);
    expect(await screen.findByText("nothing open")).toBeInTheDocument();
  });

  it("suggests folders as you type, asking the completion engine", async () => {
    // The same engine the terminal uses, asked `cd <what was typed>` — the
    // one command whose arguments are directories and never files. No second
    // way to read the filesystem.
    const suggest = suggests("~/projects/", "~/pictures/");
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "~/p");
    await waitFor(() => expect(screen.getByRole("option", { name: /projects/ })).toBeInTheDocument());
    expect(suggest).toHaveBeenLastCalledWith("cd ~/p", 6, "/", 12);
  });

  it("takes a suggestion into the field without opening it", async () => {
    // A path is usually several steps deep, and opening a parent by accident
    // is the wrong folder entirely.
    suggests("~/projects/");
    const open = vi.spyOn(getPlatform().files, "openWorkspace");
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "~/p");
    await screen.findByRole("option", { name: /projects/ });
    await user.click(screen.getByRole("option", { name: /projects/ }));

    expect(screen.getByLabelText("Folder")).toHaveValue("~/projects/");
    expect(open).not.toHaveBeenCalled();
  });

  it("walks into a folder with Tab rather than submitting", async () => {
    suggests("~/projects/");
    const open = vi.spyOn(getPlatform().files, "openWorkspace");
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "~/p");
    await screen.findByRole("option", { name: /projects/ });
    await user.keyboard("{Tab}");

    expect(screen.getByLabelText("Folder")).toHaveValue("~/projects/");
    expect(open).not.toHaveBeenCalled();
  });

  it("moves through the suggestions with the arrows", async () => {
    suggests("~/projects/", "~/pictures/");
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "~/p");
    await screen.findByRole("option", { name: /projects/ });
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("option", { name: /pictures/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens the folder on Open, and says which one is open", async () => {
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "/tmp/sample");
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("folder open")).toBeInTheDocument();
    expect(screen.getByText("/tmp/sample")).toBeInTheDocument();
  });

  it("reports a refusal rather than storing a folder that cannot be read", async () => {
    vi.spyOn(getPlatform().files, "openWorkspace").mockRejectedValueOnce(
      new Error("could not read `/nope`"),
    );
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "/nope");
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not read");
    expect(screen.getByText("nothing open")).toBeInTheDocument();
  });

  it("closes an open folder again", async () => {
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "/tmp/sample");
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText("folder open");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("nothing open")).toBeInTheDocument();
  });

  it("stays a folder field when the engine cannot answer", async () => {
    vi.spyOn(getPlatform().complete, "suggest").mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(<WorkspacePanel />);

    await user.type(screen.getByLabelText("Folder"), "~/p");
    expect(screen.getByLabelText("Folder")).toHaveValue("~/p");
    expect(screen.queryByRole("option")).toBeNull();
  });
});
