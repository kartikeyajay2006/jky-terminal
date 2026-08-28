import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailAlertsPanel } from "./MailAlertsPanel";
import { useDashboard } from "./dashboardStore";
import {
  createWebPlatform,
  __setPlatformForTests,
  type MailConfig,
  type Platform,
} from "../../platform";

function platform(over: Partial<Platform["mail"]> = {}) {
  const base = createWebPlatform();
  return { ...base, mail: { ...base.mail, ...over } };
}

describe("mail alerts", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    useDashboard.setState({
      notes: [], todos: [], events: [], reminders: [], loaded: true, errors: {},
    });
  });
  afterEach(() => __setPlatformForTests(null));

  it("says alerts arrive with the app closed", async () => {
    render(<MailAlertsPanel />);
    expect(await screen.findByText(/even while JKY Terminal is/i)).toBeInTheDocument();
  });

  it("does not claim it works with the computer off", async () => {
    // The one thing that is not true, and the one a user would only discover
    // by missing something.
    render(<MailAlertsPanel />);
    expect(screen.getByText(/while your computer is off/i)).toBeInTheDocument();
  });

  it("fills in the provider from the address", async () => {
    // Nobody should have to look up an SMTP host.
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");

    await waitFor(() => expect(screen.getByLabelText(/server port/i)).toHaveValue(465));
    expect(screen.getByText(/2-Step Verification/i)).toBeInTheDocument();
  });

  it("warns that the account password will not work", async () => {
    // Every large provider refuses it, and it looks like the right answer.
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");

    expect(await screen.findByText(/App Password/)).toBeInTheDocument();
  });

  it("will not turn alerts on without a password", async () => {
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(/store an app password/i)).toBeInTheDocument();
  });

  it("will not turn alerts on without an address", async () => {
    render(<MailAlertsPanel />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("stores the password and clears the box", async () => {
    // Holding it in state that lives as long as the panel buys nothing once
    // it is in the keychain.
    const user = userEvent.setup();
    render(<MailAlertsPanel />);

    const box = screen.getByLabelText(/app password/i);
    await user.type(box, "abcd efgh ijkl mnop");
    await user.click(screen.getByRole("button", { name: /^store$/i }));

    await waitFor(() => expect(box).toHaveValue(""));
    expect(await screen.findByText(/stored in your system keychain/i)).toBeInTheDocument();
  });

  it("never shows a stored password back", async () => {
    const user = userEvent.setup();
    const { container } = render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/app password/i), "hunter2-app-password");
    await user.click(screen.getByRole("button", { name: /^store$/i }));

    await waitFor(() => expect(screen.getByText(/· stored/)).toBeInTheDocument());
    expect(container.innerHTML).not.toContain("hunter2");
  });

  it("offers to remove a stored password", async () => {
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/app password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^store$/i }));
    await screen.findByRole("button", { name: /^remove$/i });

    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() =>
      expect(screen.getByText(/removed from the keychain/i)).toBeInTheDocument(),
    );
  });

  it("turns alerts on once everything is there", async () => {
    const saveConfig = vi.fn(async (_config: MailConfig) => {});
    __setPlatformForTests(
      platform({
        saveConfig,
        readConfig: async () => ({
          address: "someone@gmail.com",
          host: "smtp.gmail.com",
          port: 465,
          enabled: false,
          verified_address: "someone@gmail.com",
        }),
        hasPassword: async () => true,
      }),
    );

    const user = userEvent.setup();
    render(<MailAlertsPanel />);

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    await user.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
    expect(saveConfig.mock.calls[0][0]).toMatchObject({
      address: "someone@gmail.com",
      host: "smtp.gmail.com",
      port: 465,
      enabled: true,
      verified_address: "someone@gmail.com",
    });
  });

  it("will not turn alerts on before the email is verified", async () => {
    // A stored password is not proof the address is reachable — only a
    // matched code is.
    __setPlatformForTests(platform({ hasPassword: async () => true }));
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(/verify this address/i)).toBeInTheDocument();
  });

  it("says a helper was registered when alerts go on", async () => {
    __setPlatformForTests(
      platform({
        readConfig: async () => ({
          address: "someone@gmail.com",
          host: "smtp.gmail.com",
          port: 465,
          enabled: false,
          verified_address: "someone@gmail.com",
        }),
        hasPassword: async () => true,
      }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    await user.click(screen.getByRole("checkbox"));

    expect(await screen.findByText(/registered with your system/i)).toBeInTheDocument();
  });

  it("says the helper was removed when alerts go off", async () => {
    __setPlatformForTests(
      platform({
        readConfig: async () => ({
          address: "a@gmail.com",
          host: "smtp.gmail.com",
          port: 465,
          enabled: true,
          verified_address: "a@gmail.com",
        }),
      }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());

    await user.click(screen.getByRole("checkbox"));
    expect(await screen.findByText(/helper has been removed/i)).toBeInTheDocument();
  });

  it("sends a verification code once a password is stored", async () => {
    const sendOtp = vi.fn(async (_config: MailConfig) => {});
    __setPlatformForTests(platform({ hasPassword: async () => true, sendOtp }));
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send verification code/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(sendOtp.mock.calls[0][0]).toMatchObject({ address: "someone@gmail.com" });
    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it("offers to resend the code once one has gone out", async () => {
    __setPlatformForTests(platform({ hasPassword: async () => true, sendOtp: async () => {} }));
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send verification code/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(await screen.findByRole("button", { name: /resend code/i })).toBeInTheDocument();
  });

  it("verifies with the right code and shows the address as verified", async () => {
    const verifyOtp = vi.fn(async () => true);
    __setPlatformForTests(
      platform({ hasPassword: async () => true, sendOtp: async () => {}, verifyOtp }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send verification code/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    const codeBox = await screen.findByLabelText(/verification code/i);
    await user.type(codeBox, "123456");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    expect(verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({ address: "someone@gmail.com" }),
      "123456",
    );
    expect(await screen.findByText(/· verified/i)).toBeInTheDocument();
  });

  it("says when the code does not match, without treating it as a crash", async () => {
    __setPlatformForTests(
      platform({
        hasPassword: async () => true,
        sendOtp: async () => {},
        verifyOtp: async () => false,
      }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send verification code/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /send verification code/i }));
    await user.type(await screen.findByLabelText(/verification code/i), "000000");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't match/i);
  });

  it("reports what the server actually said when a test send fails", async () => {
    // Wrong port, wrong password and blocked outgoing mail all look the same
    // from here, so the server's answer is the only useful thing to show.
    __setPlatformForTests(
      platform({
        readConfig: async () => ({
          address: "someone@gmail.com",
          host: "smtp.gmail.com",
          port: 465,
          enabled: false,
          verified_address: "someone@gmail.com",
        }),
        hasPassword: async () => true,
        sendTest: async () => {
          throw "The server refused that username and password.";
        },
      }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send a test/i })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: /send a test/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/refused/i);
  });

  it("confirms where a test message went", async () => {
    __setPlatformForTests(
      platform({
        readConfig: async () => ({
          address: "someone@gmail.com",
          host: "smtp.gmail.com",
          port: 465,
          enabled: false,
          verified_address: "someone@gmail.com",
        }),
        hasPassword: async () => true,
        sendTest: async () => {},
      }),
    );
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send a test/i })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: /send a test/i }));
    expect(await screen.findByText(/check someone@gmail\.com/i)).toBeInTheDocument();
  });

  it("cannot send a verification code before a password is stored", async () => {
    const user = userEvent.setup();
    render(<MailAlertsPanel />);
    await user.type(screen.getByLabelText(/your email/i), "someone@gmail.com");
    expect(screen.getByRole("button", { name: /send verification code/i })).toBeDisabled();
  });

  it("lists the events that have an alert set", async () => {
    useDashboard.setState({
      events: [
        {
          id: "e1",
          title: "Team meeting",
          starts_at: "2099-08-27T10:00:00Z",
          colour: "rose",
          alert_minutes_before: 30,
        },
        {
          id: "e2",
          title: "No alert on this one",
          starts_at: "2099-08-28T10:00:00Z",
          colour: "cyan",
          alert_minutes_before: null,
        },
      ],
    });
    render(<MailAlertsPanel />);

    expect(screen.getByText("Team meeting")).toBeInTheDocument();
    expect(screen.queryByText("No alert on this one")).toBeNull();
  });
});
