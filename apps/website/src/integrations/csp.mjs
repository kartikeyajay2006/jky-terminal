/**
 * The site's Content Security Policy — the app's own rule, applied to the
 * page that describes it.
 *
 * JKY's window runs under `connect-src 'self'`: it can reach no host at all.
 * This site holds itself to the same: no analytics, no font CDN, no request
 * to anyone but the server it came from. A policy only means something if it
 * is enforced, so after every build this writes it into each page as a
 * <meta> tag, with a hash for each inline script so the policy can forbid
 * every other inline script outright.
 *
 * It runs after the build rather than in a component because only then is
 * every inline script on the page known.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Inline <script> bodies: every <script> element without a src. */
export function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

export function policyFor(html) {
  const hashes = inlineScripts(html).map(
    (body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

export function withPolicy(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policyFor(html)}">`;
  // First in <head>, so it governs everything after it.
  return html.replace(/<head(\s[^>]*)?>/i, (open) => `${open}${meta}`);
}

export default function csp() {
  return {
    name: "jky-csp",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        let pages = 0;
        for (const file of walk(fileURLToPath(dir))) {
          if (!file.endsWith(".html")) continue;
          writeFileSync(file, withPolicy(readFileSync(file, "utf8")));
          pages++;
        }
        logger.info(`connect-src 'self' written into ${pages} page(s)`);
      },
    },
  };
}
