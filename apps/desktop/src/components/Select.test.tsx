import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "sonnet", label: "Claude Sonnet 5", note: "Balanced" },
  { value: "opus", label: "Claude Opus 5", note: "Most capable" },
  { value: "haiku", label: "Claude Haiku 4.5", note: "Fastest" },
];

function setup(value = "sonnet") {
  const onChange = vi.fn();
  render(<Select label="Model" value={value} options={OPTIONS} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

const combo = () => screen.getByRole("combobox", { name: /model/i });

describe("Select", () => {
  it("shows the current selection without opening", () => {
    setup();
    expect(combo()).toHaveTextContent("Claude Sonnet 5");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens on click and marks the current value as selected", async () => {
    const { user } = setup("opus");
    await user.click(combo());

    const list = await screen.findByRole("listbox");
    expect(within(list).getByRole("option", { selected: true })).toHaveTextContent(
      "Claude Opus 5",
    );
  });

  it("reports expansion state to assistive technology", async () => {
    const { user } = setup();
    expect(combo()).toHaveAttribute("aria-expanded", "false");
    await user.click(combo());
    expect(combo()).toHaveAttribute("aria-expanded", "true");
  });

  it("selects an option on click", async () => {
    const { user, onChange } = setup();
    await user.click(combo());
    await user.click(screen.getByRole("option", { name: /Claude Haiku/ }));

    expect(onChange).toHaveBeenCalledWith("haiku");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("opens with the down arrow and selects with Enter", async () => {
    const { user, onChange } = setup();
    combo().focus();

    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("does not run past either end of the list", async () => {
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}");

    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledWith("sonnet");
  });

  it("jumps to the last option with End and the first with Home", async () => {
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("haiku");
  });

  it("closes on Escape without selecting", async () => {
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger after closing", async () => {
    const { user } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}{Escape}");
    await waitFor(() => expect(combo()).toHaveFocus());
  });

  it("jumps to a matching option as you type", async () => {
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("haiku");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("haiku");
  });

  it("keeps searching when the query contains a space", async () => {
    // Every label here starts with "Claude", so reaching the second word is
    // the only way to tell them apart. If space committed instead of
    // extending the search, this would select the wrong model.
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("claude opus");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("still selects with space when no search is in progress", async () => {
    const { user, onChange } = setup();
    combo().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("closes when clicking outside", async () => {
    const { user } = setup();
    await user.click(combo());
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("cannot be opened when disabled", async () => {
    const onChange = vi.fn();
    render(
      <Select label="Model" value="sonnet" options={OPTIONS} disabled onChange={onChange} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: /model/i }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("falls back to showing the raw value when it is not in the option list", () => {
    render(
      <Select
        label="Model"
        value="gpt-6-unreleased"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    // A model newer than this build must still be visible, not silently blank.
    expect(screen.getByRole("combobox", { name: /model/i })).toHaveTextContent(
      "Claude Sonnet 5",
    );
  });
});
