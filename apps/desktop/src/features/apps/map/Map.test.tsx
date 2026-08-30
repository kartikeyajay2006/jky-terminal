import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapApp, embedUrl, boxAround, describeDistance, describeDuration } from "./Map";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";

const PLACE_KEY = "jky.apps.map.place";

function frame() {
  return screen.getByTitle(/map of/i) as HTMLIFrameElement;
}

/** Instant typing, so the picker's debounce is the only wait here. */
const typist = () => userEvent.setup({ delay: null });

// The picker searches as you type; there is no button to press.
async function pick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: /place/i }), "Delhi");
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

describe("boxAround", () => {
  it("contains both points", () => {
    const { west, south, east, north } = boxAround(
      { lat: 10, lon: 20 },
      { lat: 30, lon: 40 },
    );
    expect(west).toBeLessThanOrEqual(20);
    expect(east).toBeGreaterThanOrEqual(40);
    expect(south).toBeLessThanOrEqual(10);
    expect(north).toBeGreaterThanOrEqual(30);
  });

  // Two points on the same line would otherwise give a box with no height or
  // no width, which the tile server cannot draw.
  it("still has area when both points share a latitude", () => {
    const { south, north } = boxAround({ lat: 10, lon: 20 }, { lat: 10, lon: 40 });
    expect(north).toBeGreaterThan(south);
  });

  it("still has area when both points are the same place", () => {
    const box = boxAround({ lat: 10, lon: 20 }, { lat: 10, lon: 20 });
    expect(box.east).toBeGreaterThan(box.west);
    expect(box.north).toBeGreaterThan(box.south);
  });

  it("stays on the map at the poles", () => {
    const { north, south } = boxAround({ lat: 89.9, lon: 0 }, { lat: 89.95, lon: 1 });
    expect(north).toBeLessThanOrEqual(90);
    expect(south).toBeGreaterThanOrEqual(-90);
  });
});

describe("describeDistance", () => {
  it("uses metres below a kilometre, because 0.4 km is not how anyone says it", () => {
    expect(describeDistance(420)).toBe("420 m");
  });

  it("uses one decimal place under ten kilometres", () => {
    expect(describeDistance(4_200)).toBe("4.2 km");
  });

  it("drops the decimal once the number is large enough not to need it", () => {
    expect(describeDistance(1_988_772)).toBe("1,989 km");
  });
});

describe("describeDuration", () => {
  it("reads minutes under an hour", () => {
    expect(describeDuration(1_800)).toBe("30 min");
  });

  it("reads hours and minutes together", () => {
    expect(describeDuration(86_168)).toBe("23 h 56 min");
  });

  it("says less than a minute rather than zero", () => {
    expect(describeDuration(20)).toBe("under a minute");
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
    const user = typist();
    render(<MapApp />);
    await pick(user);
    expect(frame().src).toContain("openstreetmap.org/export/embed.html");
  });

  // The frame is a whole other origin rendering inside the app window, so it
  // gets the narrowest sandbox that still lets a map work, and no referrer.
  it("sandboxes the frame and sends no referrer", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    expect(frame()).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame()).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("names the frame so it is not an unlabelled box", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    expect(frame().title).toMatch(/sample city/i);
  });

  it("zooms in and out", async () => {
    const user = typist();
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
    const user = typist();
    const first = render(<MapApp />);
    await pick(user);
    first.unmount();

    render(<MapApp />);
    expect(frame().src).toContain("openstreetmap.org");
  });

  it("lets the place be changed again", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
  });

  // The user asked for two ways in: where you are, and where you have been.
  it("offers a place you looked at before, without searching again", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));

    const recents = screen.getByRole("list", { name: /recent places/i });
    expect(within(recents).getByText(/sample city/i)).toBeInTheDocument();
  });

  it("keeps the recent list even after the current place is cleared", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));
    expect(localStorage.getItem("jky.apps.map.recents")).toContain("Sample City");
  });

  it("offers to work out where you are", () => {
    render(<MapApp />);
    expect(screen.getByRole("button", { name: /use my location/i })).toBeInTheDocument();
  });

  it("asks for a destination once a starting point is set", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    expect(screen.getByRole("button", { name: /add a destination/i })).toBeInTheDocument();
  });

  it("shows the distance and the driving time once both ends are set", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /add a destination/i }));
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Agra");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));

    const trip = await screen.findByRole("status", { name: /distance/i });
    expect(within(trip).getByText(/1,989 km/)).toBeInTheDocument();
    expect(within(trip).getByText(/23 h 56 min/)).toBeInTheDocument();
  });

  it("shows the straight-line distance as well, since it is always true", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /add a destination/i }));
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Agra");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));

    const trip = await screen.findByRole("status", { name: /distance/i });
    expect(within(trip).getByText(/1,553 km/)).toBeInTheDocument();
  });

  // A road route is not always available. The straight line still is, so the
  // panel must say what it knows rather than nothing at all.
  it("still gives the straight line when there is no road route", async () => {
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      apps: {
        ...base.apps,
        route: async () => ({ straight_m: 500_000, road_m: null, duration_s: null }),
      },
    });
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /add a destination/i }));
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Agra");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));

    const trip = await screen.findByRole("status", { name: /distance/i });
    expect(within(trip).getByText(/500 km/)).toBeInTheDocument();
    expect(within(trip).getByText(/no road route/i)).toBeInTheDocument();
  });

  it("swaps the two ends round", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /add a destination/i }));
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Agra");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    await screen.findByRole("status", { name: /distance/i });

    await user.click(screen.getByRole("button", { name: /swap/i }));
    expect(screen.getByRole("status", { name: /distance/i })).toBeInTheDocument();
  });

  it("drops the destination and goes back to one place", async () => {
    const user = typist();
    render(<MapApp />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /add a destination/i }));
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Agra");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    await screen.findByRole("status", { name: /distance/i });

    await user.click(screen.getByRole("button", { name: /clear destination/i }));
    expect(screen.queryByRole("status", { name: /distance/i })).not.toBeInTheDocument();
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
    const user = typist();
    render(<MapApp />);
    await user.type(screen.getByRole("textbox", { name: /place/i }), "Delhi");
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });
});
