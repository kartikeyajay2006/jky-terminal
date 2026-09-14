//! A shell that is a pipe and a log, for tests that drive a supervisor exactly.
//!
//! Shared rather than private to one test module, because the supervisor and
//! the client that talks to it are tested against the same stand-in — and two
//! copies of a fake drift in exactly the way the thing they fake does not.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::Shell;

/// A shell that is a pipe and a log, so the loop can be driven exactly.
pub(crate) struct Fake {
    output: Mutex<Option<Box<dyn Read + Send>>>,
    typed: Arc<Mutex<Vec<u8>>>,
    sized: Arc<Mutex<Vec<(u16, u16)>>>,
    killed: Arc<AtomicBool>,
}

impl Shell for Fake {
    fn output(&self) -> io::Result<Box<dyn Read + Send>> {
        self.output
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| io::Error::other("taken twice"))
    }
    fn input(&self, bytes: &[u8]) -> io::Result<()> {
        self.typed.lock().unwrap().extend_from_slice(bytes);
        Ok(())
    }
    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.sized.lock().unwrap().push((cols, rows));
        Ok(())
    }
    fn wait(&self) -> io::Result<i32> {
        // Never returns, so these tests exercise the output-ended path.
        // The process-exited path is proved against a real shell in the
        // desktop crate's `detached` test, which is the only place it can
        // be: it needs a process.
        loop {
            std::thread::park();
        }
    }
    fn kill(&self) -> io::Result<()> {
        // Recorded rather than acted on. A test ends the fake by dropping its
        // writer, which is what a killed shell's output does next — so the
        // two halves of "told to end" and "ended" can be checked apart.
        self.killed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub(crate) fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("jky-sup-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

/// A fake shell, plus the handles a test drives and inspects it through.
pub(crate) struct Rig {
    pub(crate) shell: Fake,
    /// Write here and the fake shell "prints" it. Dropping it ends the shell.
    pub(crate) writer: os_pipe::PipeWriter,
    pub(crate) typed: Arc<Mutex<Vec<u8>>>,
    pub(crate) sized: Arc<Mutex<Vec<(u16, u16)>>>,
    /// Set once the shell has been asked to end.
    pub(crate) killed: Arc<AtomicBool>,
}

pub(crate) fn fake() -> Rig {
    let (reader, writer) = os_pipe::pipe().expect("a pipe");
    let typed = Arc::new(Mutex::new(Vec::new()));
    let sized = Arc::new(Mutex::new(Vec::new()));
    let killed = Arc::new(AtomicBool::new(false));
    Rig {
        shell: Fake {
            output: Mutex::new(Some(Box::new(reader))),
            typed: Arc::clone(&typed),
            sized: Arc::clone(&sized),
            killed: Arc::clone(&killed),
        },
        writer,
        typed,
        sized,
        killed,
    }
}

pub(crate) fn wait_for(mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..200 {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}
