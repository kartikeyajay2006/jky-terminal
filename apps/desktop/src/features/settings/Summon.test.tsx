import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebPlatform, __setPlatformForTests, type Platform } from "../../platform";
import { Summon } from "./Summon";

describe("the summon shortcut", () => {
  let platform: Platform;
  beforeEach(() => {
    platform = createWebPlatform();
    __setPlatformForTests(platform);
  });

  it("shows the shortcut and that it works from any app", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({ shortcut: "Super+J", active: true, note: null });
    render(<Summon />);
    expect(await screen.findByLabelText(/current summon shortcut/i)).toHaveTextContent("Super+J");
    expect(screen.getByRole("status")).toHaveTextContent(/from any app/i);
  });

  it("saves a typed shortcut in the form Rust stored it", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({ shortcut: null, active: false, note: null });
    const set = vi
      .spyOn(platform.settings, "setSummon")
      .mockResolvedValue({ shortcut: "Ctrl+Alt+K", active: true, note: null });
    const user = userEvent.setup();
    render(<Summon />);
    await user.type(await screen.findByRole("textbox", { name: /summon shortcut/i }), "ctrl alt k{Enter}");
    expect(set).toHaveBeenCalledWith("ctrl alt k");
    await waitFor(() => expect(screen.getByLabelText(/current summon shortcut/i)).toHaveTextContent("Ctrl+Alt+K"));
  });

  it("shows a refusal in Rust's words and keeps what was there", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({ shortcut: "Super+J", active: true, note: null });
    vi.spyOn(platform.settings, "setSummon").mockRejectedValue(
      new Error("Ctrl on its own would take that key from every other app — add Alt, Shift or Super"),
    );
    const user = userEvent.setup();
    render(<Summon />);
    await user.type(await screen.findByRole("textbox", { name: /summon shortcut/i }), "ctrl+j{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/add Alt, Shift or Super/);
    expect(screen.getByLabelText(/current summon shortcut/i)).toHaveTextContent("Super+J");
  });

  it("offers this platform's recommended shortcuts in one click", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({ shortcut: null, active: false, note: null });
    const set = vi
      .spyOn(platform.settings, "setSummon")
      .mockImplementation(async (s) => ({ shortcut: s, active: true, note: null }));
    const user = userEvent.setup();
    render(<Summon />);
    const presets = await screen.findAllByRole("button", { name: /^use /i });
    expect(presets.length).toBeGreaterThanOrEqual(2);
    await user.click(presets[0]);
    await waitFor(() => expect(set).toHaveBeenCalled());
  });

  it("turns it off", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({ shortcut: "Super+J", active: true, note: null });
    const set = vi
      .spyOn(platform.settings, "setSummon")
      .mockResolvedValue({ shortcut: null, active: false, note: null });
    const user = userEvent.setup();
    render(<Summon />);
    await user.click(await screen.findByRole("button", { name: /turn off/i }));
    expect(set).toHaveBeenCalledWith("none");
    expect(await screen.findByRole("status")).toHaveTextContent(/no summon shortcut/i);
  });

  it("explains, in words, when this desktop will not let JKY hold it", async () => {
    vi.spyOn(platform.settings, "summon").mockResolvedValue({
      shortcut: "Super+J",
      active: false,
      note: "This is a Wayland session, where the desktop — not an app — owns global shortcuts.",
    });
    render(<Summon />);
    expect(await screen.findByRole("status")).toHaveTextContent(/Wayland session/);
  });
});
