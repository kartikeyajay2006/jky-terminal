# Operations and releases

This guide is for maintainers, contributors, and evaluators who need to validate the application rather than only run it. JKY is a cross-platform desktop product; a successful frontend build alone is not enough evidence that a release works.

## Validation ladder

Run the narrowest useful check while developing, then use the full ladder before a release:

```sh
# Fast local feedback
pnpm -w typecheck
pnpm -w lint
pnpm -w test

# Native workspace confidence
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Full repository validation
pnpm verify
```

The exact scripts are defined in the root `package.json`. `pnpm verify` is intentionally broad: it cleans build output, typechecks, lints, tests, builds, and scans production bundle output. Run it from a clean working tree when you need release confidence.

## What CI proves

The checked-in CI workflow runs frontend checks on Linux and native Rust tests, Clippy, and desktop builds on Linux, macOS, and Windows. It also runs dependency audit jobs and security assertions such as production-bundle scanning and source-level boundary checks.

CI is evidence, not a substitute for release testing. It does not automatically prove that a package installs cleanly on every user machine, that an update migrates safely, or that every interactive terminal workflow feels correct under real load.

## Tag-driven packages

The release workflow is triggered by version-like tags and can also be run manually. It builds draft release assets for Linux, Apple Silicon macOS, Intel macOS, and Windows. Draft status is intentional: a human must inspect the result before publishing it.

Before tagging, verify:

1. The branch is the intended commit and has no uncommitted release changes.
2. CI is green for that commit.
3. Version, release notes, and supported platforms are accurate.
4. Native desktop launch has been smoke-tested on each available target.
5. You understand the signing state of the packages.

## Current distribution status

The release workflow is prepared for signing secrets, but the checked-in release notes explicitly state that packages are currently unsigned until certificates are configured. This means macOS and Windows can show platform warnings on first launch. Do not describe an unsigned build as fully production-trusted.

Before a public stable release, complete and verify:

- Windows code-signing certificate integration and SmartScreen reputation planning;
- macOS Developer ID signing, notarisation, and stapling;
- Linux package installation tests for supported distributions;
- a signed updater strategy with rollback and release-channel policy;
- a published support matrix and minimum operating-system versions;
- release artefacts with checksums, SBOMs, and provenance where feasible.

## Release smoke test

Test a built package outside the development checkout when possible. A high-value smoke test covers:

| Area | Verify |
|---|---|
| Install and launch | The package installs, starts, and can be removed cleanly. |
| Terminal | A local shell opens; typing, output, resizing, search, and Ctrl+C work. |
| Persistence | A controlled long-running process behaves correctly across a window reconnect. |
| Files | Opening, saving, and cancelling an edit behaves as expected in an explicit folder. |
| Settings | Theme, font, and preference changes survive a restart where intended. |
| Assistant | No provider key is exposed in the UI; approvals are visible and cancellable. |
| Remote | Connection setup honours normal SSH identity and host verification. |
| Upgrade | A prior version can be upgraded without losing expected local state. |

Record the platform, package hash, test account, result, and any exceptions. Never perform production smoke testing with live secrets or irreversible infrastructure changes.

## Observability and support

JKY should keep product diagnostics local and opt-in. A world-class terminal needs performance evidence—startup, first prompt, output throughput, renderer frame time, memory, and reconnect time—but users should know exactly what is collected and be able to decline it.

When reporting a bug, include version or commit, platform, shell, reproduction steps, expected behaviour, actual behaviour, and a redacted log. “It broke” is difficult to fix; a one-command reproduction is excellent.

## Maintainer release checklist

- [ ] Update current capability and known-limit documentation.
- [ ] Run the full verification ladder.
- [ ] Confirm the generated assets and docs links render from the repository.
- [ ] Validate package installation on the intended operating systems.
- [ ] Check signing/notarisation outcome, package hashes, and draft release notes.
- [ ] Publish only after a human verifies the draft assets.
- [ ] Monitor issue reports and provide a documented rollback plan.

The detailed release setup is maintained in [RELEASING.md](RELEASING.md). Read it alongside this guide; it contains the repository-specific commands and credential configuration.
