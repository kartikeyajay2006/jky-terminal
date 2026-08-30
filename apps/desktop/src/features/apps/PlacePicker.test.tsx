import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacePicker } from "./PlacePicker";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import type { Place, Platform } from "../../platform/types";

function platformWith(overrides: Partial<Platform["apps"]>): Platform {
  const base = createWebPlatform();
  return { ...base, apps: { ...base.apps, ...overrides } };
}

function place(name: string, lat = 1, lon = 2): Place {
  return { name, country: "Testland", region: null, latitude: lat, longitude: lon, timezone: null };
}

/** Instant typing: the debounce is what is under test, not keystroke pacing. */
const typist = () => userEvent.setup({ delay: null });

const box = () => screen.getByRole("textbox", { name: /place/i });

describe("PlacePicker", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  it("asks the question it was given", () => {
    render(<PlacePicker prompt="Where are you?" onChoose={() => {}} />);
    expect(screen.getByText("Where are you?")).toBeInTheDocument();
  });

  // The old picker only searched when the button was pressed, which meant
  // typing a name and waiting produced nothing at all.
  it("searches as you type, without pressing anything", async () => {
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "Delhi");
    expect(await screen.findByRole("button", { name: /sample city/i })).toBeInTheDocument();
  });

  it("makes one request for a word typed quickly, not one per letter", async () => {
    let calls = 0;
    __setPlatformForTests(
      platformWith({
        searchPlaces: async (q) => {
          calls += 1;
          return [place(`for ${q}`)];
        },
      }),
    );
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "Bengaluru");

    await screen.findByRole("button", { name: /for bengaluru/i });
    expect(calls).toBe(1);
  });

  // One letter matches most of the world. Searching on it spends a request to
  // return nothing anyone wanted.
  it("waits for more than a single letter", async () => {
    let calls = 0;
    __setPlatformForTests(
      platformWith({
        searchPlaces: async () => {
          calls += 1;
          return [];
        },
      }),
    );
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "D");

    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toBe(0);
  });

  // Replies can arrive out of order. Showing whichever landed last would put
  // results for an older query under a newer one.
  it("ignores a slow reply that a newer search has overtaken", async () => {
    __setPlatformForTests(
      platformWith({
        searchPlaces: async (q) => {
          if (q === "slow") {
            await new Promise((r) => setTimeout(r, 300));
            return [place("STALE")];
          }
          return [place("FRESH")];
        },
      }),
    );
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);

    await user.type(box(), "slow");
    await user.clear(box());
    await user.type(box(), "fast");

    await screen.findByRole("button", { name: /fresh/i });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("button", { name: /stale/i })).not.toBeInTheDocument();
  });

  it("hands back the place that was chosen", async () => {
    const chosen: Place[] = [];
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={(p) => chosen.push(p)} />);
    await user.type(box(), "Delhi");
    await user.click(await screen.findByRole("button", { name: /sample city/i }));
    expect(chosen).toHaveLength(1);
    expect(chosen[0].name).toBe("Sample City");
  });

  it("says when nothing matched", async () => {
    __setPlatformForTests(platformWith({ searchPlaces: async () => [] }));
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "Nowhere");
    expect(await screen.findByText(/no.*place by that name/i)).toBeInTheDocument();
  });

  it("says so when the search fails", async () => {
    __setPlatformForTests(
      platformWith({
        searchPlaces: async () => {
          throw new Error("could not reach the location service");
        },
      }),
    );
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "Delhi");
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });

  it("clears the results when the box is emptied", async () => {
    const user = typist();
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    await user.type(box(), "Delhi");
    await screen.findByRole("button", { name: /sample city/i });

    await user.clear(box());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /sample city/i })).not.toBeInTheDocument(),
    );
  });

  describe("use my location", () => {
    it("offers to work out where you are", () => {
      render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
      expect(screen.getByRole("button", { name: /use my location/i })).toBeInTheDocument();
    });

    it("chooses the place it found", async () => {
      const chosen: Place[] = [];
      const user = typist();
      render(<PlacePicker prompt="Where?" onChoose={(p) => chosen.push(p)} />);
      await user.click(screen.getByRole("button", { name: /use my location/i }));
      await waitFor(() => expect(chosen).toHaveLength(1));
      expect(chosen[0].name).toBe("Sample City");
    });

    it("says so when it cannot work out where you are", async () => {
      __setPlatformForTests(
        platformWith({
          locate: async () => {
            throw new Error("your location could not be worked out");
          },
        }),
      );
      const user = typist();
      render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
      await user.click(screen.getByRole("button", { name: /use my location/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not be worked out/i);
    });

    // A lookup that goes to the network needs to say it is working, or the
    // button reads as broken for however long it takes.
    it("says it is looking while it works", async () => {
      let release: () => void = () => {};
      __setPlatformForTests(
        platformWith({
          locate: async () => {
            await new Promise<void>((r) => {
              release = r;
            });
            return place("Found");
          },
        }),
      );
      const user = typist();
      render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
      await user.click(screen.getByRole("button", { name: /use my location/i }));
      expect(await screen.findByRole("button", { name: /locating/i })).toBeDisabled();
      release();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("PlacePicker recents", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  it("offers places it was given to show again", async () => {
    const user = typist();
    const recents = [place("Bengaluru"), place("Chennai", 3, 4)];
    const chosen: Place[] = [];
    render(
      <PlacePicker prompt="Where?" recents={recents} onChoose={(p) => chosen.push(p)} />,
    );

    const list = screen.getByRole("list", { name: /recent places/i });
    expect(within(list).getByText("Bengaluru")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /chennai/i }));
    expect(chosen[0].name).toBe("Chennai");
  });

  it("shows no recent list when there are none", () => {
    render(<PlacePicker prompt="Where?" onChoose={() => {}} />);
    expect(screen.queryByRole("list", { name: /recent places/i })).not.toBeInTheDocument();
  });
});
