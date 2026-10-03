/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", sourcemap: false, emptyOutDir: true },
  // Read from package.json rather than typed twice, so the banner can never
  // announce a version the build is not.
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    environment: "jsdom",
    globals: true,
    // Hundreds of jsdom UI tests contend for timers and the event loop when
    // they all start at once. A small fixed worker pool keeps async tests
    // deterministic on developer machines and CI without serialising them.
    maxWorkers: 4,
    setupFiles: ["./src/test/setup.ts"],
  },
});
