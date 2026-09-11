import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Rail } from "./Rail";
import { useRail } from "./railStore";

const draw = () => {
  const onSelect = vi.fn();
  const { container } = render(<Rail activeId="terminal" onSelect={onSelect} />);
  return { onSelect, rail: container.querySelector("nav")! };
};

describe("the rail", () => {
  beforeEach(() => {
    localStorage.removeItem("jky.rail.collapsed");
    useRail.setState({ collapsed: false });
  });

  it("closes and opens again from the same control", async () => {
    // The only way back is through it, so it has to stay on screen.
    const user = userEvent.setup();
    const { rail } = draw();

    await user.click(screen.getByRole("button", { name: "Hide the section names" }));
    expect(rail).toHaveAttribute("data-collapsed", "true");

    await user.click(screen.getByRole("button", { name: "Show the section names" }));
    expect(rail).not.toHaveAttribute("data-collapsed");
  });

  it("says whether it is open, for anyone who cannot see the arrow", () => {
    draw();
    expect(screen.getByRole("button", { name: /section names/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps every section reachable when closed", async () => {
    // Collapsed is narrow, not gone: the sections stay one click away.
    const user = userEvent.setup();
    const { onSelect } = draw();
    await user.click(screen.getByRole("button", { name: "Hide the section names" }));

    await user.click(screen.getByRole("button", { name: "History" }));
    expect(onSelect).toHaveBeenCalledWith("history");
  });

  it("names every section for a pointer, which has no label to read when closed", () => {
    draw();
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("title", "Terminal");
  });

  it("comes back closed when it was left closed", () => {
    localStorage.setItem("jky.rail.collapsed", "true");
    useRail.setState({ collapsed: localStorage.getItem("jky.rail.collapsed") === "true" });
    const { rail } = draw();
    expect(rail).toHaveAttribute("data-collapsed", "true");
  });
});
