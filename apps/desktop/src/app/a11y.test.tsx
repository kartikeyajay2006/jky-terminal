import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { TabBar } from "./TabBar";
import { useTabs } from "./tabStore";
import { applyTheme, THEMES } from "./theme";
import { createWebPlatform, __setPlatformForTests } from "../platform";
import { ProviderVault } from "../features/settings/ProviderVault";
import { Assistant } from "../features/assistant/Assistant";
import { ToolCard } from "../features/assistant/ToolCard";

describe("accessibility", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    useTabs.setState({ tabs: [], activeId: null });
  });
  afterEach(() => {
    __setPlatformForTests(null);
    document.documentElement.removeAttribute("data-theme");
  });

  // Every theme redefines colour tokens, so the markup is checked under each.
  // Checking only the default would leave five palettes shipping unexamined.
  for (const theme of THEMES) {
    it(`the shell has no violations in ${theme.label}`, async () => {
      applyTheme(theme.id);
      useTabs.getState().openTab("terminal", "Terminal 1");
      const { container } = render(
        <Shell>
          <TabBar />
        </Shell>,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it("the provider vault has no violations", async () => {
    const { container } = render(<ProviderVault />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an expanded provider row has no violations", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = render(<ProviderVault />);
    await user.click(await findByRole("button", { name: /Anthropic/ }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the assistant panel has no violations", async () => {
    const { container } = render(<Assistant />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a tool approval card has no violations", async () => {
    // The card is the one place a wrong decision is expensive, so its
    // controls must be reachable and labelled for everyone.
    const { container } = render(
      <ToolCard
        request={{
          id: "toolu_1",
          name: "run_command",
          command: "rm -rf build",
          reason: "Clear stale artifacts",
          destructive: true,
        }}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an open dropdown has no violations", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = render(<Shell>{null}</Shell>);
    await user.click(await findByRole("combobox", { name: /theme/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
