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

/// Filename holding the pre-rendered command list.
const COMMANDS_FILE: &str = "commands.ansi";

/// OSC code carrying a question from the shell to the assistant panel.
///
/// 1337 is the iTerm2 convention for application-defined sequences. Terminals
/// that do not recognise it ignore it silently, which is exactly the
/// behaviour we want if this script is ever run outside JKY Terminal.
pub const ASK_OSC: u16 = 1337;

/// Install the banner and the small scripts that print it.
///
/// This is the same trick an editor uses to make its own name work as a shell
/// command: drop a launcher in a directory and put that directory on the PATH
/// of the shell we spawn. Nothing is installed system-wide, nothing outlives
/// the session, and the user's shell configuration is never touched.
pub fn install_launchers(bin_dir: &Path, banner: &str, commands: &str) -> io::Result<()> {
    std::fs::create_dir_all(bin_dir)?;

    let banner_path = bin_dir.join(BANNER_FILE);
    std::fs::write(&banner_path, banner)?;

    let commands_path = bin_dir.join(COMMANDS_FILE);
    std::fs::write(&commands_path, commands)?;

    for name in LAUNCHER_NAMES {
        write_launcher(bin_dir, name, &banner_path)?;
    }
    write_ask_launcher(bin_dir, &banner_path, &commands_path)?;
    Ok(())
}

/// The `jky` command: `jky ask <question>` sends a question to the assistant.
///
/// It emits an OSC escape sequence rather than talking to the app directly.
/// The sequence travels the pty like any other output, the terminal decodes
/// it, and nothing has to know the app's address or hold a socket open. Run
/// outside JKY Terminal it prints nothing and does no harm.
#[cfg(not(windows))]
fn write_ask_launcher(
    bin_dir: &Path,
    banner_path: &Path,
    commands_path: &Path,
) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let script = bin_dir.join("jky");
    let body = format!(
        r#"#!/bin/sh
case "$1" in
  ask|asks)
    shift
    if [ $# -eq 0 ]; then
      echo "usage: jky ask <question>" >&2
      exit 1
    fi
    # base64 so a question containing quotes, newlines, or the terminator
    # itself cannot break out of the sequence. `tr -d` rather than `base64 -w0`
    # because the BSD base64 on macOS has no -w flag.
    payload=$(printf '%s' "$*" | base64 | tr -d '\n')
    printf '\033]{osc};JKYAsk=%s\007' "$payload"
    ;;
  commands|command|help|--help|-h)
    cat "{commands}"
    ;;
  ""|banner)
    cat "{banner}"
    ;;
  *)
    echo "jky: unknown command '$1'" >&2
    cat "{commands}" >&2
    exit 1
    ;;
esac
"#,
        osc = ASK_OSC,
        banner = banner_path.display(),
        commands = commands_path.display()
    );
    std::fs::write(&script, body)?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
}

#[cfg(windows)]
fn write_ask_launcher(
    bin_dir: &Path,
    banner_path: &Path,
    commands_path: &Path,
) -> io::Result<()> {
    let script = bin_dir.join("jky.cmd");
    let body = format!(
        "@echo off\r\n\
         if /i \"%1\"==\"ask\" goto ask\r\n\
         if /i \"%1\"==\"asks\" goto ask\r\n\
         if /i \"%1\"==\"commands\" goto cmds\r\n\
         if /i \"%1\"==\"command\" goto cmds\r\n\
         if /i \"%1\"==\"help\" goto cmds\r\n\
         type \"{banner}\"\r\n\
         goto :eof\r\n\
         :cmds\r\n\
         type \"{commands}\"\r\n\
         goto :eof\r\n\
         :ask\r\n\
         shift\r\n\
         powershell -NoProfile -Command \"$q = $args -join ' '; $b = \
         [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q)); \
         [Console]::Write([char]27 + ']{osc};JKYAsk=' + $b + [char]7)\" %*\r\n",
        osc = ASK_OSC,
        banner = banner_path.display(),
        commands = commands_path.display()
    );
    std::fs::write(script, body)
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
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();

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
        install_launchers(dir.path(), banner, "COMMAND-LIST").unwrap();

        let written = std::fs::read_to_string(dir.path().join(BANNER_FILE)).unwrap();
        assert_eq!(written, banner, "escape sequences must survive intact");
    }

    #[test]
    fn the_launcher_directory_is_created_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("deep/deeper/bin");
        install_launchers(&nested, "hello", "COMMAND-LIST").unwrap();
        assert!(nested.is_dir());
    }

    #[test]
    fn installing_twice_overwrites_rather_than_failing() {
        // The banner changes with the theme, so this runs on every spawn.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "first", "c1").unwrap();
        install_launchers(dir.path(), "second", "c2").unwrap();
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
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();

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
        install_launchers(dir.path(), "JKY-BANNER-MARKER", "COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky-terminal"))
            .output()
            .expect("launcher runs");
        assert_eq!(String::from_utf8_lossy(&out.stdout), "JKY-BANNER-MARKER");
    }

    #[test]
    fn the_jky_command_is_installed() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();
        assert!(
            dir.path().join("jky").is_file() || dir.path().join("jky.cmd").is_file(),
            "the jky command is missing"
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_ask_emits_an_osc_sequence_carrying_the_question() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky"))
            .args(["ask", "what", "does", "ls", "do"])
            .output()
            .expect("jky runs");
        let stdout = String::from_utf8_lossy(&out.stdout);

        assert!(stdout.contains("JKYAsk="), "no ask marker in: {stdout:?}");
        assert!(stdout.starts_with('\u{1b}'), "the sequence must start with ESC");

        // The question survives the round trip through base64.
        let encoded = stdout
            .trim_end_matches('\u{7}')
            .rsplit("JKYAsk=")
            .next()
            .unwrap();
        let decoded = String::from_utf8(base64_decode(encoded)).unwrap();
        assert_eq!(decoded, "what does ls do");
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_asks_is_accepted_as_well_as_jky_ask() {
        // People type what they remember, and both readings are natural.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky"))
            .args(["asks", "hello"])
            .output()
            .expect("jky runs");
        assert!(String::from_utf8_lossy(&out.stdout).contains("JKYAsk="));
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_ask_with_no_question_explains_itself_instead_of_emitting_nothing() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky"))
            .arg("ask")
            .output()
            .expect("jky runs");
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("usage"));
    }

    #[test]
    #[cfg(not(windows))]
    fn bare_jky_prints_the_banner() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "THE-BANNER", "COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky"))
            .output()
            .expect("jky runs");
        assert_eq!(String::from_utf8_lossy(&out.stdout), "THE-BANNER");
    }

    /// Minimal base64 decoder, so the test verifies the payload rather than
    /// trusting that the encoder and decoder agree.
    #[cfg(not(windows))]
    fn base64_decode(input: &str) -> Vec<u8> {
        const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new();
        let mut buf = 0u32;
        let mut bits = 0u32;
        for ch in input.bytes().filter(|c| *c != b'=' && !c.is_ascii_whitespace()) {
            let Some(idx) = TABLE.iter().position(|c| *c == ch) else {
                continue;
            };
            buf = (buf << 6) | idx as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        out
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_commands_prints_the_command_list() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "THE-COMMAND-LIST").unwrap();

        for spelling in ["commands", "command", "help"] {
            let out = std::process::Command::new(dir.path().join("jky"))
                .arg(spelling)
                .output()
                .expect("jky runs");
            assert_eq!(
                String::from_utf8_lossy(&out.stdout),
                "THE-COMMAND-LIST",
                "`jky {spelling}` did not print the list"
            );
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn an_unknown_subcommand_shows_the_list_rather_than_a_bare_error() {
        // Being told a command does not exist, without being told what does,
        // is the least useful possible response.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "THE-COMMAND-LIST").unwrap();

        let out = std::process::Command::new(dir.path().join("jky"))
            .arg("nonsense")
            .output()
            .expect("jky runs");
        assert!(!out.status.success());
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(stderr.contains("unknown command"));
        assert!(stderr.contains("THE-COMMAND-LIST"));
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
