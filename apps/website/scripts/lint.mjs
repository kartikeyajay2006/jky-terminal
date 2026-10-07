#!/usr/bin/env node
/**
 * The website's two house rules, checked over its source.
 *
 * 1. No literal colours. Every colour is one of the app's theme tokens; that
 *    is the only reason the whole page can re-theme at once, and it is the
 *    same rule the app's own lint enforces. A hex value here means some part
 *    of the page would stay Cyberpunk while the rest turned Nord.
 *
 * 2. Nothing loaded from another host. The page's CSP forbids it anyway;
 *    this catches it at the source, where the fix is, rather than as a
 *    blocked request in someone's console.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = "src";
const EXTENSIONS = /\.(astro|css|ts|mjs|js)$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(entry)) yield full;
  }
}

const RULES = [
  {
    name: "literal colour",
    // #rgb, #rgba, #rrggbb, #rrggbbaa — not an anchor like #install, whose
    // letters are not all hex digits.
    re: /(?<![\w&/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi,
    hint: "use a theme token, e.g. var(--accent)",
  },
  {
    name: "colour function with literal channels",
    re: /\b(?:rgba?|hsla?|oklch|oklab)\(\s*\d/gi,
    hint: "use a theme token, or color-mix() over one",
  },
  {
    name: "resource from another host",
    re: /(?:src|href)=["']https?:\/\/(?!github\.com|raw\.githubusercontent\.com)[^"']+\.(?:js|css|woff2?|png|jpe?g|svg|webp)["']/gi,
    hint: "serve it from this site; the CSP blocks other hosts",
  },
];

let failures = 0;
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        console.error(`${relative(".", file)}:${i + 1}  ${rule.name} "${m[0]}" — ${rule.hint}`);
        failures++;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\nlint: ${failures} problem(s).`);
  process.exit(1);
}
console.log("lint: no literal colours, nothing from another host.");
