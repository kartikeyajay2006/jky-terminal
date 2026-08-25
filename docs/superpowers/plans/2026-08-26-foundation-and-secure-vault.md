# JKY Terminal — Plan 1: Foundation & Secure Vault

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the JKY Terminal monorepo and ship a desktop app that stores an Anthropic API key in the OS keychain, where the frontend provably cannot read it back.

**Architecture:** A pnpm/Turborepo workspace for TypeScript and a cargo workspace for Rust. All secret handling lives in the `jky-secrets` crate; `src-tauri` holds only thin IPC wrappers. The React app reaches native capability exclusively through a `platform/` adapter with a Tauri implementation and a mock implementation, so the UI runs and is E2E-tested in a plain browser. Three CI assertions enforce the security properties rather than trusting review.

**Tech Stack:** Rust 1.96 · Tauri v2 · React 18 · TypeScript 5 · Vite 5 · Tailwind CSS · Zustand · Vitest · Playwright · `keyring` · `zeroize` · pnpm 9 · Turborepo

**Spec:** [`docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md`](../specs/2026-08-26-jky-terminal-v0.1-design.md)

## Global Constraints

These apply to every task in this plan. Violating any one of them is a build failure, not a style preference.

- **No IPC command may return a secret value.** The vault IPC surface is exactly `vault_set_secret`, `vault_has_secret`, `vault_delete_secret`, `vault_list_providers`. Do not add a getter, not even a "debug only" one.
- **CSP `connect-src` may contain only** `'self'`, `ipc:`, and `http://ipc.localhost`. Those last two are required by Tauri v2's IPC transport. Any other origin fails CI.
- **The renderer gets no `fs`, `shell`, or `http` capability.** `capabilities/default.json` lists `core:default` and nothing more.
- **No literal colour values in components.** Colours come from CSS custom properties. Enforced by lint in Plan 2; do not introduce violations here.
- **No component may import `@tauri-apps/api` directly.** Only `src/platform/tauri.ts` may. Enforced by an ESLint `no-restricted-imports` rule.
- **Rust crates live in `crates/`**, TypeScript packages in `packages/`. Never mix.
- **Commits are authored solely by `kartikeyajay2006 <kartikeyajay2006@gmail.com>`.** No co-author trailers, no AI-attribution notices, in commit messages or in any file.
- **Bundle identifier:** `dev.jky.terminal`. **Keychain service name:** `dev.jky.terminal`.
- **Conventional Commits** for every commit message (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).

---

## File Structure

| File | Responsibility |
|---|---|
| `Cargo.toml` | cargo workspace root; members are `crates/*` and the Tauri app |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | JS workspace root |
| `crates/jky-secrets/src/secret.rs` | `Secret<T>` redacting, zeroizing newtype |
| `crates/jky-secrets/src/store.rs` | `SecretStore` trait + `SecretError` |
| `crates/jky-secrets/src/memory.rs` | `MemoryStore`, test-only in-process implementation |
| `crates/jky-secrets/src/keyring_store.rs` | `KeyringStore`, OS keychain implementation |
| `crates/jky-secrets/src/provider.rs` | `ProviderId` enum + key-format validation |
| `apps/desktop/src-tauri/src/commands/vault.rs` | the four vault IPC wrappers, no logic |
| `apps/desktop/src-tauri/tests/security.rs` | command-surface and CSP assertions |
| `apps/desktop/src-tauri/capabilities/default.json` | minimal capability grant |
| `apps/desktop/src/platform/types.ts` | the `Platform` interface |
| `apps/desktop/src/platform/tauri.ts` | real `invoke()` implementation |
| `apps/desktop/src/platform/web.ts` | in-memory mock implementation |
| `apps/desktop/src/features/settings/KeyVault.tsx` | key entry / status / delete UI |
| `scripts/scan-bundle.mjs` | production-bundle secret scan |

---

## Task 1: Monorepo scaffold and green CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `Cargo.toml`, `.github/workflows/ci.yml`, `apps/desktop/package.json`, `apps/desktop/vite.config.ts`, `apps/desktop/tsconfig.json`, `apps/desktop/index.html`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing — this is the bootstrap task.
- Produces: a `pnpm` workspace where `pnpm -w test`, `pnpm -w lint` and `cargo test --workspace` all run and exit zero; a Vite dev server on port 1420.

- [ ] **Step 1: Enable pnpm**

pnpm is not installed on the target machine. Fedora's `nodejs` package does **not**
ship corepack (it lives in a separate `nodejs-corepack` rpm), so `corepack enable`
fails with exit 127 there. Install pnpm through npm instead — npm's global prefix is
a user-owned directory already on `PATH`, so no `sudo` is required:

```bash
npm install -g pnpm@9.15.0
pnpm --version   # expect 9.15.0
```

On a machine that does have corepack (including the GitHub Actions ubuntu runners
used by the CI workflow in Step 5), `corepack enable` is equivalent and preferred.

- [ ] **Step 2: Create the JS workspace root**

`package.json`:

```json
{
  "name": "jky-terminal",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.2"
  },
  "engines": { "node": ">=22" }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 3: Create the cargo workspace root**

`Cargo.toml` at the repo root:

```toml
[workspace]
resolver = "2"
# apps/desktop/src-tauri joins this list in Task 5, when it is created.
members = ["crates/*"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"
authors = ["kartikeyajay2006 <kartikeyajay2006@gmail.com>"]

[workspace.dependencies]
thiserror = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
zeroize = { version = "1.8", features = ["alloc"] }
keyring = "3.6"
```

- [ ] **Step 4: Scaffold the React app**

`apps/desktop/package.json`:

```json
{
  "name": "@jky/desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src --max-warnings 0",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.17",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

`apps/desktop/vite.config.ts` — note `clearScreen: false` and the fixed port, both required by Tauri's dev integration. This file reads `process.env`, so `@types/node` is a devDependency and `"node"` must appear in the tsconfig `types` array; without both, `tsc --noEmit` fails with TS2591:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", sourcemap: false },
  define: {
    __JKY_PLATFORM__: JSON.stringify(process.env.JKY_PLATFORM ?? "web"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

`apps/desktop/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JKY Terminal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`apps/desktop/src/App.tsx`:

```tsx
export function App() {
  return <div>JKY Terminal</div>;
}
```

- [ ] **Step 5: Add the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  js:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w typecheck
      - run: pnpm -w lint
      - run: pnpm -w test

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { components: clippy }
      - name: Install Tauri system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev \
            libjavascriptcoregtk-4.1-dev build-essential curl wget file \
            libssl-dev libayatana-appindicator3-dev librsvg2-dev
      - uses: Swatinem/rust-cache@v2
      - run: cargo test --workspace
      - run: cargo clippy --workspace --all-targets -- -D warnings
```

- [ ] **Step 6: Verify everything runs**

```bash
pnpm install
pnpm -w typecheck
pnpm -w test
```

Expected: typecheck passes; vitest prints "No test files found, exiting with code 0"
and turbo reports 1 successful task.

Do **not** run `cargo check --workspace` yet. The cargo workspace has no members
until Task 2 creates `crates/jky-secrets`, and a virtual manifest with zero members
is a hard error, not a warning: `the workspace has no members`. The first cargo
verification happens at the end of Task 2.

Also create the directory the members glob points at, so it resolves once the first
crate lands:

```bash
mkdir -p crates
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm + cargo monorepo with CI"
```

---

## Task 2: The `Secret<T>` redacting newtype

This is the innermost defence: even if a secret reaches a log line, a panic backtrace, or a `dbg!()`, it must not render.

**Files:**
- Create: `crates/jky-secrets/Cargo.toml`, `crates/jky-secrets/src/lib.rs`, `crates/jky-secrets/src/secret.rs`

**Interfaces:**
- Consumes: workspace dependencies `zeroize`, `thiserror` from Task 1.
- Produces: `jky_secrets::Secret<T>` with `Secret::new(T) -> Secret<T>` and `Secret::expose(&self) -> &T`. Every later task holds secret material in this type and never in a bare `String`.

- [ ] **Step 1: Create the crate manifest**

`crates/jky-secrets/Cargo.toml`:

```toml
[package]
name = "jky-secrets"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
thiserror.workspace = true
zeroize.workspace = true
keyring.workspace = true
serde.workspace = true
```

`crates/jky-secrets/src/lib.rs`:

```rust
mod secret;

pub use secret::Secret;
```

- [ ] **Step 2: Write the failing tests**

`crates/jky-secrets/src/secret.rs` — tests only for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SENSITIVE: &str = "sk-ant-api03-DO-NOT-LEAK-ME";

    #[test]
    fn debug_never_renders_the_value() {
        let s = Secret::new(SENSITIVE.to_string());
        let rendered = format!("{s:?}");
        assert!(
            !rendered.contains("sk-ant"),
            "Debug leaked the secret: {rendered}"
        );
        assert_eq!(rendered, "Secret([redacted])");
    }

    #[test]
    fn display_never_renders_the_value() {
        let s = Secret::new(SENSITIVE.to_string());
        let rendered = format!("{s}");
        assert!(!rendered.contains("sk-ant"), "Display leaked: {rendered}");
        assert_eq!(rendered, "[redacted]");
    }

    #[test]
    fn expose_returns_the_real_value() {
        let s = Secret::new(SENSITIVE.to_string());
        assert_eq!(s.expose(), SENSITIVE);
    }

    #[test]
    fn nested_in_a_struct_the_derived_debug_still_redacts() {
        #[derive(Debug)]
        #[allow(dead_code)]
        struct Config {
            name: String,
            api_key: Secret<String>,
        }
        let c = Config {
            name: "anthropic".into(),
            api_key: Secret::new(SENSITIVE.to_string()),
        };
        let rendered = format!("{c:?}");
        assert!(
            !rendered.contains("sk-ant"),
            "derived Debug leaked through the wrapper: {rendered}"
        );
        assert!(rendered.contains("anthropic"), "non-secret fields should still render");
    }
}
```

The fourth test is the one that matters most in practice: secrets almost always leak by being a field on a struct that someone slapped `#[derive(Debug)]` on.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p jky-secrets`
Expected: FAIL — `cannot find type Secret in this scope`.

- [ ] **Step 4: Write the implementation**

Prepend to `crates/jky-secrets/src/secret.rs`, above the test module:

```rust
use std::fmt;
use zeroize::Zeroize;

/// A value that must never appear in logs, traces, or error messages.
///
/// `Debug` and `Display` render a fixed placeholder. The inner value is
/// zeroized on drop. Read it only via [`Secret::expose`], and keep the
/// exposed reference's lifetime as short as possible.
pub struct Secret<T: Zeroize>(T);

impl<T: Zeroize> Secret<T> {
    pub fn new(value: T) -> Self {
        Self(value)
    }

    /// Read the wrapped value. Every call site is a place a secret can escape,
    /// so keep them few and keep them short.
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T: Zeroize> fmt::Debug for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl<T: Zeroize> fmt::Display for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl<T: Zeroize> Drop for Secret<T> {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p jky-secrets`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/jky-secrets
git commit -m "feat(secrets): add redacting, zeroizing Secret newtype"
```

---

## Task 3: `SecretStore` trait and in-memory implementation

**Files:**
- Create: `crates/jky-secrets/src/store.rs`, `crates/jky-secrets/src/memory.rs`
- Modify: `crates/jky-secrets/src/lib.rs`

**Interfaces:**
- Consumes: `Secret<T>` from Task 2.
- Produces: `SecretStore` trait with `set`, `get`, `has`, `delete`; `SecretError` enum; `MemoryStore::new()`. Task 4 implements the same trait against the OS keychain, and Task 5's IPC layer depends on the trait, never on a concrete type.

- [ ] **Step 1: Write the failing tests**

`crates/jky-secrets/src/memory.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Secret, SecretError, SecretStore};

    #[test]
    fn set_then_get_round_trips() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        assert_eq!(store.get("anthropic").unwrap().expose(), "value-1");
    }

    #[test]
    fn has_reports_presence_without_revealing_value() {
        let store = MemoryStore::new();
        assert!(!store.has("anthropic").unwrap());
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        assert!(store.has("anthropic").unwrap());
    }

    #[test]
    fn get_missing_key_returns_not_found() {
        let store = MemoryStore::new();
        assert!(matches!(store.get("nope"), Err(SecretError::NotFound(_))));
    }

    #[test]
    fn set_overwrites_an_existing_value() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("old".to_string())).unwrap();
        store.set("anthropic", Secret::new("new".to_string())).unwrap();
        assert_eq!(store.get("anthropic").unwrap().expose(), "new");
    }

    #[test]
    fn delete_removes_the_value() {
        let store = MemoryStore::new();
        store.set("anthropic", Secret::new("value-1".to_string())).unwrap();
        store.delete("anthropic").unwrap();
        assert!(!store.has("anthropic").unwrap());
    }

    #[test]
    fn delete_is_idempotent() {
        let store = MemoryStore::new();
        assert!(store.delete("never-existed").is_ok());
    }

    #[test]
    fn error_messages_name_the_entry_but_never_its_value() {
        // Store errors get logged and shown to users, so they may say which
        // entry failed and must never carry what that entry contained.
        assert_eq!(
            SecretError::NotFound("anthropic".into()).to_string(),
            "no secret stored for 'anthropic'"
        );
        assert_eq!(
            SecretError::InvalidFormat("anthropic".into()).to_string(),
            "invalid key format for provider 'anthropic'"
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p jky-secrets`
Expected: FAIL — `cannot find type MemoryStore`.

- [ ] **Step 3: Write the trait and error type**

`crates/jky-secrets/src/store.rs`:

```rust
use crate::Secret;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("no secret stored for '{0}'")]
    NotFound(String),

    #[error("secret store backend error: {0}")]
    Backend(String),

    #[error("invalid key format for provider '{0}'")]
    InvalidFormat(String),
}

/// Storage for secret material.
///
/// Implementations must never log, serialize, or otherwise emit stored values.
/// Note there is deliberately no bulk-export operation.
pub trait SecretStore: Send + Sync {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError>;

    /// Read a stored secret. This is crate-internal by convention: it must never
    /// be reachable from an IPC command. See `apps/desktop/src-tauri/tests/security.rs`.
    fn get(&self, key: &str) -> Result<Secret<String>, SecretError>;

    fn has(&self, key: &str) -> Result<bool, SecretError>;

    fn delete(&self, key: &str) -> Result<(), SecretError>;
}
```

- [ ] **Step 4: Write the in-memory implementation**

Prepend to `crates/jky-secrets/src/memory.rs`:

```rust
use std::collections::HashMap;
use std::sync::RwLock;

use crate::{Secret, SecretError, SecretStore};

/// In-process secret storage.
///
/// Used by unit tests and by the browser development build, where no OS
/// keychain exists. Values live only in memory and vanish on exit — that is
/// the point. Never select this implementation in a release desktop build.
#[derive(Default)]
pub struct MemoryStore {
    inner: RwLock<HashMap<String, String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_err(e: impl std::fmt::Display) -> SecretError {
        SecretError::Backend(format!("lock poisoned: {e}"))
    }
}

impl SecretStore for MemoryStore {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError> {
        let mut guard = self.inner.write().map_err(Self::lock_err)?;
        guard.insert(key.to_string(), value.expose().clone());
        Ok(())
    }

    fn get(&self, key: &str) -> Result<Secret<String>, SecretError> {
        let guard = self.inner.read().map_err(Self::lock_err)?;
        guard
            .get(key)
            .map(|v| Secret::new(v.clone()))
            .ok_or_else(|| SecretError::NotFound(key.to_string()))
    }

    fn has(&self, key: &str) -> Result<bool, SecretError> {
        let guard = self.inner.read().map_err(Self::lock_err)?;
        Ok(guard.contains_key(key))
    }

    fn delete(&self, key: &str) -> Result<(), SecretError> {
        let mut guard = self.inner.write().map_err(Self::lock_err)?;
        guard.remove(key);
        Ok(())
    }
}
```

- [ ] **Step 5: Wire up the module exports**

`crates/jky-secrets/src/lib.rs`:

```rust
mod memory;
mod secret;
mod store;

pub use memory::MemoryStore;
pub use secret::Secret;
pub use store::{SecretError, SecretStore};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p jky-secrets`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/jky-secrets
git commit -m "feat(secrets): add SecretStore trait and in-memory implementation"
```

---

## Task 4: Provider identity, key validation, and the OS keychain store

**Files:**
- Create: `crates/jky-secrets/src/provider.rs`, `crates/jky-secrets/src/keyring_store.rs`
- Modify: `crates/jky-secrets/src/lib.rs`

**Interfaces:**
- Consumes: `SecretStore`, `SecretError`, `Secret` from Tasks 2–3.
- Produces: `ProviderId` enum with `ProviderId::Anthropic`, `ProviderId::as_key(&self) -> &'static str`, `ProviderId::all() -> &'static [ProviderId]`, `ProviderId::validate(&self, &str) -> Result<(), SecretError>`; and `KeyringStore::new(service: &str)`. Task 5's IPC layer consumes both.

- [ ] **Step 1: Write the failing provider tests**

`crates/jky-secrets/src/provider.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_key_maps_to_a_stable_storage_key() {
        assert_eq!(ProviderId::Anthropic.as_key(), "anthropic");
    }

    #[test]
    fn parses_from_its_storage_key() {
        assert_eq!(ProviderId::parse("anthropic"), Some(ProviderId::Anthropic));
        assert_eq!(ProviderId::parse("nonsense"), None);
    }

    #[test]
    fn accepts_a_well_formed_anthropic_key() {
        let key = format!("sk-ant-api03-{}", "x".repeat(40));
        assert!(ProviderId::Anthropic.validate(&key).is_ok());
    }

    #[test]
    fn rejects_a_key_with_the_wrong_prefix() {
        let key = format!("sk-proj-{}", "x".repeat(40));
        assert!(matches!(
            ProviderId::Anthropic.validate(&key),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_a_key_that_is_too_short_to_be_real() {
        assert!(matches!(
            ProviderId::Anthropic.validate("sk-ant-"),
            Err(SecretError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_whitespace_padded_input_rather_than_silently_trimming() {
        let key = format!("  sk-ant-api03-{}  ", "x".repeat(40));
        assert!(ProviderId::Anthropic.validate(&key).is_err());
    }

    #[test]
    fn validation_error_does_not_echo_the_rejected_key() {
        let key = format!("sk-proj-SECRETVALUE{}", "x".repeat(40));
        let err = ProviderId::Anthropic.validate(&key).unwrap_err();
        assert!(
            !format!("{err}").contains("SECRETVALUE"),
            "validation error echoed the key back: {err}"
        );
    }
}
```

That last test is the subtle one. Validation errors are the classic place a rejected credential gets echoed into a log.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p jky-secrets provider`
Expected: FAIL — `cannot find type ProviderId`.

- [ ] **Step 3: Implement the provider type**

Prepend to `crates/jky-secrets/src/provider.rs`:

```rust
use serde::{Deserialize, Serialize};

use crate::SecretError;

/// An AI provider whose credential the vault can hold.
///
/// v0.1 ships Anthropic only. Adding a provider means adding a variant here
/// plus its validation rule — nothing else changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Anthropic,
}

impl ProviderId {
    pub fn as_key(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "anthropic",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "anthropic" => Some(ProviderId::Anthropic),
            _ => None,
        }
    }

    pub fn all() -> &'static [ProviderId] {
        &[ProviderId::Anthropic]
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "Anthropic",
        }
    }

    /// Cheap client-side shape check. This catches typos and wrong-vendor keys
    /// before they reach the keychain; it does not prove the key is live.
    ///
    /// Deliberately rejects surrounding whitespace instead of trimming, so the
    /// stored value is always exactly what the user was shown.
    pub fn validate(&self, candidate: &str) -> Result<(), SecretError> {
        let invalid = || SecretError::InvalidFormat(self.as_key().to_string());

        if candidate.trim() != candidate {
            return Err(invalid());
        }

        match self {
            ProviderId::Anthropic => {
                if !candidate.starts_with("sk-ant-") || candidate.len() < 40 {
                    return Err(invalid());
                }
            }
        }

        Ok(())
    }
}
```

Note `invalid()` builds the error from `self.as_key()` — the provider name — never from `candidate`. That is what makes the no-echo test pass.

- [ ] **Step 4: Run the provider tests**

Run: `cargo test -p jky-secrets provider`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the keychain store tests**

`crates/jky-secrets/src/keyring_store.rs`. These touch the real OS keychain, so they are `#[ignore]`d — CI runners have no unlocked keyring, and a test that fails for environmental reasons trains people to ignore red builds.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Secret, SecretStore};

    const TEST_SERVICE: &str = "dev.jky.terminal.test";

    #[test]
    #[ignore = "touches the real OS keychain; run locally with --ignored"]
    fn round_trips_through_the_os_keychain() {
        let store = KeyringStore::new(TEST_SERVICE);
        let key = "test-round-trip";
        let _ = store.delete(key);

        store.set(key, Secret::new("value-1".to_string())).unwrap();
        assert!(store.has(key).unwrap());
        assert_eq!(store.get(key).unwrap().expose(), "value-1");

        store.delete(key).unwrap();
        assert!(!store.has(key).unwrap());
    }

    #[test]
    #[ignore = "touches the real OS keychain; run locally with --ignored"]
    fn has_returns_false_for_an_absent_entry_rather_than_erroring() {
        let store = KeyringStore::new(TEST_SERVICE);
        assert!(!store.has("definitely-not-present").unwrap());
    }
}
```

- [ ] **Step 6: Implement the keychain store**

Prepend to `crates/jky-secrets/src/keyring_store.rs`:

```rust
use keyring::Entry;

use crate::{Secret, SecretError, SecretStore};

/// Secret storage backed by the operating system's own credential store:
/// Secret Service / GNOME Keyring on Linux, Keychain on macOS, Credential
/// Manager on Windows. The OS owns the encryption and the unlock policy.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self { service: service.to_string() }
    }

    fn entry(&self, key: &str) -> Result<Entry, SecretError> {
        Entry::new(&self.service, key).map_err(|e| SecretError::Backend(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, key: &str, value: Secret<String>) -> Result<(), SecretError> {
        self.entry(key)?
            .set_password(value.expose())
            .map_err(|e| SecretError::Backend(e.to_string()))
    }

    fn get(&self, key: &str) -> Result<Secret<String>, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Secret::new(v)),
            Err(keyring::Error::NoEntry) => Err(SecretError::NotFound(key.to_string())),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }

    fn has(&self, key: &str) -> Result<bool, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }

    fn delete(&self, key: &str) -> Result<(), SecretError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Backend(e.to_string())),
        }
    }
}
```

`has` maps `NoEntry` to `Ok(false)` rather than propagating an error, and `delete` treats it as success — absence is a normal state, not a failure.

- [ ] **Step 7: Update exports and run the full suite**

`crates/jky-secrets/src/lib.rs`:

```rust
mod keyring_store;
mod memory;
mod provider;
mod secret;
mod store;

pub use keyring_store::KeyringStore;
pub use memory::MemoryStore;
pub use provider::ProviderId;
pub use secret::Secret;
pub use store::{SecretError, SecretStore};
```

Run: `cargo test -p jky-secrets`
Expected: PASS, 18 passed, 2 ignored.

Then verify the keychain path works on this machine:

Run: `cargo test -p jky-secrets -- --ignored`
Expected: PASS, 2 tests. If this fails with a D-Bus or Secret Service error, the login keyring is locked — unlock it via Seahorse and re-run.

- [ ] **Step 8: Commit**

```bash
git add crates/jky-secrets
git commit -m "feat(secrets): add provider validation and OS keychain store"
```

---

## Task 5: Tauri app with the vault IPC surface

**Files:**
- Create: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/src/state.rs`, `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/commands/vault.rs`

**Interfaces:**
- Consumes: `ProviderId`, `KeyringStore`, `Secret`, `SecretStore` from Tasks 2–4.
- Produces: four IPC commands — `vault_set_secret(provider: String, value: String) -> Result<(), String>`, `vault_has_secret(provider: String) -> Result<bool, String>`, `vault_delete_secret(provider: String) -> Result<(), String>`, `vault_list_providers() -> Result<Vec<ProviderStatus>, String>` where `ProviderStatus { id: String, display_name: String, connected: bool }`. Task 7's TypeScript adapter mirrors these signatures exactly.

- [ ] **Step 1: Create the Tauri manifest and config**

`apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "jky-terminal"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
jky-secrets = { path = "../../../crates/jky-secrets" }
serde.workspace = true
serde_json.workspace = true
```

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/desktop/src-tauri/tauri.conf.json` — the `connect-src` list is a Global Constraint; `ipc:` and `http://ipc.localhost` are required by Tauri v2's IPC transport and are not external origins:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "JKY Terminal",
  "version": "0.1.0",
  "identifier": "dev.jky.terminal",
  "build": {
    "beforeDevCommand": "pnpm --filter @jky/desktop dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm --filter @jky/desktop build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "JKY Terminal",
        "width": 1280,
        "height": 853,
        "minWidth": 900,
        "minHeight": 600,
        "decorations": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"]
  }
}
```

`apps/desktop/src-tauri/capabilities/default.json` — deliberately minimal; no `fs`, `shell`, or `http`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Minimal capability set. The renderer gets no filesystem, shell, or network access; every privileged action goes through an explicit command.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 2: Write the failing command tests**

`apps/desktop/src-tauri/src/commands/vault.rs` — tests first. They exercise the logic functions directly rather than through Tauri's IPC layer, which is why the logic is split out from the `#[tauri::command]` wrappers.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use jky_secrets::MemoryStore;

    fn valid_key() -> String {
        format!("sk-ant-api03-{}", "x".repeat(40))
    }

    #[test]
    fn storing_a_valid_key_marks_the_provider_connected() {
        let store = MemoryStore::new();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();

        let statuses = list_providers_logic(&store).unwrap();
        let anthropic = statuses.iter().find(|s| s.id == "anthropic").unwrap();
        assert!(anthropic.connected);
        assert_eq!(anthropic.display_name, "Anthropic");
    }

    #[test]
    fn a_malformed_key_is_rejected_and_nothing_is_stored() {
        let store = MemoryStore::new();
        let result = set_secret_logic(&store, "anthropic", "not-a-key".to_string());

        assert!(result.is_err());
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn an_unknown_provider_is_rejected() {
        let store = MemoryStore::new();
        assert!(set_secret_logic(&store, "skynet", valid_key()).is_err());
    }

    #[test]
    fn errors_returned_to_the_frontend_never_contain_key_material() {
        let store = MemoryStore::new();
        let leaky = format!("sk-wrong-LEAKCANARY{}", "x".repeat(40));
        let err = set_secret_logic(&store, "anthropic", leaky).unwrap_err();
        assert!(
            !err.contains("LEAKCANARY"),
            "IPC error string echoed key material to the frontend: {err}"
        );
    }

    #[test]
    fn deleting_a_provider_disconnects_it() {
        let store = MemoryStore::new();
        set_secret_logic(&store, "anthropic", valid_key()).unwrap();
        delete_secret_logic(&store, "anthropic").unwrap();
        assert!(!has_secret_logic(&store, "anthropic").unwrap());
    }

    #[test]
    fn list_providers_reports_every_known_provider_even_when_unset() {
        let store = MemoryStore::new();
        let statuses = list_providers_logic(&store).unwrap();
        assert_eq!(statuses.len(), 1);
        assert!(!statuses[0].connected);
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test -p jky-terminal`
Expected: FAIL — `cannot find function set_secret_logic`.

- [ ] **Step 4: Implement the commands**

Prepend to `apps/desktop/src-tauri/src/commands/vault.rs`:

```rust
use jky_secrets::{ProviderId, Secret, SecretStore};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize, PartialEq)]
pub struct ProviderStatus {
    pub id: String,
    pub display_name: String,
    pub connected: bool,
}

fn resolve(provider: &str) -> Result<ProviderId, String> {
    ProviderId::parse(provider).ok_or_else(|| format!("unknown provider '{provider}'"))
}

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn set_secret_logic(
    store: &dyn SecretStore,
    provider: &str,
    value: String,
) -> Result<(), String> {
    let id = resolve(provider)?;
    id.validate(&value).map_err(|e| e.to_string())?;
    store
        .set(id.as_key(), Secret::new(value))
        .map_err(|e| e.to_string())
}

pub(crate) fn has_secret_logic(store: &dyn SecretStore, provider: &str) -> Result<bool, String> {
    let id = resolve(provider)?;
    store.has(id.as_key()).map_err(|e| e.to_string())
}

pub(crate) fn delete_secret_logic(store: &dyn SecretStore, provider: &str) -> Result<(), String> {
    let id = resolve(provider)?;
    store.delete(id.as_key()).map_err(|e| e.to_string())
}

pub(crate) fn list_providers_logic(
    store: &dyn SecretStore,
) -> Result<Vec<ProviderStatus>, String> {
    ProviderId::all()
        .iter()
        .map(|id| {
            Ok(ProviderStatus {
                id: id.as_key().to_string(),
                display_name: id.display_name().to_string(),
                connected: store.has(id.as_key()).map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

// --- IPC surface ------------------------------------------------------------
//
// SECURITY: there is deliberately no command that returns a stored secret.
// Do not add one. `apps/desktop/src-tauri/tests/security.rs` fails the build
// if a getter-shaped command appears here.

#[tauri::command]
pub fn vault_set_secret(
    state: State<'_, AppState>,
    provider: String,
    value: String,
) -> Result<(), String> {
    set_secret_logic(state.secrets.as_ref(), &provider, value)
}

#[tauri::command]
pub fn vault_has_secret(state: State<'_, AppState>, provider: String) -> Result<bool, String> {
    has_secret_logic(state.secrets.as_ref(), &provider)
}

#[tauri::command]
pub fn vault_delete_secret(state: State<'_, AppState>, provider: String) -> Result<(), String> {
    delete_secret_logic(state.secrets.as_ref(), &provider)
}

#[tauri::command]
pub fn vault_list_providers(state: State<'_, AppState>) -> Result<Vec<ProviderStatus>, String> {
    list_providers_logic(state.secrets.as_ref())
}
```

`apps/desktop/src-tauri/src/commands/mod.rs`:

```rust
pub mod vault;
```

`apps/desktop/src-tauri/src/state.rs`:

```rust
use std::sync::Arc;

use jky_secrets::{KeyringStore, SecretStore};

pub const KEYCHAIN_SERVICE: &str = "dev.jky.terminal";

pub struct AppState {
    pub secrets: Arc<dyn SecretStore>,
}

impl AppState {
    pub fn new() -> Self {
        Self { secrets: Arc::new(KeyringStore::new(KEYCHAIN_SERVICE)) }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
```

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use commands::vault;
use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            vault::vault_set_secret,
            vault::vault_has_secret,
            vault::vault_delete_secret,
            vault::vault_list_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JKY Terminal");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p jky-terminal`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(vault): add Tauri app with write-only vault IPC surface"
```

---

## Task 6: Security assertions that fail the build

The properties in §4 of the spec are only real if something checks them. This task makes them executable.

**Files:**
- Create: `apps/desktop/src-tauri/tests/security.rs`

**Interfaces:**
- Consumes: the command source from Task 5 and `tauri.conf.json`.
- Produces: three build-failing assertions. Task 9 adds the fourth (bundle scan) on the JS side.

- [ ] **Step 1: Write the tests**

These read the project's own source and config as data — a design choice that means they keep working as the codebase grows, instead of asserting against a snapshot that goes stale.

`apps/desktop/src-tauri/tests/security.rs`:

```rust
//! Executable enforcement of the security properties in
//! `docs/superpowers/specs/2026-08-26-jky-terminal-v0.1-design.md` §4.
//!
//! These tests read the crate's own source and configuration. If one fails,
//! do not weaken the test — the code under it has regressed.

use std::fs;
use std::path::PathBuf;

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn command_sources() -> Vec<(PathBuf, String)> {
    let dir = crate_root().join("src/commands");
    fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .map(|p| {
            let body = fs::read_to_string(&p).expect("readable source file");
            (p, body)
        })
        .collect()
}

/// Every `#[tauri::command]` exposed to the renderer, as `(file, fn_name)`.
fn exposed_commands() -> Vec<(String, String)> {
    let mut found = Vec::new();
    for (path, body) in command_sources() {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        let lines: Vec<&str> = body.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let sig = lines[i + 1..]
                .iter()
                .find(|l| l.contains("fn "))
                .expect("a #[tauri::command] attribute with no following fn");
            let name = sig
                .split("fn ")
                .nth(1)
                .and_then(|s| s.split('(').next())
                .expect("parseable fn name")
                .trim()
                .to_string();
            found.push((file.clone(), name));
        }
    }
    found
}

#[test]
fn no_ipc_command_is_shaped_like_a_secret_getter() {
    const FORBIDDEN: &[&str] = &[
        "get_secret",
        "read_secret",
        "reveal",
        "expose",
        "export_secret",
        "dump",
        "get_key",
        "api_key",
    ];

    for (file, name) in exposed_commands() {
        let lowered = name.to_lowercase();
        for needle in FORBIDDEN {
            assert!(
                !lowered.contains(needle),
                "SECURITY: IPC command `{name}` in {file} looks like a secret getter \
                 (matched '{needle}'). The frontend must never be able to read a stored \
                 secret. See spec §4.2.1."
            );
        }
    }
}

#[test]
fn the_exposed_command_surface_is_exactly_what_the_spec_allows() {
    let mut actual: Vec<String> = exposed_commands().into_iter().map(|(_, n)| n).collect();
    actual.sort();

    let expected = vec![
        "vault_delete_secret".to_string(),
        "vault_has_secret".to_string(),
        "vault_list_providers".to_string(),
        "vault_set_secret".to_string(),
    ];

    assert_eq!(
        actual, expected,
        "SECURITY: the IPC surface changed. Every command exposed to the renderer \
         widens the attack surface, so this list is deliberately pinned. If you are \
         adding a command intentionally, update this test in the same commit and say \
         why in the message."
    );
}

#[test]
fn no_command_returns_a_secret_type() {
    for (path, body) in command_sources() {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        let lines: Vec<&str> = body.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let sig = lines[i + 1..]
                .iter()
                .take(6)
                .copied()
                .collect::<Vec<_>>()
                .join(" ");
            assert!(
                !sig.contains("Secret<"),
                "SECURITY: a #[tauri::command] in {file} has `Secret<` in its signature. \
                 Secret material must not cross the IPC boundary. Signature: {sig}"
            );
        }
    }
}

#[test]
fn csp_connect_src_permits_no_external_origin() {
    let conf_path = crate_root().join("tauri.conf.json");
    let raw = fs::read_to_string(&conf_path).expect("tauri.conf.json is readable");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("SECURITY: no CSP is configured. An absent CSP is an open door.");

    let connect_src = csp
        .split(';')
        .map(str::trim)
        .find(|d| d.starts_with("connect-src"))
        .expect("SECURITY: CSP defines no connect-src directive");

    // Required by Tauri v2's IPC transport; neither reaches the public network.
    const ALLOWED: &[&str] = &["connect-src", "'self'", "ipc:", "http://ipc.localhost"];

    for token in connect_src.split_whitespace() {
        assert!(
            ALLOWED.contains(&token),
            "SECURITY: CSP connect-src allows '{token}'. The webview must not be able to \
             reach any external origin — that is what stops a compromised frontend from \
             exfiltrating the user's API key. See spec §4.2.2."
        );
    }
}

#[test]
fn the_renderer_is_granted_no_filesystem_shell_or_network_capability() {
    let path = crate_root().join("capabilities/default.json");
    let raw = fs::read_to_string(&path).expect("capabilities/default.json is readable");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let permissions = conf["permissions"]
        .as_array()
        .expect("capabilities file declares a permissions array");

    const FORBIDDEN_PREFIXES: &[&str] = &["fs:", "shell:", "http:"];

    for p in permissions {
        let name = p.as_str().unwrap_or_default();
        for prefix in FORBIDDEN_PREFIXES {
            assert!(
                !name.starts_with(prefix),
                "SECURITY: capability '{name}' grants the renderer direct {prefix} access. \
                 Every privileged action must go through an explicit command. See spec §4.2.4."
            );
        }
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test -p jky-terminal --test security`
Expected: PASS, 5 tests.

- [ ] **Step 3: Prove the tests actually catch regressions**

A security test that cannot fail is decoration. Verify each one bites:

```bash
# Temporarily widen the CSP and confirm the test fails.
sed -i 's|connect-src '"'"'self'"'"' ipc:|connect-src '"'"'self'"'"' https://evil.example ipc:|' \
  apps/desktop/src-tauri/tauri.conf.json
cargo test -p jky-terminal --test security csp_connect_src   # EXPECT: FAIL
git checkout apps/desktop/src-tauri/tauri.conf.json
cargo test -p jky-terminal --test security csp_connect_src   # EXPECT: PASS
```

Expected: the first run fails naming `https://evil.example`, the second passes. Do not proceed until you have seen the failure — that is the evidence the guard works.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/tests
git commit -m "test(security): assert IPC surface, CSP, and capability limits"
```

---

## Task 7: The platform adapter

**Files:**
- Create: `apps/desktop/src/platform/types.ts`, `apps/desktop/src/platform/web.ts`, `apps/desktop/src/platform/tauri.ts`, `apps/desktop/src/platform/index.ts`, `apps/desktop/src/platform/web.test.ts`, `apps/desktop/.eslintrc.cjs`, `apps/desktop/src/vite-env.d.ts`

**Interfaces:**
- Consumes: the four IPC command signatures from Task 5.
- Produces: `getPlatform(): Platform` and the `Platform`, `ProviderStatus` types. Task 8's UI depends only on these, never on `@tauri-apps/api`.

- [ ] **Step 1: Define the interface**

`apps/desktop/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
declare const __JKY_PLATFORM__: "web" | "tauri";
```

`apps/desktop/src/platform/types.ts`:

```ts
export interface ProviderStatus {
  id: string;
  displayName: string;
  connected: boolean;
}

/**
 * Every native capability the UI is allowed to reach.
 *
 * Note what is absent: there is no `getSecret`. The frontend can store a
 * secret, ask whether one exists, and delete it — never read it back. This
 * mirrors the Rust IPC surface, which has no getter either.
 */
export interface VaultApi {
  setSecret(provider: string, value: string): Promise<void>;
  hasSecret(provider: string): Promise<boolean>;
  deleteSecret(provider: string): Promise<void>;
  listProviders(): Promise<ProviderStatus[]>;
}

export interface Platform {
  readonly kind: "web" | "tauri";
  readonly vault: VaultApi;
}
```

- [ ] **Step 2: Write the failing mock tests**

`apps/desktop/src/platform/web.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

describe("web platform mock", () => {
  let platform: Platform;

  beforeEach(() => {
    platform = createWebPlatform();
  });

  it("reports a provider as disconnected before any key is stored", async () => {
    const providers = await platform.vault.listProviders();
    expect(providers).toEqual([
      { id: "anthropic", displayName: "Anthropic", connected: false },
    ]);
  });

  it("marks a provider connected after storing a valid key", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    expect(await platform.vault.hasSecret("anthropic")).toBe(true);
  });

  it("rejects a malformed key the same way the Rust validator does", async () => {
    await expect(
      platform.vault.setSecret("anthropic", "not-a-key"),
    ).rejects.toThrow(/invalid key format/i);
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("rejects an unknown provider", async () => {
    await expect(
      platform.vault.setSecret("skynet", `sk-ant-api03-${"x".repeat(40)}`),
    ).rejects.toThrow(/unknown provider/i);
  });

  it("disconnects a provider after delete", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    await platform.vault.deleteSecret("anthropic");
    expect(await platform.vault.hasSecret("anthropic")).toBe(false);
  });

  it("exposes no way to read a stored secret back", () => {
    const surface = Object.keys(platform.vault);
    expect(surface).toEqual([
      "setSecret",
      "hasSecret",
      "deleteSecret",
      "listProviders",
    ]);
    expect(surface.join(" ")).not.toMatch(/get|read|reveal/i);
  });

  it("does not persist secrets to browser storage", async () => {
    await platform.vault.setSecret("anthropic", `sk-ant-api03-${"x".repeat(40)}`);
    expect(JSON.stringify(localStorage)).not.toContain("sk-ant");
    expect(JSON.stringify(sessionStorage)).not.toContain("sk-ant");
  });
});
```

That last test matters: the obvious shortcut for a browser mock is `localStorage`, which would write a real key to disk in plaintext the first time someone ran the web build against a real vault UI.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @jky/desktop test`
Expected: FAIL — cannot resolve `./web`.

- [ ] **Step 4: Implement the mock**

`apps/desktop/src/platform/web.ts`:

```ts
import type { Platform, ProviderStatus, VaultApi } from "./types";

const KNOWN_PROVIDERS: ReadonlyArray<Omit<ProviderStatus, "connected">> = [
  { id: "anthropic", displayName: "Anthropic" },
];

/** Mirrors `ProviderId::validate` in crates/jky-secrets/src/provider.rs. */
function validate(provider: string, value: string): void {
  if (!KNOWN_PROVIDERS.some((p) => p.id === provider)) {
    throw new Error(`unknown provider '${provider}'`);
  }
  if (provider === "anthropic") {
    if (value.trim() !== value || !value.startsWith("sk-ant-") || value.length < 40) {
      throw new Error(`invalid key format for provider '${provider}'`);
    }
  }
}

/**
 * Development-only vault.
 *
 * Values live in a closure and die with the tab. Deliberately NOT localStorage
 * or sessionStorage — the browser build must never write credentials to disk.
 */
export function createWebPlatform(): Platform {
  const store = new Map<string, string>();

  const vault: VaultApi = {
    async setSecret(provider, value) {
      validate(provider, value);
      store.set(provider, value);
    },
    async hasSecret(provider) {
      return store.has(provider);
    },
    async deleteSecret(provider) {
      store.delete(provider);
    },
    async listProviders() {
      return KNOWN_PROVIDERS.map((p) => ({ ...p, connected: store.has(p.id) }));
    },
  };

  return { kind: "web", vault };
}
```

- [ ] **Step 5: Implement the Tauri adapter and the selector**

`apps/desktop/src/platform/tauri.ts` — the only file permitted to import `@tauri-apps/api`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Platform, ProviderStatus, VaultApi } from "./types";

interface RawProviderStatus {
  id: string;
  display_name: string;
  connected: boolean;
}

export function createTauriPlatform(): Platform {
  const vault: VaultApi = {
    async setSecret(provider, value) {
      await invoke<void>("vault_set_secret", { provider, value });
    },
    async hasSecret(provider) {
      return invoke<boolean>("vault_has_secret", { provider });
    },
    async deleteSecret(provider) {
      await invoke<void>("vault_delete_secret", { provider });
    },
    async listProviders(): Promise<ProviderStatus[]> {
      const raw = await invoke<RawProviderStatus[]>("vault_list_providers");
      return raw.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        connected: r.connected,
      }));
    },
  };

  return { kind: "tauri", vault };
}
```

`apps/desktop/src/platform/index.ts`:

```ts
import { createTauriPlatform } from "./tauri";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

export type { Platform, ProviderStatus, VaultApi } from "./types";
export { createWebPlatform } from "./web";

let instance: Platform | null = null;

export function getPlatform(): Platform {
  if (!instance) {
    instance = __JKY_PLATFORM__ === "tauri" ? createTauriPlatform() : createWebPlatform();
  }
  return instance;
}

/** Test-only escape hatch for injecting a stub platform. */
export function __setPlatformForTests(p: Platform | null): void {
  instance = p;
}
```

- [ ] **Step 6: Add the lint rule that keeps the boundary honest**

`apps/desktop/.eslintrc.cjs`:

```js
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
```

Add the ESLint dependencies:

```bash
pnpm --filter @jky/desktop add -D eslint@^8.57.1 \
  @typescript-eslint/parser@^8.18.1 @typescript-eslint/eslint-plugin@^8.18.1
```

- [ ] **Step 7: Run tests and lint**

Run: `pnpm --filter @jky/desktop test && pnpm --filter @jky/desktop lint`
Expected: 7 tests PASS, lint clean.

- [ ] **Step 8: Verify the lint rule bites**

```bash
echo 'import { invoke } from "@tauri-apps/api/core"; console.log(invoke);' \
  > src/platform/violation.ts
pnpm --filter @jky/desktop lint    # EXPECT: FAIL on no-restricted-imports
rm src/platform/violation.ts
```

Expected: a `no-restricted-imports` error naming the file. Delete the probe file afterwards.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src apps/desktop/.eslintrc.cjs apps/desktop/package.json
git commit -m "feat(platform): add platform adapter with web mock and Tauri impl"
```

---

## Task 8: The key vault settings UI

**Files:**
- Create: `apps/desktop/src/features/settings/KeyVault.tsx`, `apps/desktop/src/features/settings/KeyVault.test.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `getPlatform()`, `Platform`, `ProviderStatus` from Task 7.
- Produces: `<KeyVault />`, rendered by `App`. Plan 2 relocates it into the Settings panel; the component contract does not change.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/features/settings/KeyVault.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { KeyVault } from "./KeyVault";

const VALID_KEY = `sk-ant-api03-${"x".repeat(40)}`;

describe("KeyVault", () => {
  beforeEach(() => __setPlatformForTests(createWebPlatform()));
  afterEach(() => __setPlatformForTests(null));

  it("shows the provider as not connected on first load", async () => {
    render(<KeyVault />);
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it("stores a valid key and switches to the connected state", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));

    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
  });

  it("uses a password-type input so the key is never shown on screen", async () => {
    render(<KeyVault />);
    const input = await screen.findByLabelText(/api key/i);
    expect(input).toHaveAttribute("type", "password");
  });

  it("clears the input immediately after a successful save", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    const input = await screen.findByLabelText(/api key/i);
    await user.type(input, VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("surfaces a validation error without echoing the rejected key", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/api key/i), "sk-wrong-CANARY123");
    await user.click(screen.getByRole("button", { name: /save key/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent ?? "").not.toContain("CANARY123");
  });

  it("disables save while the field is empty", async () => {
    render(<KeyVault />);
    await screen.findByLabelText(/api key/i);
    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();
  });

  it("removes the key and returns to the not-connected state", async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.type(await screen.findByLabelText(/api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));
    await screen.findByRole("button", { name: /remove key/i });
    await user.click(screen.getByRole("button", { name: /remove key/i }));

    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it("never renders stored key material anywhere in the tree", async () => {
    const user = userEvent.setup();
    const { container } = render(<KeyVault />);

    await user.type(await screen.findByLabelText(/api key/i), VALID_KEY);
    await user.click(screen.getByRole("button", { name: /save key/i }));
    await screen.findByText(/connected/i);

    expect(container.innerHTML).not.toContain(VALID_KEY);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jky/desktop test`
Expected: FAIL — cannot resolve `./KeyVault`.

- [ ] **Step 3: Implement the component**

Styling is intentionally minimal here — Plan 2 introduces the design system and restyles this against tokens. Structure and behaviour are what matter now.

`apps/desktop/src/features/settings/KeyVault.tsx`:

```tsx
import { useCallback, useEffect, useId, useState } from "react";
import { getPlatform, type ProviderStatus } from "../../platform";

export function KeyVault() {
  const inputId = useId();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setProviders(await getPlatform().vault.listProviders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anthropic = providers.find((p) => p.id === "anthropic");

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await getPlatform().vault.setSecret("anthropic", draft);
      // Clear before anything can re-render with the value still in state.
      setDraft("");
      await refresh();
    } catch (e) {
      // The adapter and the Rust validator both refuse to echo key material,
      // so this message is safe to display verbatim.
      setError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await getPlatform().vault.deleteSecret("anthropic");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="key-vault-heading">
      <h2 id="key-vault-heading">API Keys</h2>

      <p>
        Anthropic:{" "}
        <strong>{anthropic?.connected ? "Connected" : "Not connected"}</strong>
      </p>

      <label htmlFor={inputId}>API key</label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder="sk-ant-..."
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />

      <button onClick={handleSave} disabled={busy || draft.length === 0}>
        Save key
      </button>

      {anthropic?.connected && (
        <button onClick={handleRemove} disabled={busy}>
          Remove key
        </button>
      )}

      {error && <p role="alert">{error}</p>}

      <p>
        Your key is stored in your operating system&apos;s keychain and is read
        only by JKY Terminal&apos;s background process. It is never sent
        anywhere except to Anthropic, and this interface cannot read it back.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Render it from App**

`apps/desktop/src/App.tsx`:

```tsx
import { KeyVault } from "./features/settings/KeyVault";

export function App() {
  return (
    <main>
      <h1>JKY Terminal</h1>
      <KeyVault />
    </main>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @jky/desktop test`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(settings): add API key vault UI"
```

---

## Task 9: Bundle secret scan and full CI wiring

**Files:**
- Create: `scripts/scan-bundle.mjs`
- Modify: `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the Vite production build from Task 1 and the UI from Task 8.
- Produces: `pnpm run scan:bundle`, wired into CI as a required check.

- [ ] **Step 1: Write the scanner**

`scripts/scan-bundle.mjs`:

```js
#!/usr/bin/env node
/**
 * Fails the build if anything shaped like a credential is present in the
 * production bundle. Implements the third assertion of spec §4.3.
 *
 * This guards against a real and easy mistake: hard-coding a key while
 * debugging and shipping it to every user who installs the app.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "apps/desktop/dist";

const PATTERNS = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", re: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let failures = 0;

for (const file of walk(DIST)) {
  if (!/\.(js|mjs|cjs|css|html|map|json)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const { name, re } of PATTERNS) {
    for (const match of content.matchAll(re)) {
      const preview = `${match[0].slice(0, 12)}...`;
      console.error(`SECURITY: ${name} found in ${file} (${preview})`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} credential-shaped string(s) in the production bundle. ` +
      `Secrets must live in the OS keychain and be read only by the Rust ` +
      `backend — never compiled into frontend assets. See spec §4.`,
  );
  process.exit(1);
}

console.log("scan-bundle: clean, no credential-shaped strings in the bundle.");
```

- [ ] **Step 2: Wire it into the root scripts**

Add to the root `package.json` `scripts`:

```json
    "scan:bundle": "node scripts/scan-bundle.mjs",
    "verify": "pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && pnpm run scan:bundle"
```

- [ ] **Step 3: Run it against a real build**

```bash
pnpm -w build
pnpm run scan:bundle
```

Expected: `scan-bundle: clean, no credential-shaped strings in the bundle.`

- [ ] **Step 4: Prove the scanner bites**

```bash
echo 'export const oops = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";' \
  > apps/desktop/src/leak-probe.ts
echo 'import "./leak-probe";' >> apps/desktop/src/main.tsx
pnpm -w build && pnpm run scan:bundle    # EXPECT: FAIL, exit 1

git checkout apps/desktop/src/main.tsx
rm apps/desktop/src/leak-probe.ts
pnpm -w build && pnpm run scan:bundle    # EXPECT: PASS
```

Expected: the first run exits non-zero naming the file; the second is clean. Do not skip this — an unverified scanner is worse than none, because it manufactures false confidence.

- [ ] **Step 5: Add the security job to CI**

Append to `.github/workflows/ci.yml`:

```yaml
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w build
      - name: Scan production bundle for credentials
        run: pnpm run scan:bundle
      - name: Assert no secret is committed to the repository
        run: |
          if git grep -nE 'sk-ant-[A-Za-z0-9_-]{20,}' -- ':!docs' ':!scripts' ':!*.test.*'; then
            echo "SECURITY: an API key is committed to the repository."
            exit 1
          fi
          echo "No committed credentials found."
```

The exclusions matter: `docs/`, `scripts/`, and test files legitimately contain key-shaped example strings, and a check that fires on its own fixtures gets disabled within a week.

- [ ] **Step 6: Run the whole verification chain**

Run: `pnpm run verify && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: everything green. Record the actual output — do not claim success without it.

- [ ] **Step 7: Commit**

```bash
git add scripts package.json .github/workflows/ci.yml
git commit -m "test(security): scan production bundle for credential material"
```

---

## Deliberately deferred from this plan

Two spec requirements are intentionally not implemented here. They are recorded so
they cannot be quietly lost:

| Spec | Requirement | Lands in | Why not now |
|---|---|---|---|
| §4.2.5 | Audit log of secret reads, command executions, and AI tool calls | Plan 4, with the `jky-store` crate | The log needs the SQLite layer, and after this plan there is nothing yet to audit: no command execution, no AI tool call, and no code path that reads the stored key. |
| §4.2.6 | Self-hosted Inter and JetBrains Mono | Plan 2, with the design system | No typography exists until the design system does. The CSP written in Task 5 already sets `font-src 'self'`, so the constraint is enforced before the fonts arrive. |

## Definition of Done

Plan 1 is complete when every one of these has been observed, not assumed:

- [ ] `cargo test --workspace` passes; `cargo test -p jky-secrets -- --ignored` passes locally against the real keychain
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` is clean
- [ ] `pnpm run verify` passes end to end
- [ ] Each of the three security guards has been observed **failing** on a deliberate violation and passing after revert (Task 6 Step 3, Task 7 Step 8, Task 9 Step 4)
- [ ] `pnpm tauri dev` opens a window where a key can be saved, shows Connected, survives an app restart, and can be removed
- [ ] `secret-tool search service dev.jky.terminal` (Linux) shows the entry exists, confirming it reached the real OS keychain
- [ ] Every commit shows `kartikeyajay2006 <kartikeyajay2006@gmail.com>` as sole author with no trailers

## What Plan 2 builds on this

Plan 2 (Shell & Terminal) consumes `getPlatform()` and extends the `Platform` interface with a `pty` namespace, moves `<KeyVault />` into a real Settings panel styled with design tokens, and adds the `crates/jky-pty` crate. Nothing in Plan 1 needs to change for that to happen — which is the test of whether these boundaries were drawn correctly.
