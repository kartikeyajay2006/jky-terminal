//! This binary, running as a shell's keeper rather than as a window.
//!
//! A detached session needs a process that is not the window, and the
//! cheapest correct one is this program again with an argument. Shipping a
//! second executable would mean a second thing to sign, notarise, package and
//! keep at the same version as the first; `--supervise` costs none of that
//! and cannot drift, because there is only one build.
//!
//! It never touches Tauri. No window, no webview, no event loop — it opens a
//! pty, listens on a socket and pumps bytes until the shell exits. That
//! matters for what it costs to leave running: a supervisor holding an idle
//! shell is a few hundred kilobytes, not a browser.

use std::io::Read;
use std::path::Path;

use jky_detach::{Shell, supervise};
use jky_pty::{PtySession, SpawnConfig, default_shell, home_dir, resolve_start_dir};

/// The argument that turns this program into a supervisor.
pub const FLAG: &str = "--supervise";

/// A pty, seen as the thing a supervisor needs it to be.
struct Pty(PtySession);

impl Shell for Pty {
    fn output(&self) -> std::io::Result<Box<dyn Read + Send>> {
        self.0.take_reader().map_err(std::io::Error::other)
    }

    fn input(&self, bytes: &[u8]) -> std::io::Result<()> {
        self.0.write(bytes).map_err(std::io::Error::other)
    }

    fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        self.0.resize(cols, rows).map_err(std::io::Error::other)
    }

    fn wait(&self) -> std::io::Result<i32> {
        self.0.wait().map_err(std::io::Error::other)
    }

    fn kill(&self) -> std::io::Result<()> {
        self.0.kill().map_err(std::io::Error::other)
    }
}

/// The value of a `--flag value` pair, if it is there.
pub fn argument(args: &[String], flag: &str) -> Option<String> {
    let at = args.iter().position(|a| a == flag)?;
    args.get(at + 1).cloned()
}

/// Where this supervisor was told to keep its records.
///
/// Told, never derived. The window already knows its configuration directory
/// — Tauri resolves it per platform — and a supervisor working it out again
/// from the environment is the same fact in two places, which is one place
/// too many: they disagreed on macOS, where the answer is under
/// `Library/Application Support` and the second derivation said otherwise.
pub const CONFIG_FLAG: &str = "--config-dir";

/// The session this was asked to supervise, if it was asked at all.
///
/// Read from the arguments rather than an environment variable so that what a
/// process is doing is visible in a process list — a supervisor nobody can
/// identify is a supervisor nobody will ever stop.
pub fn requested(args: &[String]) -> Option<String> {
    argument(args, FLAG)
}

/// Run as a supervisor until the shell exits.
///
/// The start directory is resolved the same way a window resolves it, so a
/// detached terminal opens where an attached one would.
pub fn run(config_dir: &Path, session: &str, cwd: Option<String>) -> std::io::Result<()> {
    let pty = PtySession::spawn(spawn_config(config_dir, cwd)).map_err(std::io::Error::other)?;
    supervise(&jky_detach_dir(config_dir), session, Pty(pty))
}

/// The arguments that make this binary hold `session`, starting in `cwd`.
///
/// Built here, beside `requested` and `argument`, so what a window asks for and
/// what a supervisor reads back are written in one place and cannot drift.
pub fn supervise_args(session: &str, config_dir: &Path, cwd: &Path) -> Vec<std::ffi::OsString> {
    vec![
        FLAG.into(),
        session.into(),
        CONFIG_FLAG.into(),
        config_dir.into(),
        "--cwd".into(),
        cwd.into(),
    ]
}

/// What a held shell is started with: everything a window's own shell gets.
///
/// The window installs the launchers and the shell hooks before it asks for a
/// supervisor, so both are there to point at. A launcher directory that is not
/// there means the shell goes without the `jky` commands — never without a
/// shell.
fn spawn_config(config_dir: &Path, cwd: Option<String>) -> SpawnConfig {
    let launchers = jky_pty::launcher_dir(config_dir);
    SpawnConfig {
        shell: default_shell(),
        cwd: resolve_start_dir(cwd.as_deref(), home_dir()),
        // The window resizes it the moment it attaches. This is only what the
        // shell sees before anybody is looking, and it has to be *something*:
        // a pty of zero columns is rejected outright on some platforms.
        cols: 80,
        rows: 24,
        path_prepend: launchers.is_dir().then_some(launchers),
        config_dir: Some(config_dir.to_path_buf()),
    }
}

/// Where sessions are recorded.
///
/// Under the config directory rather than a runtime one, because the two are
/// the same place on Windows and macOS and this app already knows the former.
pub fn jky_detach_dir(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("detached")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_named_by_the_argument_after_the_flag() {
        let args = vec!["jky-terminal".into(), FLAG.into(), "pty-3".into()];
        assert_eq!(requested(&args).as_deref(), Some("pty-3"));
    }

    #[test]
    fn an_ordinary_launch_supervises_nothing() {
        assert_eq!(requested(&["jky-terminal".to_string()]), None);
        // The flag with nothing after it is a mistake, not a session called
        // nothing — and starting a window is the safer of the two readings.
        assert_eq!(requested(&["jky-terminal".into(), FLAG.into()]), None);
    }

    #[test]
    fn the_flag_is_found_wherever_it_sits() {
        let args = vec!["jky-terminal".into(), "--other".into(), FLAG.into(), "s1".into()];
        assert_eq!(requested(&args).as_deref(), Some("s1"));
    }

    #[test]
    fn the_configuration_directory_is_given_rather_than_guessed() {
        let args = vec![
            "jky-terminal".into(),
            FLAG.into(),
            "s1".into(),
            CONFIG_FLAG.into(),
            "/somewhere".into(),
        ];
        assert_eq!(argument(&args, CONFIG_FLAG).as_deref(), Some("/somewhere"));
        assert_eq!(argument(&args, "--absent"), None);
    }

    #[test]
    fn sessions_live_beside_the_rest_of_the_configuration() {
        assert_eq!(jky_detach_dir(Path::new("/cfg")), Path::new("/cfg/detached"));
    }
    #[test]
    fn a_supervisor_is_asked_for_by_name_directory_and_start() {
        let args = supervise_args("pane-2", Path::new("/cfg"), Path::new("/work"));
        let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--supervise", "pane-2", "--config-dir", "/cfg", "--cwd", "/work"]);

        // What the window asks for is what this binary reads back, so the two
        // cannot drift apart without this failing.
        let launched = [vec!["jky-terminal".to_string()], args.clone()].concat();
        assert_eq!(requested(&launched).as_deref(), Some("pane-2"));
        assert_eq!(argument(&launched, CONFIG_FLAG).as_deref(), Some("/cfg"));
        assert_eq!(argument(&launched, "--cwd").as_deref(), Some("/work"));
    }

    #[test]
    fn a_held_shell_has_the_jky_commands_when_the_window_installed_them() {
        let config = tempfile::tempdir().expect("a scratch directory");
        assert_eq!(
            spawn_config(config.path(), None).path_prepend,
            None,
            "pointed PATH at launchers that were never installed"
        );

        std::fs::create_dir_all(jky_pty::launcher_dir(config.path())).unwrap();
        assert_eq!(
            spawn_config(config.path(), None).path_prepend,
            Some(jky_pty::launcher_dir(config.path())),
            "a held shell went without the jky commands a window's shell has"
        );
    }
}
