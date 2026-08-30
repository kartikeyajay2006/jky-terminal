import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapApp, embedUrl } from "./Map";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";

const PLACE_KEY = "jky.apps.map.place";

function frame() {
  return screen.getByTitle(/map of/i) as HTMLIFrameElement;
}

async function pick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: /place/i }), "Delhi");
  await user.click(screen.getByRole("button", { name: /^search$/i }));
  await user.click(await screen.findByRole("button", { name: /sample city/i }));
}

describe("embedUrl", () => {
  it("points at OpenStreetMap's own embed endpoint", () => {
    // The only endpoint measured to carry no framing restriction; the main
    // site sends X-Frame-Options: SAMEORIGIN and cannot be embedded.
    expect(embedUrl(0, 0, 1)).toContain("https://www.openstreetmap.org/export/embed.html");
  });

  it("centres the box on the coordinate and marks it", () => {
    const url = new URL(embedUrl(51.5, -0.12, 0.1));
    expect(url.searchParams.get("marker")).toBe("51.5,-0.12");
    const [west, south, east, north] = url.searchParams.get("bbox")!.split(",").map(Number);
    expect((west + east) / 2).toBeCloseTo(-0.12, 5);
    expect((south + north) / 2).toBeCloseTo(51.5, 5);
  });

  it("draws a wider box for a wider span", () => {
    const near = new URL(embedUrl(0, 0, 0.05)).searchParams.get("bbox")!.split(",").map(Number);
    const far = new URL(embedUrl(0, 0, 2)).searchParams.get("bbox")!.split(",").map(Number);
    expect(far[2] - far[0]).toBeGreaterThan(near[2] - near[0]);
  });

  // A box that runs off the end of the world is not a box the tile server can
  // serve, and it renders as a blank frame rather than an error.
  it("keeps the box on the map at the poles", () => {
    const [, south, , north] = new URL(embedUrl(89.9, 0, 10))
      .searchParams.get("bbox")!
      .split(",")
      .map(Number);
    expect(north).toBeLessThanOrEqual(90);
    expect(south).toBeGreaterThanOrEqual(-90);
  });

  it("keeps the box on the map at the antimeridian", () => {
    const [west, , east] = new URL(embedUrl(0, 179.9, 10))
      .searchParams.get("bbox")!
      .split(",")
      .map(Number);
    expect(east).toBeLessThanOrEqual(180);
    expect(west).toBeGreaterThanOrEqual(-180);
  });
});

describe("Map", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    localStorage.clear();
  });
  afterEach(() => {
    __setPlatformForTests(null);
    localStorage.clear();
  });

  it("asks for a place before it shows a map", () => {
    render(<MapApp />);
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
    expect(screen.queryByTitle(/map of/i)).not.toBeInTheDocument();
  });

  it("shows the map once a place is chosen", async () => {
    const user = userEvent.setup();
    render(<MapApp />);
    await pick(user);
    expect(frame().src).toContain("openstreetmap.org/export/embed.html");
  });

  // The frame is a whole other origin rendering inside the app window, so it
  // gets the narrowest sandbox that still lets a map work, and no referrer.
  it("sandboxes the frame and sends no referrer", async () => {
    const user = userEvent.setup();
    render(<MapApp />);
    await pick(user);
    expect(frame()).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame()).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("names the frame so it is not an unlabelled box", async () => {
    const user = userEvent.setup();
    render(<MapApp />);
    await pick(user);
    expect(frame().title).toMatch(/sample city/i);
  });

  it("zooms in and out", async () => {
    const user = userEvent.setup();
    render(<MapApp />);
    await pick(user);

    const width = () => {
      const box = new URL(frame().src).searchParams.get("bbox")!.split(",").map(Number);
      return box[2] - box[0];
    };
    const before = width();
    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(width()).toBeLessThan(before);

    await user.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(width()).toBeCloseTo(before, 6);
  });

  it("remembers the place across a remount", async () => {
    const user = userEvent.setup();
    const first = render(<MapApp />);
    await pick(user);
    first.unmount();

    render(<MapApp />);
    expect(frame().src).toContain("openstreetmap.org");
  });

  it("lets the place be changed again", async () => {
    const user = userEvent.setup();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
  });

  it("falls back to asking when the stored place is nonsense", () => {
    localStorage.setItem(PLACE_KEY, "{{{not json");
    render(<MapApp />);
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
  });

  it("says so when the search fails", async () => {
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      apps: {
        ...base.apps,
        searchPlaces: async () => {
          throw new Error("could not reach the search service");
        },
      },
    });
    const user = userEvent.setup();
    render(<MapApp />);
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Delhi");
    await user.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });
});
