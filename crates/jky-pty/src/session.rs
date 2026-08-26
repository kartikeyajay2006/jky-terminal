use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use portable_pty::{Child, CommandBuilder, PtyPair, PtySize, native_pty_system};

use crate::shell::{ShellSpec, default_shell, pty_env};
use crate::start_dir::{home_dir, resolve_start_dir};

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("could not open a pty: {0}")]
    Open(String),
    // Not named `source`: thiserror treats a field with that name as a nested
    // std::error::Error and will not accept a String.
    #[error("could not start '{program}': {reason}")]
    Spawn { program: String, reason: String },
    #[error("pty io error: {0}")]
    Io(String),
}

pub struct SpawnConfig {
    pub shell: ShellSpec,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

impl Default for SpawnConfig {
    fn default() -> Self {
        Self {
            shell: default_shell(),
            // Not current_dir(): that is wherever the binary was launched
            // from, which is the project folder in development and something
            // arbitrary from an installed shortcut.
            cwd: resolve_start_dir(None, home_dir()),
            cols: 80,
            rows: 24,
        }
    }
}

pub struct PtySession {
    // PtyPair holds `Box<dyn MasterPty + Send>` and `Box<dyn SlavePty + Send>`,
    // which are Send but not Sync. The session lives in Tauri's managed state
    // and is therefore shared across threads, so the pair goes behind a Mutex.
    // That is a real guarantee; an `unsafe impl Sync` here would only be an
    // assertion that the pty implementations are internally thread-safe, which
    // their types deliberately do not promise.
    pair: Mutex<PtyPair>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

/// A pane can measure zero during its first layout pass, and a zero dimension
/// is rejected outright by some platforms' pty APIs. Clamp rather than fail.
fn clamp(cols: u16, rows: u16) -> (u16, u16) {
    (cols.max(1), rows.max(1))
}

impl PtySession {
    pub fn spawn(config: SpawnConfig) -> Result<Self, PtyError> {
        let (cols, rows) = clamp(config.cols, config.rows);

        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Open(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&config.shell.program);
        for arg in &config.shell.args {
            cmd.arg(arg);
        }
        cmd.cwd(&config.cwd);
        for (k, v) in pty_env() {
            cmd.env(k, v);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| PtyError::Spawn {
            program: config.shell.program.clone(),
            reason: e.to_string(),
        })?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Io(e.to_string()))?;

        Ok(Self {
            pair: Mutex::new(pair),
            child: Mutex::new(child),
            writer: Mutex::new(writer),
        })
    }

    /// Hand out the output stream. The caller owns the read side and is
    /// expected to pump it on its own thread, because reading a pty blocks.
    pub fn take_reader(&self) -> Result<Box<dyn Read + Send>, PtyError> {
        let pair = self.pair.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        pair.master
            .try_clone_reader()
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn write(&self, bytes: &[u8]) -> Result<(), PtyError> {
        let mut w = self.writer.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        w.write_all(bytes).map_err(|e| PtyError::Io(e.to_string()))?;
        w.flush().map_err(|e| PtyError::Io(e.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        let (cols, rows) = clamp(cols, rows);
        let pair = self.pair.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        pair.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Io(e.to_string()))
    }

    /// Terminate the child. Safe to call more than once — a process that has
    /// already exited is the desired end state, not an error.
    pub fn kill(&self) -> Result<(), PtyError> {
        let mut child = self.child.lock().map_err(|e| PtyError::Io(e.to_string()))?;
        let _ = child.kill();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// A command that echoes a marker and exits, spelled for the host platform.
    fn echo_marker() -> ShellSpec {
        #[cfg(windows)]
        {
            ShellSpec {
                program: "cmd.exe".into(),
                args: vec!["/C".into(), "echo JKY_MARKER".into()],
            }
        }
        #[cfg(not(windows))]
        {
            ShellSpec {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "echo JKY_MARKER".into()],
            }
        }
    }

    fn config(shell: ShellSpec) -> SpawnConfig {
        SpawnConfig { shell, cwd: std::env::temp_dir(), cols: 80, rows: 24 }
    }

    #[test]
    fn a_spawned_shell_produces_output_on_every_platform() {
        let session = PtySession::spawn(config(echo_marker())).expect("spawn");
        let mut reader = session.take_reader().expect("reader");

        let mut seen = String::new();
        let mut buf = [0u8; 1024];
        let deadline = Instant::now() + Duration::from_secs(10);

        while Instant::now() < deadline && !seen.contains("JKY_MARKER") {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => seen.push_str(&String::from_utf8_lossy(&buf[..n])),
                Err(_) => break,
            }
        }

        assert!(
            seen.contains("JKY_MARKER"),
            "no PTY output on this platform. Got: {seen:?}"
        );
    }

    #[test]
    fn resizing_a_live_session_succeeds() {
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.resize(120, 40).is_ok());
        let _ = session.kill();
    }

    #[test]
    fn a_zero_dimension_is_clamped_rather_than_rejected() {
        // A pane can measure 0 during its first layout pass. Passing that
        // straight to the OS errors on some platforms, so clamp instead.
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.resize(0, 0).is_ok());
        let _ = session.kill();
    }

    #[test]
    fn spawning_a_program_that_does_not_exist_reports_an_error() {
        let spec = ShellSpec { program: "definitely-not-a-real-program".into(), args: vec![] };
        assert!(PtySession::spawn(config(spec)).is_err());
    }

    #[test]
    fn killing_a_session_twice_is_not_an_error() {
        let session = PtySession::spawn(config(default_shell())).expect("spawn");
        assert!(session.kill().is_ok());
        assert!(session.kill().is_ok(), "a second kill must be a no-op");
    }
}
