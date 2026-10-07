/** Where the site points outward. One place, so a moved repository is one edit. */
export const GITHUB = "https://github.com/kartikeyajay2006/jky-terminal";
export const DOCS = `${GITHUB}/blob/main/docs/README.md`;
export const doc = (file: string, anchor = "") => `${GITHUB}/blob/main/docs/${file}${anchor ? `#${anchor}` : ""}`;
