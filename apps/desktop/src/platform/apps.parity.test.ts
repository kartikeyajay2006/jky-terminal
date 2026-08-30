import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";

/**
 * The browser mock and the native adapter have to offer the same apps API.
 *
 * Every UI test runs against the mock. If it drifts from the real one — a
 * method missing, a field renamed — the suite goes green against behaviour the
 * desktop app does not have, which is the failure this file exists to catch.
 *
 * The field names are also checked against the Rust structs directly, because
 * serde serialises them as written: rename a field in `jky-apps` and the panel
 * silently renders `undefined` with nothing failing anywhere else.
 */

const RUST_WEATHER = join(__dirname, "../../../../crates/jky-apps/src/weather.rs");
const RUST_NEWS = join(__dirname, "../../../../crates/jky-apps/src/feeds.rs");

/** Both modules concatenated: a struct is looked up by name across them. */
function rustSource(): string {
  return readFileSync(RUST_WEATHER, "utf8") + readFileSync(RUST_NEWS, "utf8");
}

/** The fields declared on one `pub struct` in the Rust source. */
function fieldsOf(struct: string): string[] {
  const source = rustSource();
  const start = source.indexOf(`pub struct ${struct} {`);
  if (start === -1) throw new Error(`no struct ${struct} in weather.rs`);
  const body = source.slice(start, source.indexOf("\n}", start));
  return [...body.matchAll(/^\s{4}pub ([a-z_0-9]+):/gm)].map((m) => m[1]);
}

describe("apps adapter parity", () => {
  const web = createWebPlatform();

  it("the mock offers the whole apps surface", () => {
    expect(typeof web.apps.weather).toBe("function");
    expect(typeof web.apps.searchPlaces).toBe("function");
  });

  it("the mock returns a report shaped like the real one", async () => {
    const report = await web.apps.weather(28.65, 77.23);
    for (const field of fieldsOf("Conditions")) {
      expect(report.now, `Conditions.${field} is missing from the mock`).toHaveProperty(field);
    }
    for (const field of fieldsOf("Report")) {
      expect(report, `Report.${field} is missing from the mock`).toHaveProperty(field);
    }
    expect(report.days.length).toBeGreaterThan(0);
    for (const field of fieldsOf("DayOutlook")) {
      expect(report.days[0], `DayOutlook.${field} is missing`).toHaveProperty(field);
    }
  });

  it("the mock returns places shaped like the real ones", async () => {
    const places = await web.apps.searchPlaces("Delhi");
    expect(places.length).toBeGreaterThan(0);
    for (const field of fieldsOf("Place")) {
      expect(places[0], `Place.${field} is missing from the mock`).toHaveProperty(field);
    }
  });

  // The panel reads these names off the object serde produced. A Rust field
  // renamed without the TypeScript following would render as undefined, and
  // nothing else in the suite would notice.
  it("names every Rust field the same way in TypeScript", () => {
    expect(fieldsOf("Conditions")).toEqual([
      "temperature_c",
      "feels_like_c",
      "humidity_pct",
      "wind_kph",
      "code",
      "description",
      "is_day",
      "observed_at",
    ]);
    expect(fieldsOf("DayOutlook")).toEqual([
      "date",
      "code",
      "description",
      "high_c",
      "low_c",
    ]);
    expect(fieldsOf("Report")).toEqual(["now", "days", "timezone"]);
    expect(fieldsOf("Place")).toEqual([
      "name",
      "country",
      "region",
      "latitude",
      "longitude",
      "timezone",
    ]);
  });

  it("the mock returns articles shaped like the real ones", async () => {
    const articles = await web.apps.news(null, 3);
    expect(articles.length).toBeGreaterThan(0);
    for (const field of fieldsOf("Article")) {
      expect(articles[0], `Article.${field} is missing from the mock`).toHaveProperty(field);
    }
  });

  it("the mock returns sources shaped like the real ones", async () => {
    const sources = await web.apps.newsSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const field of fieldsOf("Source")) {
      expect(sources[0], `Source.${field} is missing from the mock`).toHaveProperty(field);
    }
  });

  it("names every news field the same way in TypeScript", () => {
    expect(fieldsOf("Article")).toEqual([
      "title",
      "link",
      "summary",
      "category",
      "published",
      "source_id",
      "source_name",
      "host",
    ]);
    expect(fieldsOf("Source")).toEqual(["id", "name", "region", "url"]);
  });

  it("refuses a headline count the backend would refuse", async () => {
    await expect(web.apps.news(null, 0)).rejects.toThrow();
  });

  it("refuses a paper the backend does not have", async () => {
    await expect(web.apps.news("not-a-paper", 3)).rejects.toThrow();
  });

  it("refuses a search the backend would refuse", async () => {
    await expect(web.apps.searchPlaces("   ")).rejects.toThrow();
  });
});
