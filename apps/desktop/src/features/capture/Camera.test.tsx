import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: Array<Uint8Array> = [];
const copied: Array<Uint8Array> = [];
let saveResult: () => Promise<string> = async () => "/home/k/Downloads/shot.png";
let copyResult: () => Promise<void> = async () => {};

vi.mock("../../platform", () => ({
  getPlatform: () => ({
    capture: {
      save: async (png: Uint8Array) => {
        saved.push(png);
        return saveResult();
      },
      copy: async (png: Uint8Array) => {
        copied.push(png);
        return copyResult();
      },
    },
  }),
}));

// jsdom decodes no SVG images and draws no canvases, so the renderer itself is
// verified against a real engine instead. What is worth testing here is the
// choice the person is offered and what it does.
let takeShot: () => Promise<Uint8Array> = async () => new Uint8Array([1, 2, 3]);
vi.mock("./capture", () => ({
  captureToPng: () => takeShot(),
}));

import { Camera } from "./Camera";

describe("the camera", () => {
  beforeEach(() => {
    saved.length = 0;
    copied.length = 0;
    saveResult = async () => "/home/k/Downloads/shot.png";
    copyResult = async () => {};
    takeShot = async () => new Uint8Array([1, 2, 3]);
    document.body.innerHTML = '<div class="shell"></div>';
  });

  it("offers nothing until a picture has been taken", () => {
    render(<Camera />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the picture first, then asks what to do with it", async () => {
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));

    // The shot is taken before the popover exists, so the popover is never in
    // the picture.
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("saves, and says where it went", async () => {
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(screen.getByText(/Saved to .*shot\.png/)).toBeTruthy();
  });

  it("copies without writing a file", async () => {
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(saved).toHaveLength(0);
    expect(screen.getByText(/Copied/)).toBeTruthy();
  });

  it("says so when the picture could not be taken", async () => {
    takeShot = async () => {
      throw new Error("the capture could not be rendered");
    };
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));

    expect(await screen.findByText("the capture could not be rendered")).toBeTruthy();
  });

  it("reports a refused clipboard rather than claiming success", async () => {
    copyResult = async () => {
      throw new Error("the capture could not be put on the clipboard");
    };
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));

    expect(
      await screen.findByText("the capture could not be put on the clipboard"),
    ).toBeTruthy();
  });

  it("closes on Escape", async () => {
    render(<Camera />);
    await userEvent.click(screen.getByLabelText("Take a picture of this window"));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
