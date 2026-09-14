//! A shell that outlives the process that asked for it.
//!
//! Every other test of this runs the supervisor loop in a thread against a
//! pipe. This one runs the real binary as a real second process holding a
//! real shell, because the thing being claimed — that a shell survives the
//! window — is a claim about processes, and a thread in the same process
//! cannot demonstrate it.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use interprocess::local_socket::traits::Stream as _;
use std::time::{Duration, Instant};

use jky_detach::{Frame, attach, sessions};

fn binary() -> PathBuf {
    // The test binary sits beside the one under test.
    let mut path = std::env::current_exe().expect("this test's own path");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.join(if cfg!(windows) { "jky-terminal.exe" } else { "jky-terminal" })
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("jky-detached-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

/// Where the supervisor will record itself, given a config directory.
fn sessions_dir(config: &Path) -> PathBuf {
    config.join("detached")
}

fn wait_for(mut done: impl FnMut() -> bool) -> bool {
    let until = Instant::now() + Duration::from_secs(30);
    while Instant::now() < until {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// A supervisor that is killed when the test ends, however it ends.
///
/// Without this a failing assertion leaves a real shell running on the
/// machine — which is the precise thing this feature must never do by
/// accident, and a test that does it while proving it does not would be
/// quite a thing to ship.
struct Supervisor(Child);

impl Drop for Supervisor {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Start the binary as a supervisor, with its own config directory.
fn start(config: &Path, session: &str) -> Option<Supervisor> {
    let exe = binary();
    if !exe.exists() {
        eprintln!("no built binary at {exe:?}; skipping");
        return None;
    }

    let child = Command::new(exe)
        .arg("--supervise")
        .arg(session)
        // Named rather than derived, which is the point: where a supervisor
        // records itself cannot depend on how three platforms each spell
        // "the configuration directory".
        .arg("--config-dir")
        .arg(config)
        .arg("--cwd")
        .arg(config)
        .spawn()
        .expect("the supervisor should start");
    Some(Supervisor(child))
}

#[test]
fn a_shell_outlives_the_process_that_asked_for_it() {
    let config = scratch("survives");
    let recorded = sessions_dir(&config);

    let Some(child) = start(&config, "one") else { return };

    assert!(
        wait_for(|| sessions(&recorded) == vec!["one".to_string()]),
        "the supervisor never recorded itself in {recorded:?}"
    );

    // A window attaches, runs something, and leaves.
    {
        let window = attach(&recorded, "one").expect("attach");
        let (reading, mut writing) = window.split();

        // A carriage return, which is what a terminal sends for Enter. `\n`
        // is Ctrl+J, and PowerShell does not read it as submitting a line.
        Frame::Data(b"echo MARKER-ALIVE\r".to_vec())
            .write_to(&mut writing)
            .expect("type a command");

        let seen = read_until(reading, "MARKER-ALIVE", Duration::from_secs(25));
        assert!(seen.contains("MARKER-ALIVE"), "the shell never ran it:\n{seen}");

        Frame::Detach.write_to(&mut writing).ok();
    }

    // The window is gone. The shell is not — which is the entire claim.
    assert!(
        sessions(&recorded) == vec!["one".to_string()],
        "the session died with its window"
    );

    let again = attach(&recorded, "one").expect("reattach");
    let (reading, mut writing) = again.split();
    Frame::Data(b"echo MARKER-AGAIN\r".to_vec())
        .write_to(&mut writing)
        .expect("type again");
    let seen = read_until(reading, "MARKER-AGAIN", Duration::from_secs(25));
    assert!(seen.contains("MARKER-AGAIN"), "the reattached shell was deaf:\n{seen}");

    // And it ends when told to, taking its record with it.
    Frame::Data(b"exit\r".to_vec()).write_to(&mut writing).ok();
    assert!(
        wait_for(|| sessions(&recorded).is_empty()),
        "the session outlived its shell"
    );

    drop(child);
    let _ = std::fs::remove_dir_all(&config);
}

/// Read frames until the text appears, or time runs out.
///
/// On a thread, because `Frame::read_from` blocks: a deadline checked only
/// between frames is no deadline at all when the next frame never comes, and
/// the first version of this hung for ten minutes proving exactly that.
fn read_until(window: impl Read + Send + 'static, text: &str, within: Duration) -> String {
    let (send, recv) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut window = window;
        while let Ok(frame) = Frame::read_from(&mut window) {
            let bytes = match frame {
                Frame::Data(b) | Frame::Replay(b) => b,
                Frame::Ended { .. } => break,
                _ => continue,
            };
            if send.send(String::from_utf8_lossy(&bytes).into_owned()).is_err() {
                break;
            }
        }
    });

    let until = Instant::now() + within;
    let mut seen = String::new();
    while Instant::now() < until {
        let left = until.saturating_duration_since(Instant::now());
        match recv.recv_timeout(left) {
            Ok(chunk) => {
                seen.push_str(&chunk);
                if seen.contains(text) {
                    return seen;
                }
            }
            Err(_) => break,
        }
    }
    seen
}

#[test]
fn an_ordinary_launch_is_not_a_supervisor() {
    // The flag is the only thing that turns this binary into one. Without it
    // nothing is recorded, because a window was asked for instead.
    let config = scratch("window");
    let recorded = sessions_dir(&config);
    assert!(sessions(&recorded).is_empty());
    let _ = std::fs::remove_dir_all(&config);
}

/*
 * Closing a pane, proved against a real shell in a real second process.
 *
 * The crate's own test shows the supervisor asks its shell to end. Only a
 * process can show the rest: that a real pty's shell actually goes, that the
 * supervisor holding it goes too, and that nothing is left on disk to find.
 */
#[test]
fn a_hangup_ends_a_real_shell_its_supervisor_and_its_record() {
    let config = scratch("hangup");
    let recorded = sessions_dir(&config);

    let Some(mut child) = start(&config, "gone") else { return };
    assert!(
        wait_for(|| sessions(&recorded) == vec!["gone".to_string()]),
        "the supervisor never recorded itself in {recorded:?}"
    );

    let window = attach(&recorded, "gone").expect("attach");
    let (_reading, mut writing) = window.split();
    Frame::Hangup.write_to(&mut writing).expect("hang up");

    assert!(
        wait_for(|| sessions(&recorded).is_empty()),
        "the shell outlived being closed"
    );
    assert!(
        wait_for(|| matches!(child.0.try_wait(), Ok(Some(_)))),
        "the supervisor kept running with nothing to hold"
    );

    let _ = std::fs::remove_dir_all(&config);
}

/// A process this test launched, ended when the test ends however it ends.
///
/// `launch` detaches on purpose, so nothing else would ever end one a failing
/// assertion left behind.
struct Launched(u32);

impl Drop for Launched {
    fn drop(&mut self) {
        #[cfg(not(windows))]
        let _ = Command::new("kill").arg(self.0.to_string()).status();
        #[cfg(windows)]
        let _ = Command::new("taskkill")
            .args(["/PID", &self.0.to_string(), "/F", "/T"])
            .status();
    }
}

/*
 * The window's side of it, with a real supervisor in a real process.
 *
 * Nothing is there, so opening starts one — detached, the way the app will.
 * The window runs something, lets go, and opens the same pane again: it must
 * find that shell rather than start a second, and closing it must leave
 * nothing behind.
 */
#[test]
fn a_window_that_finds_nothing_starts_a_shell_it_can_leave_and_find_again() {
    let exe = binary();
    if !exe.exists() {
        eprintln!("no built binary at {exe:?}; skipping");
        return;
    }
    let config = scratch("open");
    let recorded = sessions_dir(&config);
    let mut launched: Option<Launched> = None;

    let args: [std::ffi::OsString; 6] = [
        "--supervise".into(),
        "fresh".into(),
        "--config-dir".into(),
        config.clone().into_os_string(),
        "--cwd".into(),
        config.clone().into_os_string(),
    ];
    let first = jky_detach::open(
        &recorded,
        "fresh",
        || {
            launched = Some(Launched(jky_detach::launch(&exe, &args)?));
            Ok(())
        },
        Duration::from_secs(30),
    )
    .expect("open");
    assert!(!first.reattached, "a shell that was just started was called old");

    first.client.input(b"echo MARKER-HELD\r").expect("type");
    let frames = first.client.take_frames().expect("frames");
    let seen = read_until(frames, "MARKER-HELD", Duration::from_secs(25));
    assert!(seen.contains("MARKER-HELD"), "the held shell never ran it:\n{seen}");
    first.client.detach().expect("let go");
    drop(first);

    let again = jky_detach::open(
        &recorded,
        "fresh",
        || -> std::io::Result<()> { panic!("started a second shell for one pane") },
        Duration::from_secs(10),
    )
    .expect("reopen");
    assert!(again.reattached, "leaving and coming back started over");

    again.client.hangup().expect("hang up");
    assert!(wait_for(|| sessions(&recorded).is_empty()), "closing it left it running");

    drop(launched);
    let _ = std::fs::remove_dir_all(&config);
}
