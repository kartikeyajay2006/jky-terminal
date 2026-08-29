import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { IdentityMark } from "./IdentityMark";
import { DEFAULT_IDENTITY, initialsFor, loadIdentity, saveIdentity } from "./identity";

describe("initials", () => {
  it("takes two from a full name", () => {
    // The mark is a small square, and two letters is what fits legibly.
    expect(initialsFor("Kartikeya Yadav")).toBe("KY");
  });

  it("takes one from a single word, rather than two from the same word", () => {
    // "KA" from "Kartikeya" reads as a stutter.
    expect(initialsFor("Kartikeya")).toBe("K");
  });

  it("stops at two, however many words there are", () => {
    expect(initialsFor("One Two Three Four")).toBe("OT");
  });

  it("uppercases, so a lowercase name still looks like a monogram", () => {
    expect(initialsFor("ada lovelace")).toBe("AL");
  });

  it("falls back to the app's own initial when there is no name", () => {
    expect(initialsFor("")).toBe("J");
    expect(initialsFor("   ")).toBe("J");
  });

  it("copes with extra spacing between words", () => {
    expect(initialsFor("  Grace   Hopper  ")).toBe("GH");
  });
});

describe("remembering it", () => {
  beforeEach(() => localStorage.clear());

  it("starts unset", () => {
    expect(loadIdentity()).toEqual(DEFAULT_IDENTITY);
  });

  it("comes back after a restart", () => {
    saveIdentity({ name: "Ada", message: "hello" });
    expect(loadIdentity()).toEqual({ name: "Ada", message: "hello" });
  });

  it("trims what was typed", () => {
    expect(saveIdentity({ name: "  Ada  ", message: "  hi  " })).toEqual({
      name: "Ada",
      message: "hi",
    });
  });

  it("bounds both fields, so the rail is not reshaped by a long one", () => {
    const long = "x".repeat(500);
    const saved = saveIdentity({ name: long, message: long });
    expect(saved.name.length).toBeLessThanOrEqual(24);
    expect(saved.message.length).toBeLessThanOrEqual(60);
  });

  it("treats a corrupt store as unset rather than crashing", () => {
    localStorage.setItem("jky.identity", "{ not json");
    expect(() => loadIdentity()).not.toThrow();
    expect(loadIdentity()).toEqual(DEFAULT_IDENTITY);
  });

  it("ignores a stored value of the wrong shape", () => {
    localStorage.setItem("jky.identity", JSON.stringify({ name: 42 }));
    expect(loadIdentity()).toEqual(DEFAULT_IDENTITY);
  });
});

describe("the mark", () => {
  beforeEach(() => localStorage.clear());

  it("shows the app's initial before a name is set", () => {
    render(<IdentityMark />);
    expect(screen.getByRole("button", { name: /set your name/i })).toHaveTextContent("J");
  });

  it("opens an editor when clicked", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));
    expect(screen.getByRole("dialog", { name: /your name/i })).toBeInTheDocument();
  });

  it("focuses the first field, so the shortcut needs no click after it", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("saves a name and shows its initials", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText("AL")).toBeInTheDocument());
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("saves a message and shows it under the name", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));

    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Message"), "Building something good");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText("Building something good")).toBeInTheDocument(),
    );
  });

  it("saves on Enter, without reaching for the button", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));
    await user.type(screen.getByLabelText("Name"), "Grace{Enter}");

    await waitFor(() => expect(screen.getByText("G")).toBeInTheDocument());
  });

  it("names the person on hover, once there is one", async () => {
    const user = userEvent.setup();
    render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Message"), "hello");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ada — hello" })).toHaveAttribute(
        "title",
        "Ada — hello",
      ),
    );
  });

  it("keeps what was saved when the editor is cancelled", async () => {
    saveIdentity({ name: "Ada", message: "kept" });
    const user = userEvent.setup();
    render(<IdentityMark />);

    await user.click(screen.getByRole("button", { name: /ada/i }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Discarded");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(loadIdentity().name).toBe("Ada");
  });

  it("closes on Escape without saving", async () => {
    saveIdentity({ name: "Ada", message: "" });
    const user = userEvent.setup();
    render(<IdentityMark />);

    await user.click(screen.getByRole("button", { name: /ada/i }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Nope");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(loadIdentity().name).toBe("Ada");
  });

  it("reopens on what is saved, so a cancelled edit is not remembered", async () => {
    saveIdentity({ name: "Ada", message: "" });
    const user = userEvent.setup();
    render(<IdentityMark />);

    await user.click(screen.getByRole("button", { name: /ada/i }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Temporary");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await user.click(screen.getByRole("button", { name: /ada/i }));
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });

  it("survives a restart", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<IdentityMark />);
    await user.click(screen.getByRole("button", { name: /set your name/i }));
    await user.type(screen.getByLabelText("Name"), "Ada{Enter}");
    unmount();

    render(<IdentityMark />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});
