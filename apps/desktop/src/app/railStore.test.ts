import { beforeEach, describe, expect, it } from "vitest";
import { useRail } from "./railStore";

describe("whether the rail shows its labels", () => {
  beforeEach(() => {
    localStorage.removeItem("jky.rail.collapsed");
    useRail.setState({ collapsed: false });
  });

  it("starts open, because nobody asked for it to be closed", () => {
    expect(useRail.getState().collapsed).toBe(false);
  });

  it("toggles both ways", () => {
    useRail.getState().toggle();
    expect(useRail.getState().collapsed).toBe(true);
    useRail.getState().toggle();
    expect(useRail.getState().collapsed).toBe(false);
  });

  it("remembers the choice, which is about how you work rather than what you are doing", () => {
    useRail.getState().toggle();
    expect(localStorage.getItem("jky.rail.collapsed")).toBe("true");

    useRail.getState().set(false);
    expect(localStorage.getItem("jky.rail.collapsed")).toBe("false");
  });
});
