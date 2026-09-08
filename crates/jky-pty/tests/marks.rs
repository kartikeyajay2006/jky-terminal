//! Do the semantic marks actually come out of a real shell?
//!
//! Every other test of the shell integration reads the generated string and
//! asserts something about its text. That proves the fragment says the right
//! words, not that a shell reading those words does the right thing — and the
//! difference between the two is where this kind of code goes wrong: a stray
//! quote, a `printf` that a given shell spells differently, an escape that one
//! shell interprets and another prints.
//!
//! So this starts a real shell on a real pty, with the integration installed
//! exactly as the app installs it, runs a command, and reads the bytes that
//! come back.

#![cfg(unix)]

use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use jky_pty::{PtySession, ShellSpec, SpawnConfig, install_shell_integration, integration_dir};

/// A pty being read continuously, so a test can wait for one thing, write,
/// and then wait for the next.
///
/// Reading on demand does not work here. `read` blocks until the shell writes,
/// so a loop that checks a clock between reads never checks it once the shell
/// goes quiet — the first version of this test hung for ten minutes and had to
/// be killed, which is what it would have done to CI. And reading only once
/// cannot express "wait for a prompt, then type", which is the sequence a
/// shell actually requires.
struct Watched {
    seen: Arc<Mutex<String>>,
}

impl Watched {
    fn new(reader: Box<dyn Read + Send>) -> Self {
        let seen = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&seen);
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        });
        Self { seen }
    }

    fn text(&self) -> String {
        self.seen.lock().unwrap().clone()
    }

    /// Wait until `done` is satisfied, or give up and return what arrived.
    fn wait(&self, done: impl Fn(&str) -> bool, budget: Duration) -> String {
        let deadline = Instant::now() + budget;
        while Instant::now() < deadline {
            let text = self.text();
            if done(&text) {
                return text;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        self.text()
    }
}

fn shell_on_path(name: &str) -> bool {
    std::process::Command::new(name)
        .arg("-c")
        .arg("exit 0")
        .output()
        .is_ok()
}

#[test]
fn a_real_shell_emits_the_marks_through_a_real_pty() {
    if !shell_on_path("bash") {
        eprintln!("no bash on this machine; skipping");
        return;
    }

    let dir = std::env::temp_dir().join(format!("jky-marks-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a place to put the integration");
    install_shell_integration(&dir, &dir).expect("the integration should install");

    let session = PtySession::spawn(SpawnConfig {
        shell: ShellSpec {
            program: "bash".into(),
            args: vec!["--norc".into(), "--noprofile".into(), "-i".into()],
        },
        cwd: dir.clone(),
        cols: 80,
        rows: 24,
        path_prepend: None,
        integration_dir: Some(integration_dir(&dir)),
    })
    .expect("the shell should start");

    let watched = Watched::new(session.take_reader().expect("a reader"));

    // Wait for a prompt before typing. A shell that has not finished starting
    // has nothing to read the command with.
    watched.wait(|s| s.contains("\u{1b}]133;A"), Duration::from_secs(20));

    // The command's own text appears in its output, which is precisely the
    // case that defeats locating output by searching the screen for it.
    session.write(b"echo 'echo marker-out'\n").expect("write");

    // Waiting for "a D somewhere" would be satisfied by the first prompt's own
    // status, before this command has run at all. Wait for a status that
    // arrives *after* the output.
    let seen = watched.wait(
        |s| match s.find("marker-out") {
            Some(at) => s[at..].contains("\u{1b}]133;D;"),
            None => false,
        },
        Duration::from_secs(20),
    );
    let _ = session.kill();
    std::fs::remove_dir_all(&dir).ok();

    assert!(seen.contains("\u{1b}]133;A"), "no prompt mark came back:\n{seen:?}");
    assert!(seen.contains("\u{1b}]133;C"), "no output mark came back:\n{seen:?}");
    assert!(seen.contains("\u{1b}]133;D;"), "no exit mark came back:\n{seen:?}");
    assert!(seen.contains("\u{1b}]7;file://"), "no cwd report came back:\n{seen:?}");

    // The ordering here is the entire argument for doing this at all.
    //
    // "marker-out" appears twice: once because the terminal echoes what was
    // typed, and once because the command printed it. Searching the screen for
    // the command's text finds the echo — which is why the old approach put
    // the start of output in the wrong place, and why a mark from the shell is
    // worth having.
    let echoed = seen.find("marker-out").expect("the typed command should echo");
    let c = seen.find("\u{1b}]133;C").expect("an output mark");
    assert!(
        echoed < c,
        "the echoed command should come before the output mark, not after"
    );

    let printed = seen[c..]
        .find("marker-out")
        .map(|i| i + c)
        .expect("the command's actual output should follow the mark");
    let d = seen[printed..]
        .find("\u{1b}]133;D;")
        .map(|i| i + printed)
        .expect("a status after the output");

    assert!(c < printed && printed < d, "prompt, output, status, in that order");
}

#[test]
fn the_shell_prints_no_errors_under_the_hook() {
    // A hook that works but complains once per prompt is not working.
    if !shell_on_path("bash") {
        return;
    }

    let dir = std::env::temp_dir().join(format!("jky-marks-quiet-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    install_shell_integration(&dir, &dir).unwrap();

    let session = PtySession::spawn(SpawnConfig {
        shell: ShellSpec {
            program: "bash".into(),
            args: vec!["--norc".into(), "--noprofile".into(), "-i".into()],
        },
        cwd: dir.clone(),
        cols: 80,
        rows: 24,
        path_prepend: None,
        integration_dir: Some(integration_dir(&dir)),
    })
    .unwrap();

    let watched = Watched::new(session.take_reader().unwrap());
    watched.wait(|s| s.contains("\u{1b}]133;A"), Duration::from_secs(20));
    session.write(b"true\n").unwrap();
    let seen = watched.wait(
        |s| s.matches("\u{1b}]133;A").count() >= 2,
        Duration::from_secs(20),
    );
    let _ = session.kill();
    std::fs::remove_dir_all(&dir).ok();

    for noise in ["command not found", "syntax error", "unexpected", "bad substitution"] {
        assert!(!seen.contains(noise), "the hook made the shell complain ({noise}):\n{seen:?}");
    }
}
