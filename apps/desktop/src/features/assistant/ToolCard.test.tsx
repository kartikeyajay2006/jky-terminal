import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard";

const req = {
  id: "toolu_1",
  name: "run_command",
  command: "cargo test",
  reason: "Check the suite passes",
  destructive: false,
};

describe("ToolCard", () => {
  it("shows the exact command and the reason", () => {
    render(<ToolCard request={req} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("cargo test")).toBeInTheDocument();
    expect(screen.getByText(/Check the suite passes/)).toBeInTheDocument();
  });

  it("runs only when approved", async () => {
    const onApprove = vi.fn();
    render(<ToolCard request={req} onApprove={onApprove} onReject={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /^run$/i }));
    expect(onApprove).toHaveBeenCalledWith("toolu_1");
  });

  it("declines without running", async () => {
    const onReject = vi.fn();
    render(<ToolCard request={req} onApprove={vi.fn()} onReject={onReject} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /don't run/i }));
    expect(onReject).toHaveBeenCalledWith("toolu_1");
  });

  it("makes a destructive command type-to-confirm", async () => {
    const danger = { ...req, command: "rm -rf build", destructive: true };
    render(<ToolCard request={danger} onApprove={vi.fn()} onReject={vi.fn()} />);

    // One click is not enough for something irreversible.
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();

    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: /type the command/i }), "rm -rf build");
    expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled();
  });

  it("keeps run disabled while the typed confirmation does not match", async () => {
    const danger = { ...req, command: "rm -rf build", destructive: true };
    render(<ToolCard request={danger} onApprove={vi.fn()} onReject={vi.fn()} />);

    await userEvent
      .setup()
      .type(screen.getByRole("textbox", { name: /type the command/i }), "rm -rf buil");
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });

  it("asks for no confirmation typing on an ordinary command", () => {
    render(<ToolCard request={req} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: /type the command/i })).not.toBeInTheDocument();
  });

  it("marks a destructive command as such", () => {
    const danger = { ...req, command: "rm -rf build", destructive: true };
    render(<ToolCard request={danger} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/destructive/i)).toBeInTheDocument();
  });
});
