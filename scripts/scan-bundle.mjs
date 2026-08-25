#!/usr/bin/env node
/**
 * Fails the build if anything shaped like a credential is present in the
 * production bundle. Implements the third assertion of spec §4.3.
 *
 * This guards against a real and easy mistake: hard-coding a key while
 * debugging and shipping it to every user who installs the app.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "apps/desktop/dist";

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
