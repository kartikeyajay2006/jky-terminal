import { beforeEach, describe, expect, it } from "vitest";
import { useNav } from "./navStore";

describe("navigation requests", () => {
  beforeEach(() => useNav.setState({ pending: null }));

  it("starts with nothing waiting", () => {
    expect(useNav.getState().pending).toBeNull();
  });

  it("holds a section until it is taken", () => {
    useNav.getState().go("dashboard");
    expect(useNav.getState().pending).toEqual({ section: "dashboard", panel: undefined });
  });

  it("holds a section and a panel together", () => {
    useNav.getState().go("settings", "providers");
    expect(useNav.getState().pending).toEqual({ section: "settings", panel: "providers" });
  });

  it("hands the whole request over exactly once", () => {
    useNav.getState().go("games");
    expect(useNav.getState().take()?.section).toBe("games");
    expect(useNav.getState().take()).toBeNull();
  });

  it("replaces an untaken request rather than queueing", () => {
    useNav.getState().go("dashboard");
    useNav.getState().go("settings");
    expect(useNav.getState().take()?.section).toBe("settings");
  });
});

describe("taking a panel", () => {
  beforeEach(() => useNav.setState({ pending: null }));

  it("gives the panel to the section that asked for it", () => {
    useNav.getState().go("dashboard", "calendar");
    expect(useNav.getState().takePanel("dashboard")).toBe("calendar");
  });

  it("gives nothing to a section the request was not for", () => {
    useNav.getState().go("dashboard", "calendar");
    expect(useNav.getState().takePanel("settings")).toBeNull();
  });

  it("gives nothing when no panel was asked for", () => {
    useNav.getState().go("dashboard");
    expect(useNav.getState().takePanel("dashboard")).toBeNull();
  });

  it("leaves the section behind, so the two takers do not race", () => {
    // App switches the section and the section picks the panel. Whichever
    // ran first would otherwise clear the request out from under the other.
    useNav.getState().go("settings", "commands");
    useNav.getState().takePanel("settings");
    expect(useNav.getState().pending?.section).toBe("settings");
  });

  it("hands one panel over exactly once", () => {
    useNav.getState().go("settings", "commands");
    expect(useNav.getState().takePanel("settings")).toBe("commands");
    expect(useNav.getState().takePanel("settings")).toBeNull();
  });

  it("gives nothing when nothing is pending", () => {
    expect(useNav.getState().takePanel("dashboard")).toBeNull();
  });
});
