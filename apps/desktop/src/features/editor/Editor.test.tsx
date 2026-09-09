import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor";
import { getPlatform } from "../../platform";

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
