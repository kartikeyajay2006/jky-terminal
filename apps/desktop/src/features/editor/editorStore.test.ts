import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatform } from "../../platform";
import { idOf, isDirty, keyOf, unsavedCount, useEditor } from "./editorStore";

async function fresh() {
  useEditor.setState({ open: [], active: null, error: null });
  const files = getPlatform().files;
  for (const folder of await files.folders()) await files.closeFolder(folder.root);
  await files.openFolder("/tmp/sample");
  vi.restoreAllMocks();
}

const README = keyOf("/tmp/sample", "README.md");

describe("what is open in the editor", () => {
  beforeEach(fresh);

  it("survives the editor being unmounted, which is the whole point", async () => {
    // The Editor component is unmounted whenever you look at anything else.
    // When the text lived there, a trip to the terminal threw away everything
    // unsaved.
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    useEditor.getState().edit(README, "changed while away");

    expect(useEditor.getState().open).toHaveLength(1);
    expect(useEditor.getState().open[0].text).toBe("changed while away");
  });

  it("opens a file once however often it is asked for", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    expect(useEditor.getState().open).toHaveLength(1);
  });

  it("counts only what is not on disk", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    expect(unsavedCount()).toBe(0);

    useEditor.getState().edit(README, "different");
    expect(unsavedCount()).toBe(1);

    await useEditor.getState().save(README);
    expect(unsavedCount()).toBe(0);
  });

  it("stays unsaved when the write failed", async () => {
    // Reporting it saved would be the one lie that loses work.
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    // Distinct from anything another test writes: the browser build keeps one
    // tree for the whole file, so "different" had already been saved by then
    // and the edit was not an edit at all.
    useEditor.getState().edit(README, `unsaved ${Date.now()}`);
    vi.spyOn(getPlatform().files, "write").mockRejectedValueOnce(new Error("read-only"));

    expect(await useEditor.getState().save(README)).toBe(false);
    expect(unsavedCount()).toBe(1);
    expect(useEditor.getState().error).toContain("read-only");
  });

  it("moves focus off a file that was closed", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    await useEditor.getState().openFile("/tmp/sample", "src/main.ts");

    useEditor.getState().drop(keyOf("/tmp/sample", "src/main.ts"));
    expect(useEditor.getState().active).toBe(README);

    useEditor.getState().drop(README);
    expect(useEditor.getState().active).toBeNull();
  });

  it("closes everything from a folder that closed", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    useEditor.getState().dropFolder("/tmp/sample");

    expect(useEditor.getState().open).toEqual([]);
    expect(useEditor.getState().active).toBeNull();
  });

  it("follows a rename, keeping the file open and focused", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    useEditor.getState().renamed("/tmp/sample", "README.md", "READ.md");

    const open = useEditor.getState().open[0];
    expect(open.path).toBe("READ.md");
    expect(useEditor.getState().active).toBe(idOf(open));
  });

  it("says so when a file cannot be read rather than opening an empty tab", async () => {
    await useEditor.getState().openFile("/tmp/sample", "nowhere.md");
    expect(useEditor.getState().open).toEqual([]);
    expect(useEditor.getState().error).toContain("could not read");
  });

  it("knows a file is dirty only when it differs from what is on disk", async () => {
    await useEditor.getState().openFile("/tmp/sample", "README.md");
    const file = useEditor.getState().open[0];
    expect(isDirty(file)).toBe(false);
    expect(isDirty({ ...file, text: `${file.text} ` })).toBe(true);
  });
});
