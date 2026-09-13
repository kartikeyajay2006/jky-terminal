//! The process that holds the shell when no window does.
//!
//! Everything else in this crate is arithmetic; this is the part with
//! threads, and it is where a mistake costs something real — a shell left
//! running with nothing able to reach it, which is a process on somebody's
//! machine that only the task manager can stop.
//!
//! So the lifetime is stated once and enforced in one place: **the supervisor
//! lives exactly as long as its shell**. Not as long as a window, not until a
//! timeout, not until something remembers to tidy up. The shell's output
//! ending is the only exit condition, and reaching it removes the marker and
//! the socket on the way out. A supervisor cannot outlive the thing it exists
//! to hold, so there is no state in which one is orphaned.
//!
//! One window at a time. A session shown in two places is a different feature
//! — it needs the two to agree about the size of the screen — and pretending
//! to support it by writing to whoever connected last would give the second
//! window a shell that answers every other keystroke.

use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use interprocess::local_socket::traits::{ListenerExt, Stream as StreamTrait};
use interprocess::local_socket::{SendHalf, Stream};

use crate::frame::Frame;
use crate::replay::Replay;
use crate::socket::{forget, listen};

/// What a supervisor needs of a shell.
///
/// A trait rather than `PtySession` directly, so this crate stays independent
/// of the pty one — and so the loop below can be tested against something
/// that is not a process at all.
pub trait Shell: Send + Sync + 'static {
    /// Everything the shell prints. Taken once; ending means the shell is gone.
    fn output(&self) -> io::Result<Box<dyn Read + Send>>;
    /// Keystrokes going the other way.
    fn input(&self, bytes: &[u8]) -> io::Result<()>;
    fn resize(&self, cols: u16, rows: u16) -> io::Result<()>;
}

/// The half of the connection output is written to, when a window is attached.
///
/// Split rather than cloned: `interprocess` has no `try_clone`, and the two
/// directions are used by two threads anyway — one pumping the shell's output
/// out, one reading keystrokes in.
type Attached = Arc<Mutex<Option<SendHalf>>>;

/// Hold a shell until it exits, lending it to whichever window is attached.
///
/// Returns when the shell's output ends, having removed everything it left on
/// disk. Blocks for the life of the session, so this is the whole body of a
/// supervisor process.
pub fn supervise(runtime_dir: &Path, session: &str, shell: impl Shell) -> io::Result<()> {
    let (at, listener) = listen(runtime_dir, session)?;

    let shell = Arc::new(shell);
    let attached: Attached = Arc::new(Mutex::new(None));
    let replay = Arc::new(Mutex::new(Replay::default()));
    let ended = Arc::new(AtomicBool::new(false));

    let pump = {
        let shell = Arc::clone(&shell);
        let attached = Arc::clone(&attached);
        let replay = Arc::clone(&replay);
        let ended = Arc::clone(&ended);
        let at = at.clone();
        std::thread::spawn(move || {
            let code = pump_output(&*shell, &attached, &replay);
            ended.store(true, Ordering::SeqCst);

            // Tell whoever is watching, then knock on our own door: the main
            // thread is blocked in `accept`, and nothing else will wake it.
            if let Ok(mut held) = attached.lock() {
                if let Some(stream) = held.as_mut() {
                    let _ = Frame::Ended { code }.write_to(stream);
                }
            }
            knock(&at);
        })
    };

    for incoming in listener.incoming() {
        if ended.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = incoming else { continue };

        // Each window on its own thread, so accepting never waits on one.
        //
        // Serving inline was a deadlock: a window that is merely idle keeps
        // the accept loop blocked in a read, so a shell exiting behind it was
        // never noticed and the supervisor could not end. A supervisor unable
        // to see its own shell die is precisely the orphan this whole file
        // exists to make impossible.
        let shell = Arc::clone(&shell);
        let attached = Arc::clone(&attached);
        let replay = Arc::clone(&replay);
        std::thread::spawn(move || serve_one(stream, &*shell, &attached, &replay));
    }

    let _ = pump.join();
    // The shell is gone, so the session is. Both halves go with it, which is
    // what makes a leaked address impossible rather than merely unlikely.
    forget(runtime_dir, session);
    Ok(())
}

/// Read the shell until it stops, keeping the tail and forwarding the rest.
fn pump_output(shell: &impl Shell, attached: &Attached, replay: &Mutex<Replay>) -> i32 {
    let Ok(mut output) = shell.output() else { return -1 };
    let mut buffer = [0u8; 8192];

    loop {
        let read = match output.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            // A pty reports the far end closing as an error on some
            // platforms and as end-of-file on others. Both mean the same.
            Err(_) => break,
        };
        let chunk = &buffer[..read];

        if let Ok(mut kept) = replay.lock() {
            kept.push(chunk);
        }

        // A window that has gone away is not an error and must not stop the
        // shell — that is the entire point. It is dropped and the shell keeps
        // printing into the replay.
        if let Ok(mut held) = attached.lock() {
            if let Some(stream) = held.as_mut() {
                if Frame::Data(chunk.to_vec()).write_to(stream).is_err() {
                    *held = None;
                }
            }
        }
    }
    0
}

/// Talk to one window until it leaves.
fn serve_one(stream: Stream, shell: &impl Shell, attached: &Attached, replay: &Mutex<Replay>) {
    let (mut reading, mut writing) = stream.split();

    // What was missed, before anything live. Sent while holding the lock so a
    // chunk arriving at this instant cannot overtake it and leave the window
    // showing the newest line above the older ones.
    {
        let Ok(mut held) = attached.lock() else { return };

        // One window at a time. A second is dropped rather than served: two
        // windows sharing a shell have to agree about the size of the screen,
        // and writing output to whichever connected last would give both of
        // them a terminal that answers every other keystroke.
        if held.is_some() {
            return;
        }

        // Always sent, even when there is nothing to catch up on, because it
        // is also the handshake. A window has no other way to know it is
        // attached, and until it does, output goes to the replay rather than
        // to it — so without this the first thing a window receives depends
        // on how fast it connected, which is no contract at all.
        let missed = replay.lock().map(|kept| kept.take()).unwrap_or_default();
        if Frame::Replay(missed).write_to(&mut writing).is_err() {
            return;
        }
        *held = Some(writing);
    }

    loop {
        match Frame::read_from(&mut reading) {
            Ok(Frame::Data(bytes)) => {
                if shell.input(&bytes).is_err() {
                    break;
                }
            }
            Ok(Frame::Resize { cols, rows }) => {
                let _ = shell.resize(cols, rows);
            }
            // Said, or merely happened — a window that crashed and one that
            // left politely both leave the shell running, which is the point.
            Ok(Frame::Detach) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }

    if let Ok(mut held) = attached.lock() {
        *held = None;
    }
}

/// Wake a thread sitting in `accept` by connecting to it.
///
/// The only way to interrupt a blocking accept without a second mechanism to
/// get wrong. The connection is made and dropped; nobody reads it.
fn knock(at: &str) {
    if let Ok(name) = crate::socket::name_for(at) {
        let _ = Stream::connect(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::socket::attach;
    use std::io::Write;
    use std::sync::mpsc;
    use std::time::Duration;

    /// A shell that is a pipe and a log, so the loop can be driven exactly.
    struct Fake {
        output: Mutex<Option<Box<dyn Read + Send>>>,
        typed: Arc<Mutex<Vec<u8>>>,
        sized: Arc<Mutex<Vec<(u16, u16)>>>,
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
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jky-sup-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    /// A shell whose output is whatever is written to the returned sender.
    /// A fake shell, plus the handles a test drives and inspects it through.
    struct Rig {
        shell: Fake,
        /// Write here and the fake shell "prints" it. Dropping it ends the shell.
        writer: os_pipe::PipeWriter,
        typed: Arc<Mutex<Vec<u8>>>,
        sized: Arc<Mutex<Vec<(u16, u16)>>>,
    }

    fn fake() -> Rig {
        let (reader, writer) = os_pipe::pipe().expect("a pipe");
        let typed = Arc::new(Mutex::new(Vec::new()));
        let sized = Arc::new(Mutex::new(Vec::new()));
        Rig {
            shell: Fake {
                output: Mutex::new(Some(Box::new(reader))),
                typed: Arc::clone(&typed),
                sized: Arc::clone(&sized),
            },
            writer,
            typed,
            sized,
        }
    }

    fn wait_for(mut done: impl FnMut() -> bool) -> bool {
        for _ in 0..200 {
            if done() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    #[test]
    fn a_window_sees_what_the_shell_prints_and_the_shell_sees_what_is_typed() {
        let dir = scratch("both");
        let Rig { shell, mut writer, typed, .. } = fake();
        let (ready, started) = mpsc::channel();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || {
                ready.send(()).ok();
                supervise(&dir, "one", shell)
            })
        };
        started.recv().ok();
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut window = attach(&dir, "one").expect("attach");
        // The handshake. Empty here, and waiting for it is what makes
        // everything after it deterministic: until it arrives the window is
        // not registered, and output would go to the replay instead.
        assert_eq!(Frame::read_from(&mut window).expect("handshake"), Frame::Replay(Vec::new()));

        writer.write_all(b"hello from the shell").unwrap();
        writer.flush().unwrap();

        assert_eq!(
            Frame::read_from(&mut window).expect("output"),
            Frame::Data(b"hello from the shell".to_vec())
        );

        Frame::Data(b"ls\n".to_vec()).write_to(&mut window).unwrap();
        assert!(wait_for(|| typed.lock().unwrap().as_slice() == b"ls\n"));

        drop(writer);
        let _ = run.join();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * The whole feature, in one test.
     *
     * A window leaves, the shell keeps printing, and the next window is told
     * what it missed. Without the replay this would reattach to a blank
     * screen, which is the same as not having kept the shell at all.
     */
    #[test]
    fn what_happens_while_nobody_is_watching_is_waiting_when_they_come_back() {
        let dir = scratch("replay");
        let Rig { shell, mut writer, .. } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut first = attach(&dir, "one").expect("attach");
        assert_eq!(Frame::read_from(&mut first).expect("handshake"), Frame::Replay(Vec::new()));

        writer.write_all(b"before\n").unwrap();
        assert_eq!(
            Frame::read_from(&mut first).expect("live"),
            Frame::Data(b"before\n".to_vec())
        );

        // The window goes. The shell must not.
        Frame::Detach.write_to(&mut first).ok();
        drop(first);
        std::thread::sleep(Duration::from_millis(100));

        writer.write_all(b"while away\n").unwrap();
        writer.flush().unwrap();
        std::thread::sleep(Duration::from_millis(100));

        let mut second = attach(&dir, "one").expect("reattach");
        let caught_up = Frame::read_from(&mut second).expect("replay");
        match caught_up {
            Frame::Replay(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                assert!(text.contains("while away"), "missed output was lost: {text:?}");
            }
            other => panic!("expected a replay first, got {other:?}"),
        }

        drop(writer);
        let _ = run.join();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_resize_reaches_the_shell_rather_than_being_typed_into_it() {
        let dir = scratch("resize");
        let Rig { shell, writer, typed, sized } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut window = attach(&dir, "one").expect("attach");
        assert_eq!(Frame::read_from(&mut window).expect("handshake"), Frame::Replay(Vec::new()));
        Frame::Resize { cols: 132, rows: 43 }.write_to(&mut window).unwrap();

        assert!(wait_for(|| sized.lock().unwrap().as_slice() == [(132, 43)]));
        assert!(typed.lock().unwrap().is_empty(), "a resize was typed at the shell");

        drop(writer);
        let _ = run.join();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * The lifetime, which is the thing that must not be wrong.
     *
     * A supervisor that outlives its shell is a process on somebody's machine
     * that nothing can reach and only the task manager can stop. The shell
     * ending is the only exit condition, and it takes the address with it.
     */
    #[test]
    fn the_supervisor_ends_with_its_shell_and_leaves_nothing_behind() {
        let dir = scratch("lifetime");
        let Rig { shell, writer, .. } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        // The shell exits.
        drop(writer);

        assert!(wait_for(|| crate::sessions(&dir).is_empty()), "the session outlived its shell");
        run.join().expect("thread").expect("supervise");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * The deadlock that made this whole loop wrong.
     *
     * Serving a window inline kept the accept loop blocked in a read, so a
     * shell exiting behind an *idle* window was never noticed and the
     * supervisor could not end. That is exactly the orphan this file exists
     * to make impossible: a process holding a dead shell, reachable by
     * nothing, stoppable only by the task manager.
     *
     * The window here never says a word after attaching, which is what an
     * ordinary window does most of the time.
     */
    #[test]
    fn the_supervisor_ends_even_with_an_idle_window_attached() {
        let dir = scratch("idle");
        let Rig { shell, writer, .. } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut window = attach(&dir, "one").expect("attach");
        assert_eq!(Frame::read_from(&mut window).expect("handshake"), Frame::Replay(Vec::new()));

        // The shell exits while the window sits there saying nothing.
        drop(writer);

        assert!(wait_for(|| crate::sessions(&dir).is_empty()), "the session outlived its shell");
        run.join().expect("the supervisor thread hung").expect("supervise");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_window_is_refused_rather_than_sharing_the_shell() {
        // Two windows would have to agree about the size of the screen, and
        // writing output to whichever attached last gives both of them a
        // terminal that answers every other keystroke.
        let dir = scratch("second");
        let Rig { shell, writer, .. } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut first = attach(&dir, "one").expect("attach");
        assert_eq!(Frame::read_from(&mut first).expect("handshake"), Frame::Replay(Vec::new()));

        // The second connects — the socket accepts anyone — and is dropped
        // without a handshake, which is how it learns it was not wanted.
        let mut second = attach(&dir, "one").expect("connect");
        assert!(
            Frame::read_from(&mut second).is_err(),
            "a second window was served alongside the first"
        );

        drop(writer);
        let _ = run.join();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_window_is_told_when_the_shell_exits() {
        let dir = scratch("ended");
        let Rig { shell, writer, .. } = fake();

        let run = {
            let dir = dir.clone();
            std::thread::spawn(move || supervise(&dir, "one", shell))
        };
        assert!(wait_for(|| crate::sessions(&dir) == vec!["one".to_string()]));

        let mut window = attach(&dir, "one").expect("attach");
        assert_eq!(Frame::read_from(&mut window).expect("handshake"), Frame::Replay(Vec::new()));

        drop(writer);

        // Nothing follows this, and a window that never heard it would show a
        // dead shell that looks like it is merely quiet.
        assert!(matches!(Frame::read_from(&mut window), Ok(Frame::Ended { .. })));

        let _ = run.join();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
