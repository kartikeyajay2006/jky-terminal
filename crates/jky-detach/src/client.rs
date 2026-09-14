//! A window's end of a detached session.
//!
//! A supervisor answers a connection with the replay, or drops it when another
//! window already holds the session. So joining is a handshake with three
//! answers, and opening is joining with a supervisor started when there is
//! none to join.

use std::io;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use interprocess::local_socket::traits::Stream as _;
use interprocess::local_socket::{RecvHalf, SendHalf};

use crate::{attach, check, sessions, Frame};

/// How long a supervisor has to answer before it counts as not answering.
const HANDSHAKE: Duration = Duration::from_secs(2);

/// How long ending a session waits for a window that is still letting go.
const LETTING_GO: Duration = Duration::from_secs(2);

/// How long to wait between asking again.
const RETRY: Duration = Duration::from_millis(25);

/// What joining a session found.
pub enum Joined {
    /// Attached, with what was missed while nobody was.
    Attached { client: Client, replay: Vec<u8> },
    /// A supervisor is there and serving another window, or not answering.
    Busy,
    /// Nothing is there.
    Absent,
}

/// A session this window holds.
pub struct Client {
    sending: Mutex<SendHalf>,
    receiving: Mutex<Option<RecvHalf>>,
}

/// What opening a session produced.
pub struct Opened {
    pub client: Client,
    /// What the shell printed while no window was attached.
    pub replay: Vec<u8>,
    /// Whether an existing shell was joined rather than a new one started.
    pub reattached: bool,
}

/// The value behind a lock, poisoned or not — for the reason `PtyRegistry`
/// gives: a panic elsewhere says nothing about whether this is still a session.
fn recover<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Connect to a session and wait for it to say whether this window may have it.
pub fn join(runtime_dir: &Path, session: &str) -> Joined {
    let Ok(stream) = attach(runtime_dir, session) else { return Joined::Absent };
    let (mut receiving, sending) = stream.split();

    // On a thread, because a read blocks, and a supervisor that never answers
    // must not keep a terminal from opening. The half comes back with the
    // answer, so nothing is lost when the answer is in time.
    let (tell, told) = mpsc::channel();
    std::thread::spawn(move || {
        let first = Frame::read_from(&mut receiving);
        let _ = tell.send((first, receiving));
    });

    match told.recv_timeout(HANDSHAKE) {
        Ok((Ok(Frame::Replay(replay)), receiving)) => Joined::Attached {
            client: Client {
                sending: Mutex::new(sending),
                receiving: Mutex::new(Some(receiving)),
            },
            replay,
        },
        // Closed without a replay is a supervisor saying another window has it.
        _ => Joined::Busy,
    }
}

/// Join a session, starting its supervisor first if there is none.
///
/// `start` is how a supervisor comes to exist — in the app, this binary run
/// again with `--supervise`. A parameter, so it can be a thread in a test and a
/// process in the proof. It is called at most once.
pub fn open(
    runtime_dir: &Path,
    session: &str,
    start: impl FnOnce() -> io::Result<()>,
    within: Duration,
) -> io::Result<Opened> {
    // Refused before anything is started: a name that is really a path must
    // never become a supervisor's argument, let alone an address.
    check(session).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;

    let mut start = Some(start);
    let mut reattached = true;
    let until = Instant::now() + within;
    loop {
        match join(runtime_dir, session) {
            Joined::Attached { client, replay } => {
                return Ok(Opened { client, replay, reattached });
            }
            Joined::Absent => {
                if let Some(start) = start.take() {
                    start()?;
                    reattached = false;
                }
            }
            // Most often this same window, a moment ago, still letting go.
            // Worth a short wait rather than a second shell.
            Joined::Busy => {}
        }
        if Instant::now() >= until {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("session {session} did not answer"),
            ));
        }
        std::thread::sleep(RETRY);
    }
}

/// End a session's shell, if there is one.
///
/// Waits briefly for a window still letting go of it: closing a pane and its
/// terminal unmounting race, and either may reach here first.
pub fn end(runtime_dir: &Path, session: &str) {
    let until = Instant::now() + LETTING_GO;
    loop {
        match join(runtime_dir, session) {
            Joined::Attached { client, .. } => {
                let _ = client.hangup();
                return;
            }
            Joined::Absent => return,
            Joined::Busy if Instant::now() >= until => return,
            Joined::Busy => std::thread::sleep(RETRY),
        }
    }
}

/// End every session no pane claims.
pub fn prune(runtime_dir: &Path, keep: &[String]) {
    for session in sessions(runtime_dir) {
        if !keep.contains(&session) {
            end(runtime_dir, &session);
        }
    }
}

/// Deliver a session's output: the replay, then the live stream until the shell ends.
///
/// Returns the exit code when the shell ended, and `None` when the window
/// stopped listening or the connection dropped. `deliver` returns `false` to stop.
pub fn stream(
    mut frames: RecvHalf,
    replay: Vec<u8>,
    mut deliver: impl FnMut(Vec<u8>) -> bool,
) -> Option<i32> {
    if !replay.is_empty() && !deliver(replay) {
        return None;
    }
    loop {
        match Frame::read_from(&mut frames) {
            Ok(Frame::Data(bytes)) => {
                if !deliver(bytes) {
                    return None;
                }
            }
            Ok(Frame::Ended { code }) => return Some(code),
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

impl Client {
    /// Keystrokes, going to the shell.
    pub fn input(&self, bytes: &[u8]) -> io::Result<()> {
        self.send(Frame::Data(bytes.to_vec()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.send(Frame::Resize { cols, rows })
    }

    /// End the shell. What closing a pane means.
    pub fn hangup(&self) -> io::Result<()> {
        self.send(Frame::Hangup)
    }

    /// Leave the shell running. What a terminal unmounting means.
    pub fn detach(&self) -> io::Result<()> {
        self.send(Frame::Detach)
    }

    /// The live stream, for exactly one reader.
    pub fn take_frames(&self) -> Option<RecvHalf> {
        recover(&self.receiving).take()
    }

    fn send(&self, frame: Frame) -> io::Result<()> {
        let mut sending = recover(&self.sending);
        frame
            .write_to(&mut *sending)
            .map_err(|e| io::Error::other(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supervise;
    use crate::testing::*;
    use std::io::{self, Write};
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    const WITHIN: Duration = Duration::from_secs(5);

    /// A `start` that runs a supervisor on a thread, counting how often it is asked.
    fn starter(
        dir: &Path,
        name: &str,
        shell: Fake,
        count: Arc<AtomicUsize>,
    ) -> impl FnOnce() -> io::Result<()> {
        let dir = dir.to_path_buf();
        let name = name.to_string();
        move || {
            count.fetch_add(1, Ordering::SeqCst);
            std::thread::spawn(move || supervise(&dir, &name, shell));
            Ok(())
        }
    }

    /// A `start` for when a supervisor must already be there.
    fn never() -> io::Result<()> {
        panic!("a supervisor was started when one was already there")
    }

    #[test]
    fn joining_nothing_finds_nothing() {
        let dir = scratch("client-absent");
        assert!(matches!(join(&dir, "nobody"), Joined::Absent));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn opening_starts_a_supervisor_once_and_says_the_shell_is_new() {
        let dir = scratch("client-fresh");
        let Rig { shell, writer: _writer, .. } = fake();
        let count = Arc::new(AtomicUsize::new(0));

        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::clone(&count)), WITHIN)
            .expect("open");

        assert!(!opened.reattached, "a shell that was just started was called old");
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * The whole feature, from the window's side.
     *
     * A window lets go, the shell keeps printing, and the next window to open
     * the same pane finds that shell rather than starting another — and is
     * handed what it missed.
     */
    #[test]
    fn reopening_after_detaching_rejoins_with_what_was_missed() {
        let dir = scratch("client-again");
        let Rig { shell, mut writer, .. } = fake();

        let first = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open");
        first.client.detach().expect("detach");
        drop(first);

        writer.write_all(b"MISSED").unwrap();
        writer.flush().unwrap();

        let second = open(&dir, "s", never, WITHIN).expect("reopen");
        assert!(second.reattached, "leaving and coming back started over");
        let replay = String::from_utf8_lossy(&second.replay).into_owned();
        assert!(replay.contains("MISSED"), "what happened while away was lost: {replay:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_window_finds_the_session_busy() {
        let dir = scratch("client-busy");
        let Rig { shell, writer: _writer, .. } = fake();

        let _held = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open");

        assert!(matches!(join(&dir, "s"), Joined::Busy));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn typing_and_resizing_reach_the_shell() {
        let dir = scratch("client-io");
        let Rig { shell, writer: _writer, typed, sized, .. } = fake();

        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open");
        opened.client.input(b"ls\r").unwrap();
        opened.client.resize(100, 30).unwrap();

        assert!(wait_for(|| typed.lock().unwrap().as_slice() == b"ls\r"));
        assert!(wait_for(|| sized.lock().unwrap().contains(&(100, 30))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ending_a_session_nobody_holds_tells_its_shell() {
        let dir = scratch("client-end");
        let Rig { shell, writer, killed, .. } = fake();

        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open");
        opened.client.detach().unwrap();
        drop(opened);

        end(&dir, "s");
        assert!(wait_for(|| killed.load(Ordering::SeqCst)), "the shell was never told to end");

        drop(writer);
        assert!(wait_for(|| crate::sessions(&dir).is_empty()), "the session outlived its shell");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pruning_ends_only_what_is_not_kept() {
        let dir = scratch("client-prune");
        let Rig { shell: kept_shell, writer: _kept_writer, killed: kept_killed, .. } = fake();
        let Rig { shell: gone_shell, writer: _gone_writer, killed: gone_killed, .. } = fake();

        let kept = open(&dir, "kept", starter(&dir, "kept", kept_shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open kept");
        let gone = open(&dir, "gone", starter(&dir, "gone", gone_shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open gone");
        kept.client.detach().unwrap();
        gone.client.detach().unwrap();
        drop((kept, gone));

        prune(&dir, &["kept".to_string()]);

        assert!(wait_for(|| gone_killed.load(Ordering::SeqCst)), "an unclaimed session survived");
        assert!(!kept_killed.load(Ordering::SeqCst), "a claimed session was ended");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_stream_delivers_the_replay_first_and_stops_at_the_end() {
        let dir = scratch("client-stream");
        let Rig { shell, mut writer, .. } = fake();

        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN)
            .expect("open");
        let frames = opened.client.take_frames().expect("frames");
        writer.write_all(b"LIVE").unwrap();
        writer.flush().unwrap();
        drop(writer);

        let mut got = Vec::new();
        let ended = stream(frames, b"EARLIER".to_vec(), |chunk| {
            got.push(String::from_utf8_lossy(&chunk).into_owned());
            true
        });

        assert_eq!(got.first().map(String::as_str), Some("EARLIER"), "the replay came after live output");
        assert!(got.concat().contains("LIVE"));
        assert!(ended.is_some(), "the stream did not say the shell ended");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_that_is_really_a_path_is_refused_before_anything_starts() {
        let dir = scratch("client-name");
        assert!(open(&dir, "../escape", never, WITHIN).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
