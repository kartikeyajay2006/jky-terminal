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
    for runner in ["ubuntu-latest", "macos-latest", "windows-latest"] {
        assert!(yaml.contains(runner), "release does not build on {runner}");
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
    assert!(release_workflow().contains("releaseDraft: true"));
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
