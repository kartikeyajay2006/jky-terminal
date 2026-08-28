# Releasing JKY Terminal

Cutting a release is one push of a tag. Everything else is automated by
`.github/workflows/release.yml`.

```sh
# Version lives in three places and they must agree.
#   apps/desktop/package.json          version
#   apps/desktop/src-tauri/tauri.conf.json   version
#   Cargo.toml                         workspace.package.version
git tag v0.1.0
git push origin v0.1.0
```

That builds installers on all three platforms and attaches them to a **draft**
GitHub Release. The draft is deliberate: it is the last chance to notice that
something compiled cleanly and is still wrong. Download one, run it, then
publish.

## What comes out

| Platform | Artefacts |
|---|---|
| Linux | `.deb`, `.rpm`, `.AppImage` |
| macOS | `.dmg` and `.app.tar.gz`, built twice — Apple Silicon and Intel |
| Windows | `.msi` and an NSIS `.exe`, installing per-user |

The Windows installer is per-user on purpose, so installing needs no
administrator. The app only ever writes to the user's own config directory.

## Signing — not on yet, and what it would take

Builds today are **unsigned**. They work, and on first launch:

- **macOS** refuses to open them from Finder. Right-click → Open, or
  `xattr -d com.apple.quarantine /Applications/JKY\ Terminal.app`.
- **Windows** shows a SmartScreen warning. "More info" → "Run anyway".
- **Linux** does not care.

Turning signing on is entirely a matter of adding repository secrets; the
workflow already passes them through and needs no edit.

### macOS

Requires a paid Apple Developer account.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application cert, exported as `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | The password used on that export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | The Apple ID used for notarisation |
| `APPLE_PASSWORD` | An app-specific password, not the account password |
| `APPLE_TEAM_ID` | The ten-character team identifier |

### Windows

Requires a code-signing certificate from a CA.

| Secret | What it is |
|---|---|
| `WINDOWS_CERTIFICATE` | The `.pfx`, base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Its password |

## Auto-update — deliberately not wired

The updater is **not** configured, and that is a decision rather than an
oversight.

Tauri's updater works by having the app trust a public key baked into
`tauri.conf.json` and check a manifest signed with the matching private key.
Committing that config before the keypair exists would mean shipping a build
that trusts a key nobody holds — which is worse than not having updates,
because it cannot be corrected without another manual install anyway.

When you want it:

```sh
pnpm --filter @jky/desktop exec tauri signer generate -w ~/.tauri/jky.key
```

Then:

1. Put the **public** key in `tauri.conf.json` under
   `plugins.updater.pubkey`, with an `endpoints` array pointing at where the
   manifest will live.
2. Add `tauri-plugin-updater` to `src-tauri/Cargo.toml` and register it.
3. Add the **private** key as `TAURI_SIGNING_PRIVATE_KEY` and its password as
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in repository secrets — the workflow
   already reads both.

The private key never goes in the repository. Losing it means every installed
copy stops being updatable, so keep it somewhere you would keep a password.

## Testing the pipeline without spending a version

The workflow has a `workflow_dispatch` trigger. Run it by hand from the
Actions tab to prove the build works end to end without tagging anything.
