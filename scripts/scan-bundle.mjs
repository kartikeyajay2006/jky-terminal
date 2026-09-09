#!/usr/bin/env node
/**
 * Two checks on what the build actually produced.
 *
 * The first fails on anything shaped like a credential, which implements the
 * third assertion of spec §4.3 and guards against a real and easy mistake:
 * hard-coding a key while debugging and shipping it to every user.
 *
 * The second fails when the bundle everyone downloads grows past its budget.
 * That budget used to be a sentence in the README, which is a promise with
 * nothing keeping it — and a sentence is exactly what a five-megabyte
 * dependency walks straight past. The number below is the fact.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// join() rather than a literal "a/b/c" so the path is correct on Windows too.
const DIST = join("apps", "desktop", "dist");

const PATTERNS = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", re: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let failures = 0;

for (const file of walk(DIST)) {
  if (!/\.(js|mjs|cjs|css|html|map|json)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const { name, re } of PATTERNS) {
    for (const match of content.matchAll(re)) {
      const preview = `${match[0].slice(0, 12)}...`;
      console.error(`SECURITY: ${name} found in ${file} (${preview})`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} credential-shaped string(s) in the production bundle. ` +
      `Secrets must live in the OS keychain and be read only by the Rust ` +
      `backend — never compiled into frontend assets. See spec §4.`,
  );
  process.exit(1);
}

console.log("scan-bundle: clean, no credential-shaped strings in the bundle.");

/*
 * What the first screen costs.
 *
 * The entry chunk and the stylesheet: what a person downloads before the app
 * can draw anything. Chunks fetched later are deliberately not counted —
 * splitting work out of the entry is the fix this budget exists to encourage,
 * and counting it again on the way out would punish the fix. The editor is
 * the worked example: CodeMirror is a third of a megabyte and lives entirely
 * in its own chunk, so it costs whoever opens the editor and nobody else.
 */
/*
 * A little above where the entry bundle actually is today.
 *
 * Set from the measurement rather than from a round number somebody liked:
 * a budget the current build already fails is a budget that gets raised on
 * the first commit and never looked at again. The headroom is small on
 * purpose — enough for ordinary growth, nowhere near enough to hide a
 * multi-megabyte dependency, which is the thing this exists to catch.
 */
const ENTRY_BUDGET = 1_100 * 1024;

/*
 * What index.html actually pulls in.
 *
 * Read from the HTML rather than matched by filename: Vite names a lazily
 * imported chunk `index-<hash>.js` too, because that is what the file inside
 * the package it came from is called. Matching on the name counted every
 * CodeMirror language pack as part of the first screen and failed a build
 * that had just done the right thing.
 */
const html = readFileSync(join(DIST, "index.html"), "utf8");
const referenced = [...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]);

const entry = referenced
  .map((rel) => join(DIST, rel))
  .filter((file) => existsSync(file))
  .map((file) => ({ file, size: statSync(file).size }));

const total = entry.reduce((sum, { size }) => sum + size, 0);
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;

if (total > ENTRY_BUDGET) {
  for (const { file, size } of entry.sort((a, b) => b.size - a.size)) {
    console.error(`  ${kb(size).padStart(8)}  ${file}`);
  }
  console.error(
    `\nscan-bundle: the entry bundle is ${kb(total)}, over its ${kb(ENTRY_BUDGET)} budget.\n` +
      `Everything here is downloaded before the app can draw. If the new weight ` +
      `belongs to one section, load that section with a dynamic import so it ` +
      `becomes a chunk of its own — see the editor in src/App.tsx.`,
  );
  process.exit(1);
}

console.log(`scan-bundle: entry bundle ${kb(total)}, within its ${kb(ENTRY_BUDGET)} budget.`);
