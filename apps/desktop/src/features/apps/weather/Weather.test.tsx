import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Weather, conditionGlyph } from "./Weather";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { Platform } from "../../../platform/types";

const PLACE_KEY = "jky.apps.weather.place";

/** The browser mock, with individual calls swapped out per test. */
function platformWith(overrides: Partial<Platform["apps"]>): Platform {
  const base = createWebPlatform();
  return { ...base, apps: { ...base.apps, ...overrides } };
}

// The picker searches as you type; there is no button to press.
async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  await user.type(screen.getByRole("textbox", { name: /place/i }), term);
}

/** Instant typing, so the debounce is the only wait in these tests. */
const typist = () => userEvent.setup({ delay: null });

/** Type a name and take the first match. */
async function pick(user: ReturnType<typeof userEvent.setup>) {
  await search(user, "Delhi");
  await user.click(await screen.findByRole("button", { name: /sample city/i }));
}

describe("Weather", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    localStorage.clear();
  });
  afterEach(() => {
    __setPlatformForTests(null);
    localStorage.clear();
  });

  it("asks where you are before it has a place", () => {
    render(<Weather />);
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
    expect(screen.queryByText(/feels like/i)).not.toBeInTheDocument();
  });

  it("lists what a search found", async () => {
    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    expect(await screen.findByRole("button", { name: /sample city/i })).toBeInTheDocument();
  });

  it("shows the weather once a place is chosen", async () => {
    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    const now = await screen.findByRole("region", { name: /current conditions/i });
    expect(within(now).getByText("21°")).toBeInTheDocument();
    expect(within(now).getByText(/overcast/i)).toBeInTheDocument();
    expect(within(now).getByText(/feels like/i)).toBeInTheDocument();
  });

  it("shows the days ahead", async () => {
    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    const outlook = await screen.findByRole("list", { name: /outlook/i });
    expect(within(outlook).getAllByRole("listitem")).toHaveLength(4);
  });

  it("remembers the place across a remount", async () => {
    const user = typist();
    const first = render(<Weather />);
    await search(user, "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    await screen.findByRole("region", { name: /current conditions/i });
    first.unmount();

    render(<Weather />);
    expect(await screen.findByRole("region", { name: /current conditions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sample city/i })).toBeInTheDocument();
  });

  it("lets the place be changed again", async () => {
    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    await screen.findByRole("region", { name: /current conditions/i });

    await user.click(screen.getByRole("button", { name: /change place/i }));
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
  });

  it("says when a search found nowhere", async () => {
    __setPlatformForTests(platformWith({ searchPlaces: async () => [] }));
    const user = typist();
    render(<Weather />);
    await search(user, "Nowhere");
    expect(await screen.findByText(/no.*place by that name/i)).toBeInTheDocument();
  });

  it("says so when the search itself fails", async () => {
    __setPlatformForTests(
      platformWith({
        searchPlaces: async () => {
          throw new Error("could not reach the weather service: offline");
        },
      }),
    );
    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
  });

  // A panel that fails to a blank space looks broken rather than unlucky, and
  // leaves no way back other than reopening the app.
  it("offers a retry when the forecast could not be fetched", async () => {
    let attempts = 0;
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        weather: async (lat, lon) => {
          attempts += 1;
          if (attempts === 1) throw new Error("the weather service answered with status 503");
          return base.apps.weather(lat, lon);
        },
      }),
    );

    const user = typist();
    render(<Weather />);
    await search(user, "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/503/);
    // The failed reading must not still be on screen under the error: a stale
    // temperature beside a failure notice reads as though it were current.
    expect(screen.queryByRole("region", { name: /current conditions/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("region", { name: /current conditions/i })).toBeInTheDocument();
  });

  it("does not ask again for a place it already has stored", async () => {
    localStorage.setItem(
      PLACE_KEY,
      JSON.stringify({
        name: "Stored City",
        country: "Preview",
        region: null,
        latitude: 1,
        longitude: 2,
        timezone: "UTC",
      }),
    );
    render(<Weather />);
    expect(await screen.findByText(/stored city/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /place/i })).not.toBeInTheDocument();
  });

  // Storage holds whatever was last written there, including something an
  // older version wrote or a person edited by hand.
  // The user asked for two ways in: where you are, and where you have been.
  it("offers a place you looked at before, without searching again", async () => {
    const user = typist();
    render(<Weather />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));

    const recents = screen.getByRole("list", { name: /recent places/i });
    expect(within(recents).getByText(/sample city/i)).toBeInTheDocument();
  });

  it("keeps the recent list even after the current place is cleared", async () => {
    const user = typist();
    render(<Weather />);
    await pick(user);
    await user.click(screen.getByRole("button", { name: /change place/i }));
    expect(localStorage.getItem("jky.apps.weather.recents")).toContain("Sample City");
  });

  it("offers to work out where you are", () => {
    render(<Weather />);
    expect(screen.getByRole("button", { name: /use my location/i })).toBeInTheDocument();
  });

  it("falls back to asking when the stored place is nonsense", async () => {
    localStorage.setItem(PLACE_KEY, "{{{not json");
    render(<Weather />);
    expect(screen.getByRole("textbox", { name: /place/i })).toBeInTheDocument();
  });
});

describe("conditionGlyph", () => {
  // The words come from Rust so there is one WMO table; this is only a mark
  // beside them, so it maps ranges rather than restating that table.
  it("marks clear sky differently by day and by night", () => {
    expect(conditionGlyph(0, true)).not.toBe(conditionGlyph(0, false));
  });

  it("gives rain, snow and storms their own marks", () => {
    const rain = conditionGlyph(63, true);
    const snow = conditionGlyph(73, true);
    const storm = conditionGlyph(95, true);
    expect(new Set([rain, snow, storm]).size).toBe(3);
  });

  it("groups drizzle with rain rather than inventing a mark for it", () => {
    expect(conditionGlyph(53, true)).toBe(conditionGlyph(63, true));
  });

  // The WMO table has gaps, and a blank where the weather should be reads as
  // a broken panel rather than an unknown code.
  it("always returns something, even for a code it does not know", () => {
    expect(conditionGlyph(200, true).trim()).not.toBe("");
  });
});
