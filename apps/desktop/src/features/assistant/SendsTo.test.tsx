import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SendsTo } from "./SendsTo";

describe("what a message takes with it", () => {
  it("names the provider it goes to and the conversation that goes with it", () => {
    render(<SendsTo provider="anthropic" turns={4} memory="" />);
    const line = screen.getByRole("list", { name: /sent with your message/i });
    expect(line).toHaveTextContent(/to anthropic/i);
    expect(line).toHaveTextContent(/4 earlier turns/i);
    expect(line).toHaveTextContent(/secrets redacted/i);
  });

  it("says a local model keeps everything on this machine", () => {
    render(<SendsTo provider="ollama" turns={0} memory="" />);
    expect(screen.getByRole("list", { name: /sent with your message/i })).toHaveTextContent(
      /stays on this machine/i,
    );
  });

  it("shows project context only when there is some", () => {
    const { rerender } = render(<SendsTo provider="openai" turns={1} memory="  " />);
    expect(screen.queryByText(/project context/i)).not.toBeInTheDocument();
    rerender(<SendsTo provider="openai" turns={1} memory="we use pnpm" />);
    expect(screen.getByText(/project context/i)).toBeInTheDocument();
    expect(screen.getByText(/1 earlier turn$/i)).toBeInTheDocument();
  });

  it("says nothing earlier goes when the conversation is new", () => {
    render(<SendsTo provider="openai" turns={0} memory="" />);
    expect(screen.getByText(/only this message/i)).toBeInTheDocument();
  });
});
