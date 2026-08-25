module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2022: true },
  ignorePatterns: ["dist", "src-tauri"],
  rules: {
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
