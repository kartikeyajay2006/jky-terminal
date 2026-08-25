//! Cross-platform packaging assertions.
//!
//! JKY Terminal ships on macOS, Windows and Linux. Some packaging inputs are
//! required by only one of those platforms, which makes them easy to omit —
//! the build stays green everywhere else. These tests fail on every platform
//! so a missing asset is caught before CI, not after.

use std::fs;
use std::path::PathBuf;

fn icons_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons")
}

#[test]
fn the_windows_icon_exists() {
    let ico = icons_dir().join("icon.ico");
    assert!(
        ico.is_file(),
        "PACKAGING: {} is missing. tauri-build requires icon.ico to generate the \
         Windows Resource file and fails the build on windows-latest with \
         '`icons/icon.ico` not found'. Linux and macOS builds do not need it, so \
         its absence is invisible until the Windows job runs. Regenerate the set \
         with: pnpm --filter @jky/desktop exec tauri icon src-tauri/icons/icon.png",
        ico.display()
    );
}

#[test]
fn the_macos_icon_exists() {
    let icns = icons_dir().join("icon.icns");
    assert!(
        icns.is_file(),
        "PACKAGING: {} is missing. macOS app bundles require an .icns icon.",
        icns.display()
    );
}

#[test]
fn every_icon_declared_in_tauri_conf_is_present_on_disk() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let raw = fs::read_to_string(root.join("tauri.conf.json")).expect("readable config");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("valid JSON");

    let icons = conf["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon is an array");
    assert!(!icons.is_empty(), "PACKAGING: no bundle icons are declared");

    for entry in icons {
        let rel = entry.as_str().expect("icon entry is a string");
        let path = root.join(rel);
        assert!(
            path.is_file(),
            "PACKAGING: tauri.conf.json declares '{rel}' but {} does not exist",
            path.display()
        );
    }
}
