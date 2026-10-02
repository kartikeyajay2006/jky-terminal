import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebPlatform, __setPlatformForTests, type Platform } from "../../platform";
import { Settings } from "./Settings";

describe("the Privacy panel", () => {
  let platform: Platform;

  beforeEach(() => {
    platform = createWebPlatform();
    __setPlatformForTests(platform);
    localStorage.clear();
  });
  afterEach(() => __setPlatformForTests(null));

  async function open() {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole("button", { name: /privacy/i }));
    await screen.findByRole("heading", { name: /^privacy$/i });
    return user;
  }

  it("shows that everything is kept by default", async () => {
    await open();
    expect(await screen.findByRole("checkbox", { name: /keep command history/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /restore scrollback/i })).toBeChecked();
    expect(screen.getByRole("combobox", { name: /forget history older than/i })).toHaveTextContent(/never/i);
  });

  it("turns history off, and Rust is told", async () => {
    const set = vi.spyOn(platform.settings, "setPrivacy");
    const user = await open();
    await user.click(await screen.findByRole("checkbox", { name: /keep command history/i }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ keepHistory: false })));
    expect(screen.getByRole("checkbox", { name: /keep command history/i })).not.toBeChecked();
  });

  it("sets a retention window", async () => {
    const set = vi.spyOn(platform.settings, "setPrivacy");
    const user = await open();
    await user.click(await screen.findByRole("combobox", { name: /forget history older than/i }));
    await user.click(await screen.findByRole("option", { name: /30 days/i }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ historyDays: 30 })));
  });

  it("says that turning scrollback off deletes what was saved", async () => {
    await open();
    expect(await screen.findByText(/deletes the scrollback already saved/i)).toBeInTheDocument();
  });

  it("clears every command only after a second, explicit click", async () => {
    const clear = vi.spyOn(platform.history, "clear");
    const user = await open();
    await user.click(await screen.findByRole("button", { name: /clear all history/i }));
    expect(clear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /yes, clear it/i }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent(/history cleared/i);
  });

  it("sets the project folder, and shows a refusal plainly", async () => {
    const setDir = vi
      .spyOn(platform.settings, "setProjectDir")
      .mockRejectedValueOnce(new Error("~/nope does not exist, or is not a folder"))
      .mockResolvedValueOnce();
    const user = await open();

    const field = await screen.findByRole("combobox", { name: /project folder/i });
    await user.type(field, "~/nope{Enter}");
    expect(await screen.findByText(/does not exist/i)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "~/code/api{Enter}");
    await waitFor(() => expect(setDir).toHaveBeenLastCalledWith("~/code/api"));
    expect(await screen.findByRole("status")).toHaveTextContent("Project folder set to ~/code/api.");
    expect(screen.getByText("~/code/api", { selector: "code" })).toBeInTheDocument();
  });
});
