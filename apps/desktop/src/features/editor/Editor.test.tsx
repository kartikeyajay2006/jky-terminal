import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor";
import { getPlatform } from "../../platform";

/*
 * CodeMirror draws into a real contenteditable and measures it, which jsdom
 * has no layout engine for. What this component is responsible for — opening
 * the right file, knowing which are unsaved, saving the right one — is all
 * around the editor rather than inside it, so a textarea stands in.
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

async function withFolder() {
  await getPlatform().files.openWorkspace("/tmp/sample");
}

describe("the editor", () => {
  beforeEach(async () => {
    await getPlatform().files.openWorkspace("");
    vi.restoreAllMocks();
  });

  it("can reach nothing until a folder is opened, and says so", async () => {
    render(<Editor />);
    expect(await screen.findByText("nothing open")).toBeInTheDocument();
    expect(screen.getByText(/reach nothing at all/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a folder" })).toBeInTheDocument();
  });

  it("lists the folder once one is open", async () => {
    await withFolder();
    render(<Editor />);
    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /src/ })).toBeInTheDocument();
  });

  it("opens a file when it is chosen", async () => {
    await withFolder();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    expect(await screen.findByLabelText("Editing README.md")).toHaveValue(
      "# Sample\n\nThe browser build has no filesystem.\n",
    );
  });

  it("expands a directory rather than opening it", async () => {
    await withFolder();
    const user = userEvent.setup();
    render(<Editor />);

    const dir = await screen.findByRole("button", { name: /src/ });
    expect(dir).toHaveAttribute("aria-expanded", "false");
    await user.click(dir);

    await waitFor(() => expect(dir).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("button", { name: /main\.ts/ })).toBeInTheDocument();
  });

  it("marks a file with unsaved changes, and clears it on save", async () => {
    await withFolder();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.type(await screen.findByLabelText("Editing README.md"), "!");
    expect(await screen.findByLabelText("unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save README.md" }));
    await waitFor(() => expect(screen.queryByLabelText("unsaved changes")).toBeNull());
  });

  it("writes what is on screen to the file that was open", async () => {
    await withFolder();
    const write = vi.spyOn(getPlatform().files, "write");
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.clear(await screen.findByLabelText("Editing README.md"));
    await user.type(screen.getByLabelText("Editing README.md"), "new text");
    await user.click(screen.getByRole("button", { name: "Save README.md" }));

    expect(write).toHaveBeenCalledWith("README.md", "new text");
  });

  it("opens a file once however often it is chosen", async () => {
    await withFolder();
    const user = userEvent.setup();
    render(<Editor />);

    const file = await screen.findByRole("button", { name: /README\.md/ });
    await user.click(file);
    await user.click(file);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("closes a file and falls back to the one before it", async () => {
    await withFolder();
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.click(screen.getByRole("button", { name: /src/ }));
    await user.click(await screen.findByRole("button", { name: /main\.ts/ }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    await user.click(screen.getAllByRole("tab")[1].querySelector("[data-close]")!);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getByLabelText("Editing README.md")).toBeInTheDocument();
  });

  it("reports a refusal instead of pretending the file opened", async () => {
    await withFolder();
    vi.spyOn(getPlatform().files, "read").mockRejectedValueOnce(
      new Error("`logo.png` is not a file this editor can open"),
    );
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a file this editor can open");
  });

  it("reports a refused save and keeps the changes on screen", async () => {
    await withFolder();
    vi.spyOn(getPlatform().files, "write").mockRejectedValueOnce(new Error("read-only"));
    const user = userEvent.setup();
    render(<Editor />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    await user.type(await screen.findByLabelText("Editing README.md"), "!");
    await user.click(screen.getByRole("button", { name: "Save README.md" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("read-only");
    // Still unsaved, because it still is.
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });
});
