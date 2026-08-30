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
const RUST_PLACES = join(__dirname, "../../../../crates/jky-apps/src/places.rs");
const RUST_ROUTES = join(__dirname, "../../../../crates/jky-apps/src/routes.rs");
const RUST_GITHUB = join(__dirname, "../../../../crates/jky-apps/src/github.rs");

/** Both modules concatenated: a struct is looked up by name across them. */
function rustSource(): string {
  return [RUST_WEATHER, RUST_NEWS, RUST_PLACES, RUST_ROUTES, RUST_GITHUB]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
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

  it("the mock locates a place shaped like the real one", async () => {
    const here = await web.apps.locate();
    for (const field of fieldsOf("Place")) {
      expect(here, `Place.${field} is missing from the mock`).toHaveProperty(field);
    }
  });

  it("the mock returns a route shaped like the real one", async () => {
    const here = await web.apps.locate();
    const route = await web.apps.route(here, here);
    for (const field of fieldsOf("Route")) {
      expect(route, `Route.${field} is missing from the mock`).toHaveProperty(field);
    }
  });

  it("names every route field the same way in TypeScript", () => {
    expect(fieldsOf("Route")).toEqual(["straight_m", "road_m", "duration_s"]);
  });

  describe("github", () => {
    it("the mock offers the whole github surface", () => {
      for (const call of [
        "status",
        "setClientId",
        "connectStart",
        "connectPoll",
        "disconnect",
        "summary",
      ] as const) {
        expect(typeof web.apps.github[call], `github.${call} is missing`).toBe("function");
      }
    });

    it("names every github field the same way in TypeScript", () => {
      expect(fieldsOf("DeviceStart")).toEqual([
        "user_code",
        "verification_uri",
        "interval_s",
        "expires_in_s",
      ]);
      expect(fieldsOf("User")).toEqual(["login", "name", "avatar_url", "html_url"]);
      expect(fieldsOf("Repo")).toEqual([
        "name",
        "full_name",
        "private",
        "html_url",
        "description",
        "language",
        "stars",
        "open_issues",
        "updated_at",
      ]);
      expect(fieldsOf("Item")).toEqual([
        "number",
        "title",
        "html_url",
        "state",
        "repo",
        "is_pull_request",
        "draft",
      ]);
      expect(fieldsOf("Summary")).toEqual(["user", "repos", "issues", "pulls"]);
    });

    // The one field that must never exist on the way out. The device code
    // redeems the token, and a rename that added it here would be the bug
    // this whole split exists to prevent.
    it("never puts a device code in what the window receives", async () => {
      await web.apps.github.setClientId("Iv23liPREVIEW");
      const start = await web.apps.github.connectStart();
      expect(Object.keys(start)).not.toContain("device_code");
      expect(JSON.stringify(start)).not.toMatch(/device_code/i);
      expect(fieldsOf("DeviceStart")).not.toContain("device_code");
    });

    it("the mock returns a summary shaped like the real one", async () => {
      await web.apps.github.setClientId("Iv23liPREVIEW");
      await web.apps.github.connectStart();
      await web.apps.github.connectPoll();
      await web.apps.github.connectPoll();

      const summary = await web.apps.github.summary();
      for (const field of fieldsOf("Summary")) {
        expect(summary, `Summary.${field} is missing`).toHaveProperty(field);
      }
      for (const field of fieldsOf("Repo")) {
        expect(summary.repos[0], `Repo.${field} is missing`).toHaveProperty(field);
      }
      for (const field of fieldsOf("Item")) {
        expect(summary.pulls[0], `Item.${field} is missing`).toHaveProperty(field);
      }
      await web.apps.github.disconnect();
    });

    it("refuses a summary when nothing is connected", async () => {
      await expect(web.apps.github.summary()).rejects.toThrow();
    });
  });

  it("refuses a search the backend would refuse", async () => {
    await expect(web.apps.searchPlaces("   ")).rejects.toThrow();
  });
});
