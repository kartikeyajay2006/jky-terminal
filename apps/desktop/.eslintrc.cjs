module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2022: true },
  ignorePatterns: ["dist", "src-tauri"],
  rules: {
    // A leading underscore marks a parameter kept for documentation but not
    // used — common when implementing an interface whose shape matters more
    // than any single implementation's needs.
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
    ],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@tauri-apps/*"],
            message:
              "Import native capability through src/platform instead. Only " +
              "src/platform/tauri.ts may import @tauri-apps directly — that " +
              "boundary is what lets the UI run and be tested in a browser.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["src/platform/tauri.ts"],
      rules: { "no-restricted-imports": "off" },
    },
  ],
};
