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
}

/// The session this was asked to supervise, if it was asked at all.
///
/// Read from the arguments rather than an environment variable so that what a
/// process is doing is visible in a process list — a supervisor nobody can
/// identify is a supervisor nobody will ever stop.
pub fn requested(args: &[String]) -> Option<String> {
    let at = args.iter().position(|a| a == FLAG)?;
    args.get(at + 1).cloned()
}

/// Run as a supervisor until the shell exits.
///
/// The start directory is resolved the same way a window resolves it, so a
/// detached terminal opens where an attached one would.
pub fn run(config_dir: &Path, session: &str, cwd: Option<String>) -> std::io::Result<()> {
    let start = resolve_start_dir(cwd.as_deref(), home_dir());

    let pty = PtySession::spawn(SpawnConfig {
        shell: default_shell(),
        cwd: start,
        // The window resizes it the moment it attaches. This is only what the
        // shell sees before anybody is looking, and it has to be *something*:
        // a pty of zero columns is rejected outright on some platforms.
        cols: 80,
        rows: 24,
        path_prepend: None,
        config_dir: Some(config_dir.to_path_buf()),
    })
    .map_err(std::io::Error::other)?;

    supervise(&jky_detach_dir(config_dir), session, Pty(pty))
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
    fn sessions_live_beside_the_rest_of_the_configuration() {
        assert_eq!(jky_detach_dir(Path::new("/cfg")), Path::new("/cfg/detached"));
    }
}
