# Contributing to JKY Terminal

Thanks for wanting to help. JKY is a young, one-maintainer project, so small, well-tested changes that
make the terminal more dependable are the most valuable contributions of all.

## Before you start

- **Read the direction.** [The product roadmap](docs/product-roadmap.md) says what matters now —
  reliability, release trust, the terminal core — and what is deliberately *not* being built yet.
  New apps, games and dashboard tiles have a high bar; terminal reliability work does not.
- **Open an issue first** for anything bigger than a bug fix, so the approach can be agreed before
  you spend time on it.
- **Security problems are never public issues.** See [SECURITY.md](SECURITY.md).

## Local setup

The full walk-through, per operating system, is in [Getting started](docs/getting-started.md). In
short:

```sh
git clone https://github.com/kartikeyajay2006/jky-terminal.git
cd jky-terminal
corepack enable && pnpm install
pnpm dev:desktop            # the desktop app, with native shells
pnpm dev                    # the interface alone, in a browser
```

## The rules the tests enforce

These are not style preferences: tests or lint rules fail if they are broken. The
[architecture guide](docs/architecture.md) explains each one.

1. **The window can ask; only Rust can act.** Real logic lives in a crate under `crates/`.
   `apps/desktop/src-tauri/src/commands/` holds thin `#[tauri::command]` wrappers only.
2. **Every native capability goes through `apps/desktop/src/platform/`.** A component calling
   `invoke()` directly is a lint error — that boundary is what lets the interface run, and be tested,
   in a browser. A new capability needs both `tauri.ts` and the in-memory `web.ts`.
3. **Adding an IPC command is a security decision.** `apps/desktop/src-tauri/tests/security.rs` pins
   the exact list by name. Add yours there with a comment saying why the window needs it. No command
   may return a secret, and none may touch the audit log.
4. **No literal colours in components.** Themes are token sets in `tokens.css` and `themes.css`, and
   a test checks every theme's contrast.
5. **Files are opened beneath a handle.** Editor and assistant file access goes through `jky-files`
   or the `jky-ai` sandbox — never `std::fs` on a path built from window or model input.
6. **Documents are versioned.** A JSON file a store reads and writes goes through `jky-persist`, with
   a schema number and a migration for any change of shape.

## Checks to run before a pull request

```sh
pnpm run verify                                        # typecheck, lint, test, build, bundle scan
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

CI runs these on **Linux, macOS and Windows** with `fail-fast: false`. A change that passes on one
machine has proved a third of what it needs to — if you touch paths, processes, shells or the
keychain, think about the other two.

## Writing tests

- **Test behaviour, not implementation.** Name the test after what must be true: `a_link_swapped_mid_read_never_lets_an_outside_file_through`, not `test_read_2`.
- **For a bug, write the failing test first** and watch it fail for the right reason.
- **Prefer real things to mocks** — a real temporary directory, a real PTY, a real recorded shell
  session.

## Docs

- A change in behaviour updates the guide that describes it, in the same pull request.
- **Every claim must be true of the code.** If a feature has a limit, the limit is written next to
  it. If something is planned, it is labelled planned.

## Branches, commits and pull requests

- Branches: `feat/…`, `fix/…`, `docs/…`, `test/…`, `chore/…`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): …`,
  `fix(scope): …`, `docs: …`. The body explains *why*, not just what.
- Keep pull requests small and focused; several small ones beat one large one.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
