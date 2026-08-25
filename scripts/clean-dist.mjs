#!/usr/bin/env node
/**
 * Removes the frontend build output.
 *
 * Exists as a file rather than an inline `node -e "..."` in package.json
 * because npm scripts run through cmd.exe on Windows, where nested single and
 * double quotes are fragile. Node's own path handling keeps this portable.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

const target = join("apps", "desktop", "dist");
rmSync(target, { recursive: true, force: true });
console.log(`clean-dist: removed ${target}`);
