import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  // The shape says nothing to a screen reader; the words beside it do.
  it("announces the words, not the shape", () => {
    const { container } = render(<Spinner label="Reading your mail…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading your mail…");
    expect(container.querySelector(".spinner")).toHaveAttribute("aria-hidden", "true");
  });

  // Beside text that already says what is happening, a second announcement
  // would say it twice.
  it("stays quiet when it has no words of its own", () => {
    render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
