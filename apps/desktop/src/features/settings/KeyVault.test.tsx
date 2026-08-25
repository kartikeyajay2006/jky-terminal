import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { KeyVault } from "./KeyVault";

const VALID_KEY = `sk-ant-api03-${"x".repeat(40)}`;

describe("KeyVault", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  it("shows the provider as not connected on first load", async () => {
    render(<KeyVault />);
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it("stores a valid key and switches to the connected state", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/anthropic api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));

    expect(await screen.findByText(/^connected$/i)).toBeInTheDocument();
  });

  it("uses a password-type input so the key is never shown on screen", async () => {
    render(<KeyVault />);
    const input = await screen.findByLabelText(/anthropic api key/i);
    expect(input).toHaveAttribute("type", "password");
  });

  it("clears the input immediately after a successful save", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    const input = await screen.findByLabelText(/anthropic api key/i);
    await user.type(input, VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("surfaces a validation error without echoing the rejected key", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/anthropic api key/i), "sk-wrong-CANARY123");
    await user.click(screen.getByRole("button", { name: /save key/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent ?? "").not.toContain("CANARY123");
  });

  it("disables save while the field is empty", async () => {
    render(<KeyVault />);
    await screen.findByLabelText(/anthropic api key/i);
    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();
  });

  it("removes the key and returns to the not-connected state", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/anthropic api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));
    await screen.findByRole("button", { name: /remove key/i });
    await user.click(screen.getByRole("button", { name: /remove key/i }));

    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it("never renders stored key material anywhere in the tree", async () => {
    const user = userEvent.setup();
    const { container } = render(<KeyVault />);

    await user.type(await screen.findByLabelText(/anthropic api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));
    await screen.findByText(/^connected$/i);

    expect(container.innerHTML).not.toContain(VALID_KEY);
  });
});
