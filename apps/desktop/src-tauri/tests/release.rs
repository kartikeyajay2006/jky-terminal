//! What a shippable build has to say about itself.
//!
//! These read the configuration and the workflow as files. None of it can be
//! checked by compiling — an installer with no description, or a release
//! pipeline that quietly skips a platform, builds perfectly well and is only
//! noticed by whoever downloads it.

use std::fs;
use std::path::PathBuf;

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn repo_root() -> PathBuf {
    // apps/desktop/src-tauri → repo root
    crate_root().join("../../..").canonicalize().expect("repo root resolves")
}

fn config() -> serde_json::Value {
    let raw = fs::read_to_string(crate_root().join("tauri.conf.json"))
        .expect("tauri.conf.json is readable");
    serde_json::from_str(&raw).expect("valid JSON")
}

fn release_workflow() -> String {
    fs::read_to_string(repo_root().join(".github/workflows/release.yml"))
        .expect("a release workflow exists")
}

#[test]
fn the_bundle_is_switched_on() {
    assert_eq!(config()["bundle"]["active"], serde_json::json!(true));
}

#[test]
fn the_installer_describes_itself() {
    // An installer with no description shows up in a package manager as a
    // name and nothing else.
    let bundle = &config()["bundle"];
    for field in ["shortDescription", "longDescription", "publisher", "category"] {
        let value = bundle[field].as_str().unwrap_or_default();
        assert!(!value.is_empty(), "bundle.{field} is empty");
    }
}

#[test]
fn the_licence_ships_with_the_build() {
    let config = config();
    let path = config["bundle"]["licenseFile"]
        .as_str()
        .expect("bundle.licenseFile is set");
    let resolved = crate_root().join(path);
    assert!(resolved.is_file(), "licence not found at {}", resolved.display());
}

#[test]
fn the_linux_package_declares_the_webview_it_cannot_start_without() {
    // Without this the .deb installs cleanly and the app fails to launch,
    // which is the worst of both.
    let depends = config()["bundle"]["linux"]["deb"]["depends"]
        .as_array()
        .expect("deb dependencies are declared")
        .iter()
        .filter_map(|d| d.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(depends.contains("webkit2gtk"), "missing webkit: {depends}");
}

#[test]
fn windows_installs_without_administrator() {
    // The app only ever writes to the user's own config directory, so asking
    // for elevation would be asking for something it does not need.
    assert_eq!(
        config()["bundle"]["windows"]["nsis"]["installMode"],
        serde_json::json!("currentUser")
    );
}

#[test]
fn the_version_matches_the_package_it_ships_as() {
    // Three files carry the version and a release where they disagree is one
    // where the installer and the About box say different things.
    let tauri_version = config()["version"].as_str().unwrap().to_string();

    let pkg: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(crate_root().join("../package.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(pkg["version"].as_str().unwrap(), tauri_version);

    let cargo = fs::read_to_string(repo_root().join("Cargo.toml")).unwrap();
    assert!(
        cargo.contains(&format!("version = \"{tauri_version}\"")),
        "workspace Cargo.toml does not carry {tauri_version}"
    );
}

#[test]
fn the_release_workflow_builds_every_platform_we_ship_on() {
    // A pipeline that quietly drops a platform produces a release where one
    // third of users have nothing to download.
    let yaml = release_workflow();
    for runner in ["os: ubuntu-22.04", "os: macos-latest", "os: windows-latest"] {
        assert!(yaml.contains(runner), "release does not build on {runner}");
    }
}

#[test]
fn the_linux_build_is_made_on_the_oldest_ubuntu_it_supports() {
    // An AppImage carries its libraries but not glibc: it runs only where
    // glibc is at least as new as the machine that built it. Built on the
    // newest Ubuntu, it would refuse to start on Ubuntu 22.04, Debian 12 or
    // RHEL 9 — so the build machine is the oldest one, not the latest.
    let yaml = release_workflow();
    let build = yaml.split("\n  integrity:").next().unwrap();
    assert!(build.contains("os: ubuntu-22.04"), "Linux is not built on 22.04");
    assert!(!build.contains("os: ubuntu-latest"), "Linux is built on the newest Ubuntu");
}

#[test]
fn mac_builds_are_signed_at_least_ad_hoc() {
    // Apple Silicon will not run code that carries no signature at all. With
    // no Developer ID to sign with yet, the free ad-hoc signature ("-") is
    // what lets an installed copy start.
    assert_eq!(config()["bundle"]["macOS"]["signingIdentity"], serde_json::json!("-"));
}

#[test]
fn a_release_is_installed_and_started_before_anyone_can_download_it() {
    // A build can succeed and still not install. Before the draft is
    // published, the one-line installers install it from the release's own
    // files, on each platform, and the app has to start.
    let yaml = release_workflow();
    let smoke = yaml.split("\n  smoke:").nth(1).expect("a smoke job runs on the draft");
    assert!(smoke.contains("needs: integrity"), "smoke runs before SHA256SUMS exists");
    for needed in ["install.sh", "install.ps1", "--set-shortcut", "uninstall"] {
        assert!(smoke.contains(needed), "the smoke job never exercises {needed}");
    }
    for runner in ["ubuntu-22.04", "ubuntu-latest", "macos-latest", "windows-latest"] {
        assert!(smoke.contains(runner), "the smoke job skips {runner}");
    }
}

#[test]
fn the_release_workflow_builds_both_mac_architectures() {
    // The runners are Apple Silicon, so an Intel build is a cross compile
    // that has to be asked for explicitly or it silently never happens.
    let yaml = release_workflow();
    assert!(yaml.contains("aarch64-apple-darwin"), "no Apple Silicon target");
    assert!(yaml.contains("x86_64-apple-darwin"), "no Intel target");
}

#[test]
fn one_platform_failing_does_not_cancel_the_others() {
    // A macOS signing problem should still leave working Linux and Windows
    // builds rather than three failures.
    assert!(release_workflow().contains("fail-fast: false"));
}

#[test]
fn a_release_is_drafted_rather_than_published() {
    // The last chance to notice that something built cleanly and is wrong.
    assert!(release_workflow().contains("-F draft=true"));
}

#[test]
fn every_platform_attaches_to_one_draft() {
    // Left to find or create the draft themselves, builds that finish within
    // a second of each other each create one: two drafts with one tag, and
    // SHA256SUMS covering whichever the checksum job happened to find. The
    // draft is created once, first, and every build is handed its id.
    let yaml = release_workflow();
    assert!(yaml.contains("\n  draft:"), "no job creates the draft first");
    assert!(
        yaml.contains("releaseId: ${{ needs.draft.outputs.id }}"),
        "the builds do not attach to the one draft"
    );
    assert!(!yaml.contains("releaseDraft:"), "a build can still create a draft of its own");
}

#[test]
fn the_release_is_triggered_by_a_tag() {
    let yaml = release_workflow();
    assert!(yaml.contains("tags:"), "not tag-driven");
    assert!(yaml.contains("workflow_dispatch"), "cannot be run by hand");
}

#[test]
fn releasing_is_documented_including_what_is_not_done_yet() {
    // Signing and auto-update are both off. Someone reading this repo has to
    // be able to find that out without reading the workflow.
    let doc = fs::read_to_string(repo_root().join("docs/RELEASING.md"))
        .expect("docs/RELEASING.md exists");
    for topic in ["unsigned", "APPLE_CERTIFICATE", "updater", "pubkey"] {
        assert!(doc.contains(topic), "RELEASING.md does not mention {topic}");
    }
}

#[test]
fn no_signing_key_is_committed() {
    // The private key would let anyone publish an update every installed copy
    // would trust. It belongs in repository secrets and nowhere else.
    let config = fs::read_to_string(crate_root().join("tauri.conf.json")).unwrap();
    assert!(!config.contains("PRIVATE KEY"), "a key is in tauri.conf.json");
    assert!(
        !repo_root().join("apps/desktop/src-tauri/jky.key").exists(),
        "a signing key is committed"
    );
}

#[test]
fn every_release_carries_checksums_for_every_file() {
    // A download that cannot be checked against something the release
    // itself published is a download taken on trust.
    let yaml = release_workflow();
    assert!(yaml.contains("SHA256SUMS"), "no checksum file is published");
    assert!(yaml.contains("sha256sum"), "checksums are never computed");
}

#[test]
fn every_release_carries_a_software_bill_of_materials() {
    let yaml = release_workflow();
    assert!(yaml.contains("anchore/sbom-action"), "no SBOM is generated");
    assert!(yaml.contains("spdx-json"), "the SBOM is not SPDX");
}

#[test]
fn release_files_are_attested_to_the_workflow_that_built_them() {
    // Provenance: a signed statement, checkable with `gh attestation verify`,
    // that this file came from this repository's release workflow at this
    // commit — not from a laptop, and not from a fork.
    let yaml = release_workflow();
    assert!(yaml.contains("actions/attest-build-provenance"), "no build provenance");
    assert!(yaml.contains("actions/attest-sbom"), "the SBOM is not attested");
    assert!(yaml.contains("id-token: write"), "attesting needs an OIDC token");
    assert!(yaml.contains("attestations: write"), "attesting needs to write attestations");
}

#[test]
fn integrity_waits_for_every_platform() {
    // Checksums over half a release would vouch for half a release.
    assert!(release_workflow().contains("needs: release"));
}

#[test]
fn every_action_the_release_runs_is_pinned_to_a_commit() {
    // A tag such as `@v0` can be moved by whoever controls that repository,
    // and the next release would run whatever it now points at — with this
    // repository's token and the power to publish its installers.
    for line in release_workflow().lines() {
        let Some(uses) = line.trim().trim_start_matches("- ").strip_prefix("uses:") else {
            continue;
        };
        let reference = uses.split_whitespace().next().unwrap_or("");
        let (_, at) = reference.split_once('@').unwrap_or((reference, ""));
        assert!(
            at.len() == 40 && at.chars().all(|c| c.is_ascii_hexdigit()),
            "not pinned to a commit: {reference}"
        );
    }
}

#[test]
fn verifying_a_download_is_documented() {
    let doc = fs::read_to_string(repo_root().join("docs/RELEASING.md")).unwrap();
    for topic in ["SHA256SUMS", "sha256sum -c", "gh attestation verify", "SBOM"] {
        assert!(doc.contains(topic), "RELEASING.md does not explain {topic}");
    }
}

/// The version a lockfile pins for `name`, read from the line after it.
fn locked(lock: &str, marker: &str) -> String {
    let at = lock.find(marker).unwrap_or_else(|| panic!("{marker} is not locked"));
    lock[at + marker.len()..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect()
}

#[test]
fn the_rust_and_npm_halves_of_tauri_are_the_same_minor_version() {
    // `tauri build` refuses to bundle when the `tauri` crate and the
    // `@tauri-apps/api` package differ in major or minor version. A dev build
    // never checks, so without this the mismatch is found by the release.
    let cargo = fs::read_to_string(repo_root().join("Cargo.lock")).unwrap();
    let pnpm = fs::read_to_string(repo_root().join("pnpm-lock.yaml")).unwrap();
    let rust = locked(&cargo, "name = \"tauri\"\nversion = \"");
    let npm = locked(&pnpm, "\n  '@tauri-apps/api@");
    let minor = |v: &str| v.split('.').take(2).collect::<Vec<_>>().join(".");
    assert_eq!(minor(&rust), minor(&npm), "tauri {rust} but @tauri-apps/api {npm}");
}

#[test]
fn every_platform_has_the_icon_format_its_installer_needs() {
    // Windows will not bundle without a .ico, and macOS wants a .icns; a PNG
    // alone builds everywhere except, at the last step, the Windows release.
    let config = config();
    let icons: Vec<&str> = config["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon is a list")
        .iter()
        .filter_map(|i| i.as_str())
        .collect();
    for ext in [".ico", ".icns", ".png"] {
        let found = icons.iter().find(|i| i.ends_with(ext));
        let found = found.unwrap_or_else(|| panic!("no {ext} icon in bundle.icon"));
        assert!(crate_root().join(found).is_file(), "{found} is listed but missing");
    }
}
