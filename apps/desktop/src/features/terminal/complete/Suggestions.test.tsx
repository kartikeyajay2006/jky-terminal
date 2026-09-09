import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Suggestions } from "./Suggestions";
import type { Suggestion } from "../../../platform";

const item = (value: string, kind: Suggestion["kind"] = "file", detail = ""): Suggestion => ({
  value,
  display: value,
  kind,
  detail,
  from: 0,
});

const draw = (items: Suggestion[], index = 0, word = "") => {
  const onAccept = vi.fn();
  const onSelect = vi.fn();
  render(
    <Suggestions items={items} index={index} word={word} onAccept={onAccept} onSelect={onSelect} />,
  );
  return { onAccept, onSelect };
};

describe("the completion list", () => {
  it("draws one row per suggestion", () => {
    draw([item("main.rs"), item("src/", "directory")]);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("marks exactly one row selected, and says which to assistive technology", () => {
    draw([item("a"), item("b"), item("c")], 1);
    const options = screen.getAllByRole("option");
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-activedescendant", "suggest-1");
  });

  it("says what each row is", () => {
    draw([item("main", "branch"), item("dev", "script")]);
    expect(screen.getByText("branch")).toBeInTheDocument();
    expect(screen.getByText("script")).toBeInTheDocument();
  });

  it("shows what a flag is for", () => {
    draw([item("--amend", "flag", "replace the last commit")]);
    expect(screen.getByText("replace the last commit")).toBeInTheDocument();
  });

  it("marks the letters that matched", () => {
    const { container } = render(
      <Suggestions
        items={[item("README.md")]}
        index={0}
        word="re"
        onAccept={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    // Case-insensitively, because the match was — typing `re` and having
    // README show nothing marked would look like the wrong row.
    expect(container.querySelector(".suggest__hit")?.textContent).toBe("RE");
  });

  it("marks nothing when the match is not in the shown text", () => {
    // A path shows its last part but matched against the whole thing.
    const { container } = render(
      <Suggestions
        items={[{ ...item("main.rs"), display: "main.rs" }]}
        index={0}
        word="src/ma"
        onAccept={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector(".suggest__hit")).toBeNull();
    expect(screen.getByRole("option")).toHaveTextContent("main.rs");
  });

  it("takes a row on mouse down rather than on click", async () => {
    // A click lands after the terminal has taken focus back, and the row is
    // gone by then.
    const user = userEvent.setup();
    const { onAccept } = draw([item("main.rs"), item("other")]);
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getAllByRole("option")[1] });
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ value: "other" }));
  });

  it("follows the pointer without taking focus from the terminal", async () => {
    const user = userEvent.setup();
    const { onSelect } = draw([item("a"), item("b")]);
    await user.hover(screen.getAllByRole("option")[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(document.body);
  });

  it("says which keys work", () => {
    draw([item("a")]);
    expect(screen.getByText("Tab")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });
});
