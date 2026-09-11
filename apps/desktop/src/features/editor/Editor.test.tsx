import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor";
import { getPlatform } from "../../platform";
import { useEditor } from "./editorStore";

/*
 * CodeMirror draws into a real contenteditable and measures it, which jsdom
 * has no layout engine for. What this component is responsible for — opening
 * the right folder, the right file, knowing which are unsaved, saving the
 * right one — is all around the editor rather than inside it, so a textarea
 * stands in.
 */
vi.mock("./CodeMirror", () => ({
  CodeMirror: ({
    path,
    initial,
    onChange,
    onSave,
  }: {
    path: string;
    initial: string;
    onChange: (t: string) => void;
    onSave: () => void;
  }) => (
    <div>
      <textarea
        aria-label={`Editing ${path}`}
        defaultValue={initial}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={onSave}>
        Save {path}
      </button>
    </div>
  ),
}));

async function closeEverything() {
  const files = getPlatform().files;
  for (const folder of await files.folders()) await files.closeFolder(folder.root);
  // Open files outlive the component now — that is the point of them being in
  // a store — so a test has to put them back as well as the folders.
  useEditor.setState({ open: [], active: null, error: null });
}

const openSample = () => getPlatform().files.openFolder("/tmp/sample");

/** Type into the picker and press its button. */
async function pickFolder(user: ReturnType<typeof userEvent.setup>, dir: string) {
  const field = screen.getAllByLabelText("Folder")[0];
  await user.clear(field);
  await user.type(field, dir);
  await user.click(screen.getAllByRole("button", { name: /^(Open folder|Add)$/ })[0]);
}

describe("the editor", () => {
  beforeEach(async () => {
    await closeEverything();
    vi.restoreAllMocks();
  });

  it("can reach nothing until a folder is opened, and offers to open one", async () => {
    render(<Editor />);
    expect(await screen.findByText("nothing open")).toBeInTheDocument();
    // Opened here rather than in Settings: choosing what to work on is the
    // work, and a round trip for one field is not.
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();
  });

  it("opens a folder without leaving the section", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByText("nothing open");

    await pickFolder(user, "/tmp/sample");
    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
  });

  it("says why a folder was refused, and opens nothing", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByText("nothing open");

    await pickFolder(user, "/definitely/not/here");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not read");
    expect(screen.getByText("nothing open")).toBeInTheDocument();
  });

  it("holds several folders at once, each with its own tree", async () => {
    await openSample();
    await getPlatform().files.openFolder("/tmp/other");
    render(<Editor />);

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("closes one folder and leaves the other open", async () => {
    await openSample();
    await getPlatform().files.openFolder("/tmp/other");
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /README\.md/ });

    await user.click(screen.getByRole("button", { name: "Close folder sample" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /README\.md/ })).toBeNull());
    expect(screen.getByRole("button", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("closing a folder closes the files that came from it", async () => {
    // They cannot be saved any more, and a tab that fails on save would be
    // worse than one that closed.
    await openSample();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await screen.findByLabelText("Editing README.md");

    await user.click(screen.getByRole("button", { name: "Close folder sample" }));
    await waitFor(() => expect(screen.queryByLabelText("Editing README.md")).toBeNull());
  });

  it("opens several files, from more than one folder", async () => {
    await openSample();
    await getPlatform().files.openFolder("/tmp/other");
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.click(screen.getByRole("button", { name: /notes\.txt/ }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("expands a directory rather than opening it", async () => {
    await openSample();
    const user = userEvent.setup();
    render(<Editor />);

    const dir = await screen.findByRole("button", { name: /src/ });
    expect(dir).toHaveAttribute("aria-expanded", "false");
    await user.click(dir);

    await waitFor(() => expect(dir).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("button", { name: /main\.ts/ })).toBeInTheDocument();
  });

  it("marks a file with unsaved changes, and clears it on save", async () => {
    await openSample();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.type(await screen.findByLabelText("Editing README.md"), "!");
    expect(await screen.findByLabelText("unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save README.md" }));
    await waitFor(() => expect(screen.queryByLabelText("unsaved changes")).toBeNull());
  });

  it("writes what is on screen to the file that was open", async () => {
    await openSample();
    const write = vi.spyOn(getPlatform().files, "write");
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.clear(await screen.findByLabelText("Editing README.md"));
    await user.type(screen.getByLabelText("Editing README.md"), "new text");
    await user.click(screen.getByRole("button", { name: "Save README.md" }));

    expect(write).toHaveBeenCalledWith("/tmp/sample", "README.md", "new text");
  });

  it("closes a file with no changes without asking", async () => {
    await openSample();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.click(screen.getAllByRole("tab")[0].querySelector("[data-close]")!);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  });
});

describe("closing a file with changes in it", () => {
  beforeEach(async () => {
    await closeEverything();
    await openSample();
    vi.restoreAllMocks();
  });

  /** Open README, change it, and press its close glyph. */
  async function tryToClose(user: ReturnType<typeof userEvent.setup>) {
    render(<Editor />);
    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.type(await screen.findByLabelText("Editing README.md"), "!");
    await user.click(screen.getAllByRole("tab")[0].querySelector("[data-close]")!);
    return screen.findByRole("alertdialog");
  }

  it("asks rather than discarding silently", async () => {
    const user = userEvent.setup();
    const dialog = await tryToClose(user);
    expect(dialog).toHaveTextContent("Save changes to README.md?");
  });

  it("saves and then closes when asked to save", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(getPlatform().files, "write");
    await tryToClose(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(write).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  });

  it("closes without writing when asked to discard", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(getPlatform().files, "write");
    await tryToClose(user);

    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps the file and its changes when cancelled", async () => {
    const user = userEvent.setup();
    await tryToClose(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });

  it("treats Escape as cancel, so a stray keystroke loses nothing", async () => {
    const user = userEvent.setup();
    await tryToClose(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });

  it("keeps the file open when the save it was asked for failed", async () => {
    // Closing anyway would be discarding under another name.
    const user = userEvent.setup();
    vi.spyOn(getPlatform().files, "write").mockRejectedValueOnce(new Error("read-only"));
    await tryToClose(user);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("read-only");
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });
});

describe("making, renaming and removing", () => {
  beforeEach(async () => {
    await closeEverything();
    await openSample();
    vi.restoreAllMocks();
  });

  /**
   * Right-click a tree entry and pick something from the menu.
   *
   * Scoped to the tree: the open-file tabs and the stand-in editor's own
   * Save button both carry the file's name too.
   */
  async function menu(user: ReturnType<typeof userEvent.setup>, entry: RegExp, item: string) {
    const tree = within(screen.getByLabelText("Files"));
    fireEvent.contextMenu(await tree.findByRole("button", { name: entry }));
    // The menu's rows are menuitems, not buttons — it is the same component
    // the terminal's right-click menu uses.
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${item}`) }));
  }

  it("makes a new file and opens it, because that is why you made it", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /README\.md/ });

    await user.click(screen.getByRole("button", { name: "New file in sample" }));
    await user.type(screen.getByLabelText("new file"), "notes.md{Enter}");

    expect(await screen.findByLabelText("Editing notes.md")).toBeInTheDocument();
  });

  it("makes a new folder without opening anything", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /README\.md/ });

    await user.click(screen.getByRole("button", { name: "New folder in sample" }));
    await user.type(screen.getByLabelText("new folder"), "docs{Enter}");

    expect(await screen.findByRole("button", { name: /docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("refuses a name that is already taken rather than erasing it", async () => {
    // "New file" and "erase this file" are different requests.
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /README\.md/ });

    await user.click(screen.getByRole("button", { name: "New file in sample" }));
    await user.type(screen.getByLabelText("new file"), "README.md{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("already there");
    // Still there, and still whatever it was — refusing is the whole point.
    const before = await getPlatform().files.read("/tmp/sample", "README.md");
    expect(before.length).toBeGreaterThan(0);
  });

  it("abandons a name on Escape", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /README\.md/ });

    await user.click(screen.getByRole("button", { name: "New file in sample" }));
    await user.type(screen.getByLabelText("new file"), "gone.md{Escape}");

    expect(screen.queryByLabelText("new file")).toBeNull();
    await expect(getPlatform().files.read("/tmp/sample", "gone.md")).rejects.toThrow();
  });

  it("renames a file, and the tab follows it", async () => {
    // On a file this test made: the in-memory tree the browser build keeps is
    // shared, and a test that renamed a fixture would break the next one.
    await getPlatform().files.create("/tmp/sample", "before.md", false);
    const user = userEvent.setup();
    render(<Editor />);

    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /before\.md/ }));
    await screen.findByLabelText("Editing before.md");

    await menu(user, /before\.md/, "Rename");
    await user.clear(screen.getByLabelText("name"));
    await user.type(screen.getByLabelText("name"), "after.md{Enter}");

    expect(await screen.findByLabelText("Editing after.md")).toBeInTheDocument();
  });

  it("deletes a file and closes the tab it was in", async () => {
    await getPlatform().files.create("/tmp/sample", "doomed.md", false);
    const user = userEvent.setup();
    render(<Editor />);

    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /doomed\.md/ }));
    await screen.findByLabelText("Editing doomed.md");

    await menu(user, /doomed\.md/, "Delete");
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    await expect(getPlatform().files.read("/tmp/sample", "doomed.md")).rejects.toThrow();
  });

  it("says a directory with something in it cannot be deleted", async () => {
    // No undo and no wastebasket, so a tree does not go on one click.
    await getPlatform().files.create("/tmp/sample", "full/thing.txt", false);
    const user = userEvent.setup();
    render(<Editor />);
    await screen.findByRole("button", { name: /full/ });

    await menu(user, /full/, "Delete");
    expect(await screen.findByRole("alert")).toHaveTextContent("not empty");
  });
});

describe("files that cannot be edited", () => {
  beforeEach(async () => {
    await closeEverything();
    await openSample();
    vi.restoreAllMocks();
  });

  /** A file the browser tree holds but the editor cannot read as text. */
  async function addBinary(path: string) {
    // The browser build keeps one tree for the whole file, so a second test
    // asking for the same name finds it already there — which is fine.
    await getPlatform().files.create("/tmp/sample", path, false).catch(() => {});
    vi.spyOn(getPlatform().files, "read").mockRejectedValue(
      new Error(`\`${path}\` is not a file this editor can open`),
    );
  }

  it("opens a picture instead of refusing it", async () => {
    // Refusing left an error and an empty pane: no picture, and no
    // explanation either.
    await addBinary("shot.png");
    vi.spyOn(getPlatform().files, "preview").mockResolvedValue({
      kind: "image",
      mime: "image/png",
      size: 2048,
      data: "iVBORw0KGgo=",
    });

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /shot\.png/ }));

    const image = await screen.findByRole("img", { name: "shot.png" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("says plainly that it cannot be edited", async () => {
    await addBinary("shot.png");
    vi.spyOn(getPlatform().files, "preview").mockResolvedValue({
      kind: "image",
      mime: "image/png",
      size: 2048,
      data: "iVBORw0KGgo=",
    });

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /shot\.png/ }));

    expect(await screen.findByText(/cannot be edited here/)).toBeInTheDocument();
    // And no editor is offered for it.
    expect(screen.queryByLabelText("Editing shot.png")).toBeNull();
  });

  it("opens a PDF as a card that says why it is not drawn", async () => {
    await addBinary("scan.pdf");
    vi.spyOn(getPlatform().files, "preview").mockResolvedValue({
      kind: "pdf",
      mime: "application/pdf",
      size: 120_000,
      data: null,
      note: "PDFs cannot be shown in this window yet",
    });

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /scan\.pdf/ }));

    expect(await screen.findByText("PDFs cannot be shown in this window yet")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    // Still a tab, still open — that is the whole point.
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("marks the tab read-only, where the unsaved dot would be", async () => {
    // The two can never both apply: a file that cannot change is never
    // unsaved.
    await addBinary("shot.png");
    vi.spyOn(getPlatform().files, "preview").mockResolvedValue({
      kind: "image",
      mime: "image/png",
      size: 10,
      data: "iVBORw0KGgo=",
    });

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /shot\.png/ }));

    expect(await screen.findByLabelText("read-only")).toBeInTheDocument();
    expect(screen.queryByLabelText("unsaved changes")).toBeNull();
  });

  it("closes without asking, because there is nothing to lose", async () => {
    await addBinary("shot.png");
    vi.spyOn(getPlatform().files, "preview").mockResolvedValue({
      kind: "image",
      mime: "image/png",
      size: 10,
      data: "iVBORw0KGgo=",
    });

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /shot\.png/ }));
    await screen.findByLabelText("read-only");

    await user.click(screen.getAllByRole("tab")[0].querySelector("[data-close]")!);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  });

  it("still reports a file that cannot be read at all", async () => {
    // Preview is a second chance, not a way to swallow a real failure.
    await addBinary("broken.bin");
    vi.spyOn(getPlatform().files, "preview").mockRejectedValue(new Error("gone"));

    const user = userEvent.setup();
    render(<Editor />);
    const tree = within(screen.getByLabelText("Files"));
    await user.click(await tree.findByRole("button", { name: /broken\.bin/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not a file this editor can open");
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
