use std::io;
use std::path::{Path, PathBuf};

/// The command names that reprint the banner.
///
/// Three spellings because people type what they remember, not what a manual
/// says. On Windows the filesystem is case-insensitive so two of these resolve
/// to one file, which is harmless — the last write wins and every spelling
/// still works.
pub const LAUNCHER_NAMES: &[&str] = &["jky-terminal", "jkyterminal", "jkyTerminal"];

/// Filename holding the pre-rendered banner the launchers print.
const BANNER_FILE: &str = "banner.ansi";

/// Install the banner and the small scripts that print it.
///
/// This is the same trick an editor uses to make its own name work as a shell
/// command: drop a launcher in a directory and put that directory on the PATH
/// of the shell we spawn. Nothing is installed system-wide, nothing outlives
/// the session, and the user's shell configuration is never touched.
pub fn install_launchers(bin_dir: &Path, banner: &str) -> io::Result<()> {
    std::fs::create_dir_all(bin_dir)?;

    let banner_path = bin_dir.join(BANNER_FILE);
    std::fs::write(&banner_path, banner)?;

    for name in LAUNCHER_NAMES {
        write_launcher(bin_dir, name, &banner_path)?;
    }
    Ok(())
}

#[cfg(windows)]
fn write_launcher(bin_dir: &Path, name: &str, banner_path: &Path) -> io::Result<()> {
    // .cmd rather than a bare file: cmd.exe and PowerShell only treat an
    // extension in PATHEXT as executable, and a name with no extension is not.
    let script = bin_dir.join(format!("{name}.cmd"));
    let body = format!("@echo off\r\ntype \"{}\"\r\n", banner_path.display());
    std::fs::write(script, body)
}

#[cfg(not(windows))]
fn write_launcher(bin_dir: &Path, name: &str, banner_path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let script = bin_dir.join(name);
    let body = format!("#!/bin/sh\ncat \"{}\"\n", banner_path.display());
    std::fs::write(&script, body)?;
    // Without the execute bit the shell finds the file and refuses to run it,
    // which looks exactly like the command not existing.
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
}

/// Build a PATH with `bin_dir` in front of the inherited one.
///
/// Prepended rather than appended so our launcher wins over a same-named
/// binary elsewhere, and the inherited PATH is preserved so every other
/// command the user relies on still resolves.
pub fn path_with(bin_dir: &Path, inherited: Option<String>) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    match inherited {
        Some(existing) if !existing.is_empty() => {
            format!("{}{}{}", bin_dir.display(), sep, existing)
        }
        _ => bin_dir.display().to_string(),
    }
}

/// Where the launchers live, given the app's config directory.
pub fn launcher_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("bin")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn every_spelling_of_the_command_is_installed() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello").unwrap();

        for name in LAUNCHER_NAMES {
            let unix = dir.path().join(name);
            let windows = dir.path().join(format!("{name}.cmd"));
            assert!(
                unix.is_file() || windows.is_file(),
                "no launcher installed for '{name}'"
            );
        }
    }

    #[test]
    fn the_banner_is_written_verbatim() {
        let dir = TempDir::new().unwrap();
        let banner = "\u{1b}[38;2;0;229;255m█\u{1b}[0m\r\n";
        install_launchers(dir.path(), banner).unwrap();

        let written = std::fs::read_to_string(dir.path().join(BANNER_FILE)).unwrap();
        assert_eq!(written, banner, "escape sequences must survive intact");
    }

    #[test]
    fn the_launcher_directory_is_created_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("deep/deeper/bin");
        install_launchers(&nested, "hello").unwrap();
        assert!(nested.is_dir());
    }

    #[test]
    fn installing_twice_overwrites_rather_than_failing() {
        // The banner changes with the theme, so this runs on every spawn.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "first").unwrap();
        install_launchers(dir.path(), "second").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(BANNER_FILE)).unwrap(),
            "second"
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn the_unix_launcher_is_executable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello").unwrap();

        let mode = std::fs::metadata(dir.path().join("jky-terminal"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "launcher is not executable");
    }

    #[test]
    #[cfg(not(windows))]
    fn the_unix_launcher_actually_prints_the_banner() {
        // The point of the whole module. If this fails, typing the command
        // does nothing useful no matter how correct the rest looks.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "JKY-BANNER-MARKER").unwrap();

        let out = std::process::Command::new(dir.path().join("jky-terminal"))
            .output()
            .expect("launcher runs");
        assert_eq!(String::from_utf8_lossy(&out.stdout), "JKY-BANNER-MARKER");
    }

    #[test]
    fn our_directory_comes_first_on_the_path() {
        let dir = TempDir::new().unwrap();
        let sep = if cfg!(windows) { ";" } else { ":" };
        let path = path_with(dir.path(), Some(format!("/usr/bin{sep}/bin")));
        assert!(path.starts_with(&dir.path().display().to_string()));
        assert!(path.contains("/usr/bin"), "inherited PATH must be preserved");
    }

    #[test]
    fn an_absent_inherited_path_still_yields_our_directory() {
        let dir = TempDir::new().unwrap();
        assert_eq!(path_with(dir.path(), None), dir.path().display().to_string());
        assert_eq!(
            path_with(dir.path(), Some(String::new())),
            dir.path().display().to_string()
        );
    }

    #[test]
    fn the_launcher_directory_sits_under_the_config_directory() {
        assert_eq!(
            launcher_dir(Path::new("/cfg/jky")),
            PathBuf::from("/cfg/jky/bin")
        );
    }
}
