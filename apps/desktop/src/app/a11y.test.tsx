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

  it("an open dropdown has no violations", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = render(<Shell>{null}</Shell>);
    await user.click(await findByRole("combobox", { name: /theme/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
