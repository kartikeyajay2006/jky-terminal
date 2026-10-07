import { defineConfig } from "vitest/config";

// Plain Vitest, not Astro's Vite config: what is tested here is ordinary
// TypeScript — the shell, the themes, the facts the page states — and none of
// it needs Astro to run.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
