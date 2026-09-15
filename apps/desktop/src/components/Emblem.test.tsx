import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { Emblem } from "./Emblem";

describe("Emblem", () => {
  it("puts one decorative emblem on the page, with nothing an audit objects to", async () => {
    const { container } = render(<Emblem />);
    const drawn = container.querySelectorAll("svg.emblem");
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("aria-hidden")).toBe("true");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("takes its emblem with it when it goes", () => {
    const { container, unmount } = render(<Emblem />);
    const host = container.firstElementChild!;
    unmount();
    expect(host.querySelector("svg")).toBeNull();
  });
});
