import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JkyMark } from "./JkyMark";

describe("JkyMark", () => {
  it("is labelled, because it stands in for the product's name", () => {
    render(<JkyMark />);
    expect(screen.getByRole("img", { name: /jky/i })).toBeInTheDocument();
  });

  it("scales to the size it is given", () => {
    const { container } = render(<JkyMark size={96} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("96");
    expect(svg.getAttribute("height")).toBe("96");
  });

  it("keeps its aspect ratio through a viewBox rather than fixed coordinates", () => {
    const { container } = render(<JkyMark size={32} />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 64 64");
  });

  it("draws in theme colours rather than baked-in ones", () => {
    // A mark with hard-coded colour is invisible on half the themes.
    const { container } = render(<JkyMark />);
    const markup = container.innerHTML;
    expect(markup).toContain("var(--accent");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("gives each instance a unique gradient id", () => {
    // Duplicate ids make every instance after the first render the first
    // one's gradient, which then changes when that one unmounts.
    const { container } = render(
      <>
        <JkyMark />
        <JkyMark />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("animates only when asked", () => {
    const { container: still } = render(<JkyMark />);
    const { container: moving } = render(<JkyMark animated />);
    expect(still.querySelector('[data-animated="true"]')).toBeNull();
    expect(moving.querySelector('[data-animated="true"]')).not.toBeNull();
  });
});
