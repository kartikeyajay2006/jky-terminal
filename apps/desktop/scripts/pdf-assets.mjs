#!/usr/bin/env node
/**
 * Put pdf.js's font and character-map data where the app can fetch it.
 *
 * pdf.js does not carry these inside its bundle: a PDF using one of the
 * fourteen standard fonts — which is most of them — asks for the font data by
 * URL while it renders, and a PDF with CJK text asks for a character map the
 * same way. Without them a page draws with its text missing, which looks like
 * a broken renderer rather than a missing asset.
 *
 * Copied into `public/` rather than imported, because they are fetched at
 * runtime by path. That also keeps them served from the app's own origin,
 * which is the only one `connect-src 'self'` permits — the point of the CSP
 * is that the window can reach nowhere else, and a renderer that wanted a CDN
 * would be a renderer this app could not use.
 *
 * Not committed: 2.5 MB of somebody else's binaries, one `pnpm install` away
 * at all times. See .gitignore.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjs = dirname(dirname(require.resolve("pdfjs-dist/build/pdf.mjs")));
const into = join(process.cwd(), "public", "pdfjs");

const WANTED = ["standard_fonts", "cmaps"];

const missing = WANTED.filter((name) => !existsSync(join(pdfjs, name)));
if (missing.length > 0) {
  console.error(`pdf-assets: pdfjs-dist has no ${missing.join(", ")} — is it installed?`);
  process.exit(1);
}

// Cleared first, so a pdfjs upgrade that drops a file does not leave it behind
// to be served for ever.
rmSync(into, { recursive: true, force: true });
mkdirSync(into, { recursive: true });
for (const name of WANTED) {
  cpSync(join(pdfjs, name), join(into, name), { recursive: true });
}

console.log(`pdf-assets: ${WANTED.join(" and ")} ready under public/pdfjs.`);
