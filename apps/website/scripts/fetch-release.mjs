#!/usr/bin/env node
/**
 * Writes the latest published release — its tag, date and every asset with
 * its size — to src/data/release.json, which the download section is built
 * from.
 *
 * Done at build time, not in the visitor's browser: the site's own CSP says
 * `connect-src 'self'`, exactly like the app's, so the page could not ask
 * GitHub anything even if it wanted to. The Pages workflow runs this before
 * every build and again whenever a release is published, so the sizes on the
 * page are the sizes of the files you would download.
 *
 * The committed release.json is the fallback for a build with no network;
 * a failed fetch keeps it rather than writing an empty one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "kartikeyajay2006/jky-terminal";
const OUT = join("src", "data", "release.json");

const headers = { Accept: "application/vnd.github+json", "User-Agent": "jky-website-build" };
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
if (!res.ok) {
  console.error(`release:fetch: GitHub answered ${res.status}; keeping the committed release.json`);
  process.exit(process.env.CI ? 1 : 0);
}

const release = await res.json();
const data = {
  tag: release.tag_name,
  name: release.name,
  publishedAt: release.published_at,
  url: release.html_url,
  assets: release.assets
    .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
    .sort((a, b) => a.name.localeCompare(b.name)),
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log(`release:fetch: ${data.tag}, ${data.assets.length} assets → ${OUT}`);
