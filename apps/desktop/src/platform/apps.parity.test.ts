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
const RUST_GMAIL = join(__dirname, "../../../../crates/jky-apps/src/gmail.rs");

/** Both modules concatenated: a struct is looked up by name across them. */
function rustSource(): string {
  return [RUST_WEATHER, RUST_NEWS, RUST_PLACES, RUST_ROUTES, RUST_GITHUB, RUST_GMAIL]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

/**
 * The fields declared on one `pub struct` in the Rust source.
 *
 * A name that appears twice is refused rather than resolved to whichever
 * module happens to be listed first. Two modules did both want to call their
 * account type `Profile`, and this checker would have gone on asserting
 * GitHub's fields while the panel read Gmail's — a green suite over a panel
 * showing nothing.
 */
function fieldsOf(struct: string): string[] {
  const source = rustSource();
  const needle = `pub struct ${struct} {`;
  const at = [...source.matchAll(new RegExp(needle.replace(/[{]/g, "\\{"), "g"))].map(
    (m) => m.index ?? -1,
  );
  if (at.length === 0) throw new Error(`no struct ${struct} in the apps crate`);
  if (at.length > 1) {
    throw new Error(
      `${at.length} structs are named ${struct}; rename one, or this checks the wrong fields`,
    );
  }
  const body = source.slice(at[0], source.indexOf("\n}", at[0]));
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

  describe("gmail", () => {
    // A fresh platform per test: connecting mutates the mock, and a shared one
    // would make these pass or fail on the order they happen to run in.
    const mail = () => createWebPlatform().apps.gmail;
    const CLIENT = "812345678901-preview.apps.googleusercontent.com";

    async function signedIn() {
      const gmail = mail();
      await gmail.setClientId(CLIENT);
      await gmail.connect();
      return gmail;
    }

    it("the mock offers the whole gmail surface", () => {
      for (const call of ["status", "setClientId", "connect", "disconnect", "inbox"] as const) {
        expect(typeof mail()[call], `gmail.${call} is missing`).toBe("function");
      }
    });

    it("names every gmail field the same way in TypeScript", () => {
      expect(fieldsOf("Account")).toEqual(["address", "messages_total"]);
      expect(fieldsOf("Message")).toEqual([
        "id",
        "thread_id",
        "from_name",
        "from_address",
        "subject",
        "snippet",
        "received_ms",
        "unread",
      ]);
    });

    // No Google client id ships with the app, so a fresh install is not
    // merely signed out — there is nothing yet to sign in against, and the
    // panel has to be able to tell those two states apart.
    it("starts unconfigured, because no client id ships", async () => {
      expect(await mail().status()).toEqual({ configured: false, connected: false });
    });

    it("cannot sign in before it has been told which client to use", async () => {
      await expect(mail().connect()).rejects.toThrow();
    });

    it("reports itself connected once it is", async () => {
      const gmail = await signedIn();
      expect(await gmail.status()).toEqual({ configured: true, connected: true });
    });

    it("the mock returns a mailbox shaped like the real one", async () => {
      const mailbox = await (await signedIn()).inbox(10, null);
      for (const field of fieldsOf("Account")) {
        expect(mailbox.account, `Account.${field} is missing`).toHaveProperty(field);
      }
      expect(mailbox.messages.length).toBeGreaterThan(0);
      for (const field of fieldsOf("Message")) {
        expect(mailbox.messages[0], `Message.${field} is missing`).toHaveProperty(field);
      }
    });

    it("refuses to read a mailbox nobody has signed in to", async () => {
      await expect(mail().inbox(10, null)).rejects.toThrow();
    });

    // Signing out has to actually sign out, or the panel keeps showing a
    // mailbox belonging to an account the person just disconnected.
    it("stops reading the mailbox after signing out", async () => {
      const gmail = await signedIn();
      await gmail.disconnect();
      expect((await gmail.status()).connected).toBe(false);
      await expect(gmail.inbox(10, null)).rejects.toThrow();
    });

    it("searches rather than listing when given a query", async () => {
      const gmail = await signedIn();
      const found = await gmail.inbox(10, "deploy");
      expect(found.messages.length).toBeGreaterThan(0);
      for (const message of found.messages) {
        const haystack = `${message.subject} ${message.snippet} ${message.from_name}`;
        expect(haystack.toLowerCase()).toContain("deploy");
      }
    });
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
      expect(fieldsOf("Profile")).toEqual([
        "login",
        "name",
        "bio",
        "avatar_url",
        "html_url",
        "public_repos",
        "followers",
        "following",
      ]);
      expect(fieldsOf("Activity")).toEqual([
        "id",
        "verb",
        "repo",
        "detail",
        "html_url",
        "at",
      ]);
      expect(fieldsOf("Contributions")).toEqual(["total", "weeks"]);
      expect(fieldsOf("ContribDay")).toEqual(["date", "count", "level"]);
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
      expect(fieldsOf("Summary")).toEqual([
        "user",
        "repos",
        "issues",
        "pulls",
        "notifications",
        "activity",
        "stars_received",
        "contributions",
      ]);
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
