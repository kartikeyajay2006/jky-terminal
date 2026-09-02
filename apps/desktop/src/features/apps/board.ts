import type { GroupSpec } from "../../lib/tileLayout";
import type { AppDef } from "./registry";

/** Where the Apps grid keeps its arrangement. */
export const APPS_KEY = "jky.apps.layout";

/**
 * The groups a first run starts with.
 *
 * Split by whether an app signs in to something, because that is the one
 * thing worth knowing before clicking a tile — and it is already a field on
 * the registry record rather than a label someone has to keep in step. A
 * first run should look like a considered arrangement, not an empty editor.
 */
export const APP_GROUPS: GroupSpec<AppDef>[] = [
  { name: "Ready to use", holds: (app) => app.auth === "none" },
  { name: "Your accounts", holds: (app) => app.auth !== "none" },
];
