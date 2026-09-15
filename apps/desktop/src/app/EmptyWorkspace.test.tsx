import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { EmptyWorkspace } from "./EmptyWorkspace";

describe("EmptyWorkspace", () => {
  it("says there is no terminal, and how to open one", () => {
    render(<EmptyWorkspace />);
    expect(screen.getByText(/no terminal open/i)).toBeInTheDocument();
    expect(screen.getByText(/new terminal/i)).toBeInTheDocument();
    const keys = [...document.querySelectorAll("kbd")].map((k) => k.textContent);
    expect(keys).toEqual(["Ctrl", "T"]);
  });

  it("shows the emblem, as decoration beside those words", () => {
    const { container } = render(<EmptyWorkspace />);
    const emblem = container.querySelector("svg.emblem");
    expect(emblem, "an empty workspace with nothing to look at").not.toBeNull();
    expect(emblem!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("has nothing an audit objects to", async () => {
    const { container } = render(<EmptyWorkspace />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
