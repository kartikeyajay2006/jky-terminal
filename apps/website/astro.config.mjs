import { defineConfig } from "astro/config";
import csp from "./src/integrations/csp.mjs";

// JKY promises no telemetry; its website's build should not send any either.
// Astro reads this when it records, so setting it here covers every build on
// every platform, without an env-var prefix that cmd.exe would not run.
process.env.ASTRO_TELEMETRY_DISABLED = "1";

/*
 * The JKY Terminal website.
 *
 * Static output, served by GitHub Pages from the repository's project path —
 * which is why `base` is set: every asset URL has to start with
 * /jky-terminal/, or the page loads with no styles the moment it leaves
 * localhost. Links inside the site go through `import.meta.env.BASE_URL` for
 * the same reason.
 */
export default defineConfig({
  site: "https://kartikeyajay2006.github.io",
  base: "/jky-terminal",
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  integrations: [csp()],
  build: {
    // Small stylesheets are inlined so the first paint needs one request.
    inlineStylesheets: "auto",
  },
  vite: {
    build: {
      // Never turn a small file into a data: URI. The CSP allows fonts from
      // this site only, and a policy is worth more than one saved request.
      assetsInlineLimit: 0,
    },
    server: {
      // The site reads the app's own theme tokens and glyph geometry from
      // apps/desktop, so both can never drift apart. Allow the dev server to
      // serve from the monorepo root.
      fs: { allow: ["../.."] },
    },
  },
});
