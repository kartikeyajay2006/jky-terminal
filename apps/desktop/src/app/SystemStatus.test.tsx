import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemStatus, size, rateText, sparkPoints, netScale } from "./SystemStatus";
import { createWebPlatform, __setPlatformForTests } from "../platform";
import type { Platform, SystemReading } from "../platform/types";

const IDLE: SystemReading = {
  cpu_pct: 12.5,
  mem_used: 6_000_000_000,
  mem_total: 16_000_000_000,
  disk_used: 240_000_000_000,
  disk_total: 500_000_000_000,
  net_rx_bps: 1_200_000,
  net_tx_bps: 64_000,
};

function reading(next: () => SystemReading | Promise<never>): Platform {
  const base = createWebPlatform();
  return { ...base, system: { status: async () => next() as SystemReading } };
}

describe("size", () => {
  // A status bar has one line. "6.0 GB" fits; "6000000000 bytes" does not, and
  // neither does a number whose unit you have to work out.
  it("writes a byte count the way a person would say it", () => {
    expect(size(0)).toBe("0 B");
    expect(size(999)).toBe("999 B");
    expect(size(1024)).toBe("1.0 KB");
    expect(size(6_000_000_000)).toBe("5.6 GB");
    expect(size(2_000_000_000_000)).toBe("1.8 TB");
  });

  // Not a crash and not "NaN": a machine that reports no disk is a real
  // machine, and the bar has to draw something.
  it("survives a reading that is not a number", () => {
    expect(size(Number.NaN)).toBe("—");
    expect(size(-1)).toBe("—");
  });
});

describe("rateText", () => {
  it("writes a rate per second", () => {
    expect(rateText(0)).toBe("0 B/s");
    expect(rateText(1_200_000)).toBe("1.1 MB/s");
  });
});

describe("sparkPoints", () => {
  // The shape of the last minute is the thing a readout can show that a
  // single number cannot: 90% climbing and 90% falling are different facts.
  it("draws one point per reading, oldest on the left", () => {
    const points = sparkPoints([0, 50, 100], 100, 10, 100).split(" ");
    expect(points).toHaveLength(3);
    expect(points[0]).toBe("0,10");
    expect(points[2]).toBe("100,0");
  });

  it("puts a flat series on a flat line", () => {
    const points = sparkPoints([40, 40, 40], 90, 10, 100).split(" ");
    expect(new Set(points.map((p) => p.split(",")[1])).size).toBe(1);
  });

  // A reading above the scale is drawn at the top rather than above the box,
  // where it would be clipped or overlap the row above.
  it("keeps a reading larger than the scale inside the picture", () => {
    const points = sparkPoints([500], 100, 10, 100).split(" ");
    expect(points[0]).toBe("0,0");
  });

  it("draws nothing from no readings, rather than a stray dot", () => {
    expect(sparkPoints([], 100, 10, 100)).toBe("");
    expect(sparkPoints([12], 100, 10, 100)).toBe("0,9");
  });

  // A scale of zero would divide by nothing on a machine reporting no memory.
  it("survives a scale of zero", () => {
    expect(() => sparkPoints([1, 2], 100, 10, 0)).not.toThrow();
  });
});

describe("netScale", () => {
  /*
   * Network rates have no ceiling, so the picture has to scale to what it
   * has seen. Without a floor, a machine doing nothing draws its own noise as
   * a mountain range — 200 bytes a second becomes a full-height spike, and
   * the readout reports drama that is not happening.
   */
  it("does not amplify a quiet network into a mountain range", () => {
    expect(netScale([120, 400, 80])).toBeGreaterThanOrEqual(64 * 1024);
  });

  it("scales to the peak once there is real traffic", () => {
    expect(netScale([0, 5_000_000, 100])).toBe(5_000_000);
  });

  it("has a scale even with nothing to scale to", () => {
    expect(netScale([])).toBeGreaterThan(0);
  });
});

describe("SystemStatus", () => {
  beforeEach(() => {
    __setPlatformForTests(reading(() => IDLE));
  });
  afterEach(() => {
    __setPlatformForTests(null);
    vi.useRealTimers();
  });

  it("shows all four readings", async () => {
    render(<SystemStatus />);
    const box = await screen.findByRole("group", { name: /system/i });
    for (const label of ["CPU", "RAM", "Disk", "Net"]) {
      expect(within(box).getByText(label), `${label} is missing`).toBeInTheDocument();
    }
  });

  it("reports the processor as a percentage", async () => {
    render(<SystemStatus />);
    expect(await screen.findByText("13%")).toBeInTheDocument();
  });

  // "6.0 GB" alone does not say whether that is a lot. The total is what
  // makes the number mean something.
  it("reports memory and disk against what the machine has", async () => {
    render(<SystemStatus />);
    expect(await screen.findByText(/5\.6 GB \/ 14\.9 GB/)).toBeInTheDocument();
    expect(screen.getByText(/223\.5 GB \/ 465\.7 GB/)).toBeInTheDocument();
  });

  it("reports the network both ways", async () => {
    render(<SystemStatus />);
    const net = await screen.findByLabelText(/network/i);
    expect(net).toHaveTextContent(/1\.1 MB\/s/);
    expect(net).toHaveTextContent(/62\.5 KB\/s/);
  });

  /*
   * "Live and always working" is the requirement, so the test is that it
   * takes a second reading on its own. A component that fetched once and
   * stopped would pass every other test in this file.
   */
  it("keeps reading, rather than showing one reading for ever", async () => {
    vi.useFakeTimers();
    let calls = 0;
    __setPlatformForTests(
      reading(() => {
        calls += 1;
        return { ...IDLE, cpu_pct: calls === 1 ? 12.5 : 77 };
      }),
    );

    render(<SystemStatus />);
    await vi.waitFor(() => expect(screen.getByText("13%")).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(screen.getByText("77%")).toBeInTheDocument());
  });

  // A reading that fails is not a reason to tear a hole in the sidebar. It
  // keeps the last numbers it had and goes on asking.
  it("holds the last reading when one fails, and recovers", async () => {
    vi.useFakeTimers();
    let calls = 0;
    __setPlatformForTests(
      reading(() => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error("unavailable"));
        return { ...IDLE, cpu_pct: calls === 1 ? 12.5 : 44 };
      }),
    );

    render(<SystemStatus />);
    await vi.waitFor(() => expect(screen.getByText("13%")).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(2500);
    expect(screen.getByText("13%")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(screen.getByText("44%")).toBeInTheDocument());
  });

  // A timer left running after the component goes is a leak that fires into
  // nothing for the life of the app.
  it("stops reading when it goes away", async () => {
    vi.useFakeTimers();
    let calls = 0;
    __setPlatformForTests(
      reading(() => {
        calls += 1;
        return IDLE;
      }),
    );

    const view = render(<SystemStatus />);
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    view.unmount();
    const after = calls;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(after);
  });

  // The readout claims to be live; the sparkline is where that claim shows.
  it("draws the recent history, not only the latest number", async () => {
    vi.useFakeTimers();
    let calls = 0;
    __setPlatformForTests(
      reading(() => {
        calls += 1;
        return { ...IDLE, cpu_pct: calls * 7 };
      }),
    );

    const { container } = render(<SystemStatus />);
    await vi.waitFor(() => expect(container.querySelector(".sys__spark")).toBeTruthy());

    const pointsAfterOne = container.querySelector("polyline")?.getAttribute("points") ?? "";
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);

    const pointsAfterThree = container.querySelector("polyline")?.getAttribute("points") ?? "";
    expect(pointsAfterThree.split(" ").length).toBeGreaterThan(pointsAfterOne.split(" ").length);
  });

  // Unbounded history in a component that never unmounts is a slow leak.
  it("keeps the history bounded", async () => {
    vi.useFakeTimers();
    __setPlatformForTests(reading(() => IDLE));
    const { container } = render(<SystemStatus />);
    await vi.waitFor(() => expect(container.querySelector(".sys__spark")).toBeTruthy());

    for (let i = 0; i < 90; i += 1) await vi.advanceTimersByTimeAsync(2100);

    const points = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    expect(points.length).toBeLessThanOrEqual(60);
  });

  // The paste that started this had an up-arrow with nothing after it.
  it("always gives the network both a down and an up figure", async () => {
    render(<SystemStatus />);
    const net = await screen.findByLabelText(/network/i);
    const values = within(net).getAllByText(/\/s$/);
    expect(values).toHaveLength(2);
    for (const v of values) expect(v.textContent?.trim()).not.toBe("");
  });

  it("says so before the first reading arrives", () => {
    __setPlatformForTests(reading(() => new Promise<never>(() => {})));
    render(<SystemStatus />);
    expect(screen.getByRole("group", { name: /system/i })).toHaveTextContent(/reading|—/i);
  });
});

describe("the rail", () => {
  afterEach(() => __setPlatformForTests(null));

  // Asked for above Settings: it is a readout, not a destination, and the
  // bottom of the rail is where the things that are not destinations live.
  it("puts the readings above Settings", async () => {
    __setPlatformForTests(reading(() => IDLE));
    const { Rail } = await import("./Rail");
    const { container } = render(<Rail activeId="dashboard" onSelect={() => {}} />);

    await waitFor(() => expect(container.querySelector(".sys")).toBeTruthy());
    const sys = container.querySelector(".sys")!;
    const settings = screen.getByRole("button", { name: /settings/i });
    expect(sys.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
