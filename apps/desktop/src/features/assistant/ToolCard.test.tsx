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
  describe("what the command would do", () => {
    const explained = {
      ...req,
      command: "rm -rf build && curl -d @out.json https://hooks.example.com/x",
      risk: "destructive" as const,
      destructive: true,
      explanation: {
        effects: [
          { kind: "deletes" as const, text: "deletes build, and everything inside, without asking" },
          { kind: "network" as const, text: "sends data to hooks.example.com" },
        ],
        hosts: ["hooks.example.com"],
        paths: ["build"],
        dry_run: "ls -laR build",
        unrecognised: ["frobnicate"],
      },
    };

    it("lists every effect Rust recognised", () => {
      render(<ToolCard request={explained} onApprove={vi.fn()} onReject={vi.fn()} />);
      const list = screen.getByRole("list", { name: /what this would do/i });
      expect(list).toHaveTextContent("deletes build, and everything inside, without asking");
      expect(list).toHaveTextContent("sends data to hooks.example.com");
    });

    it("names the hosts it reaches and the paths it touches", () => {
      render(<ToolCard request={explained} onApprove={vi.fn()} onReject={vi.fn()} />);
      expect(screen.getByText(/reaches/i).closest("p")).toHaveTextContent("hooks.example.com");
      expect(screen.getByText(/touches/i).closest("p")).toHaveTextContent("build");
    });

    it("offers a preview to try first, and copies it", async () => {
      // user-event installs its own clipboard; read back what landed on it.
      const user = userEvent.setup();
      render(<ToolCard request={explained} onApprove={vi.fn()} onReject={vi.fn()} />);
      expect(screen.getByText("ls -laR build")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /copy the preview/i }));
      expect(await navigator.clipboard.readText()).toBe("ls -laR build");
      expect(screen.getByRole("button", { name: /copy the preview/i })).toHaveTextContent("Copied");
    });

    it("says plainly when it does not know a program", () => {
      render(<ToolCard request={explained} onApprove={vi.fn()} onReject={vi.fn()} />);
      expect(screen.getByText("frobnicate").closest("p")).toHaveTextContent(/does not recognise frobnicate/i);
    });

    it("never presents the explanation as permission", () => {
      render(<ToolCard request={explained} onApprove={vi.fn()} onReject={vi.fn()} />);
      expect(screen.getByText(/an explanation, not a guarantee/i)).toBeInTheDocument();
    });

    it("still renders a card saved before explanations existed", () => {
      render(<ToolCard request={req} onApprove={vi.fn()} onReject={vi.fn()} />);
      expect(screen.queryByRole("list", { name: /what this would do/i })).not.toBeInTheDocument();
      expect(screen.getByText("cargo test")).toBeInTheDocument();
    });
  });
});
