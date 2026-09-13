//! The socket a detached session is reached through.
//!
//! Thin on purpose. Everything that can be decided without a connection lives
//! in `frame`, `name` and `replay`; what is left here is opening the thing,
//! which differs between a Unix socket and a Windows named pipe and is the
//! part no test can replace with arithmetic.
//!
//! Liveness is never probed, and that is the important decision here.
//!
//! The obvious design asks "is this session alive?" by connecting, then lists
//! the ones that answered. It is wrong twice on Windows. A named pipe offers
//! a finite number of instances, so every probe *consumes* one that a real
//! window wanted — and after a connection is accepted there is a window
//! before the server posts another, during which a perfectly healthy session
//! answers nothing. A list built on that probe deletes live sessions, which
//! is the one failure this whole feature exists to prevent.
//!
//! So listing and proving are separated. `sessions` reads the markers and
//! promises only that somebody once recorded them. `attach` is what decides:
//! it connects, and a session that cannot be connected to is dead — swept
//! there and then, by the caller who just found out. Nothing is ever removed
//! on the strength of a question nobody needed the answer to.

use std::io;
use std::path::Path;

use interprocess::local_socket::traits::Stream as StreamTrait;
use interprocess::local_socket::{GenericFilePath, GenericNamespaced, Listener, ListenerOptions, Stream};
use interprocess::local_socket::{Name, ToFsName, ToNsName};

use crate::name::{address, is_file_backed, marker, socket_dir};
use crate::NameError;

/// Turn an address into whatever the platform's socket layer wants.
pub(crate) fn name_for(at: &str) -> io::Result<Name<'_>> {
    as_name(at)
}

fn as_name(at: &str) -> io::Result<Name<'_>> {
    if is_file_backed() {
        at.to_fs_name::<GenericFilePath>()
    } else {
        at.to_ns_name::<GenericNamespaced>()
    }
}

/// Whether a Unix socket still has a listener behind it.
///
/// Unix only, and deliberately: there a connection is queued in the backlog
/// whether or not the supervisor is inside `accept`, so a refusal really does
/// mean nothing is listening. The same question on Windows has no reliable
/// answer — see the note at the top of this file — which is why nothing there
/// asks it.
///
/// Used for exactly one thing: deciding whether the socket file left at an
/// address may be deleted so a new supervisor can bind. Windows needs no
/// equivalent, because creating a second pipe of the same name fails on its
/// own and the OS is the authority.
#[cfg(not(windows))]
fn unix_socket_is_live(at: &str) -> bool {
    let Ok(name) = as_name(at) else { return false };
    Stream::connect(name).is_ok()
}

/// Listen at an address, clearing anything dead that is already there.
///
/// Refuses rather than steals when a live supervisor holds the address: two
/// supervisors on one session would each own half the conversation.
pub fn listen(runtime_dir: &Path, session: &str) -> io::Result<(String, Listener)> {
    let at = address(runtime_dir, session).map_err(to_io)?;

    std::fs::create_dir_all(socket_dir(runtime_dir))?;

    // A Unix socket file outlives its supervisor, so binding fails until the
    // corpse is cleared. Windows needs none of this: a second pipe of the
    // same name is refused by the OS, which is a better authority than
    // anything this could ask.
    #[cfg(not(windows))]
    if Path::new(&at).exists() {
        if unix_socket_is_live(&at) {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("a session called {session} is already running"),
            ));
        }
        // Left by a supervisor that was killed rather than asked to stop.
        // Nothing is listening, so nothing is lost by removing it.
        std::fs::remove_file(&at)?;
    }

    let listener = ListenerOptions::new().name(as_name(&at)?).create_sync()?;

    // The note that says this session exists. On Windows a pipe leaves
    // nothing on disk, so without it there is no directory to list and a
    // detached session could never be found again. Written after the listener
    // is up, so a marker never names something that is not accepting yet.
    std::fs::create_dir_all(socket_dir(runtime_dir))?;
    std::fs::write(marker(runtime_dir, session).map_err(to_io)?, session)?;

    Ok((at, listener))
}

/// Attach to a session, and forget it if it turns out not to be there.
///
/// This is where liveness is decided, because this is the only place anybody
/// actually needs the answer. A session that will not accept a connection is
/// gone, and its marker is removed by the caller who just discovered it
/// rather than by a sweep guessing on everyone's behalf.
pub fn attach(runtime_dir: &Path, session: &str) -> io::Result<Stream> {
    let at = address(runtime_dir, session).map_err(to_io)?;
    match Stream::connect(as_name(&at)?) {
        Ok(stream) => Ok(stream),
        Err(e) => {
            forget(runtime_dir, session);
            Err(e)
        }
    }
}

/// Remove what a session left behind.
///
/// Called when attaching proved there is nothing there, and by a supervisor
/// on its way out. Both halves go: the marker that lists it and, on Unix, the
/// socket file that would otherwise block the next one to take the name.
pub fn forget(runtime_dir: &Path, session: &str) {
    if let Ok(note) = marker(runtime_dir, session) {
        let _ = std::fs::remove_file(note);
    }
    if is_file_backed() {
        if let Ok(at) = address(runtime_dir, session) {
            let _ = std::fs::remove_file(at);
        }
    }
}

/// Every session anybody has recorded, in name order.
///
/// Candidates, not promises. A marker says a supervisor once existed under
/// this name; whether it is still there is settled by `attach`, and by
/// nothing else. Listing deletes nothing — a list that cleaned up as a side
/// effect would be a list that could throw away a live session for being
/// momentarily busy, which is the failure this feature exists to prevent.
pub fn sessions(runtime_dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(socket_dir(runtime_dir)) else {
        // No directory means no sessions, which is the ordinary first run.
        return Vec::new();
    };

    let mut found: Vec<String> = entries
        .flatten()
        // Anything that is not a marker this could have written is somebody
        // else's file, and not something to read or remove on their behalf.
        .filter_map(|entry| crate::name_of(&entry.path()))
        .collect();

    found.sort();
    found
}

fn to_io(e: NameError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use interprocess::local_socket::traits::ListenerExt;
    use crate::Frame;
    use std::io::Write;

    /// A supervisor, reduced to the one thing that matters: it accepts.
    fn accepting(listener: impl ListenerExt + Send + 'static) {
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                drop(conn);
            }
        });
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jky-detach-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    #[test]
    fn no_sessions_before_any_are_made() {
        let dir = scratch("absent");
        assert!(sessions(&dir).is_empty());
        assert!(attach(&dir, "never").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_is_listed_and_can_be_attached_to() {
        let dir = scratch("live");
        let (_at, listener) = listen(&dir, "one").expect("listen");
        accepting(listener);

        assert_eq!(sessions(&dir), vec!["one".to_string()]);
        assert!(attach(&dir, "one").is_ok());

        // Asked again, because a list that is right once and wrong after is
        // worse than one that never worked. Listing touches nothing, so this
        // cannot be affected by the attach above.
        assert_eq!(sessions(&dir), vec!["one".to_string()], "the list ate itself");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn listing_never_removes_anything() {
        // The failure this design exists to prevent: a live session deleted
        // because it was momentarily busy when something asked after it.
        let dir = scratch("keep");
        let (_at, listener) = listen(&dir, "one").expect("listen");
        accepting(listener);

        for _ in 0..5 {
            assert_eq!(sessions(&dir), vec!["one".to_string()]);
        }
        assert!(marker(&dir, "one").unwrap().exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * Attaching is what settles it.
     *
     * A marker with nothing behind it is a session that died without tidying
     * up. The window that tried to reattach is the one that finds out, so it
     * is the one that clears it away.
     */
    #[test]
    fn attaching_to_a_session_that_is_gone_forgets_it() {
        let dir = scratch("ghost");
        std::fs::create_dir_all(socket_dir(&dir)).unwrap();
        std::fs::write(marker(&dir, "ghost").unwrap(), b"ghost").unwrap();
        assert_eq!(sessions(&dir), vec!["ghost".to_string()]);

        assert!(attach(&dir, "ghost").is_err(), "attached to nothing");
        assert!(sessions(&dir).is_empty(), "the dead marker was left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forgetting_takes_both_halves_and_leaves_the_rest() {
        let dir = scratch("forget");
        let (_at, listener) = listen(&dir, "one").expect("listen");
        accepting(listener);

        let theirs = socket_dir(&dir).join("notes.txt");
        std::fs::write(&theirs, b"keep me").unwrap();

        forget(&dir, "one");
        assert!(sessions(&dir).is_empty());
        assert!(!marker(&dir, "one").unwrap().exists());
        assert!(theirs.exists(), "somebody else's file was deleted");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_supervisor_refuses_rather_than_stealing_the_session() {
        // Two owners would each hold half the conversation, and the window
        // would meet a shell that answers every other keystroke. On Unix the
        // stale-socket check refuses; on Windows the OS does.
        let dir = scratch("taken");
        let (_at, listener) = listen(&dir, "one").expect("listen");
        accepting(listener);

        assert!(listen(&dir, "one").is_err(), "the address was stolen");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * A socket left by a supervisor that was killed.
     *
     * It is a file, so it outlives the process, and binding fails until it is
     * removed. Unix only: a pipe has no corpse to trip over.
     */
    #[cfg(not(windows))]
    #[test]
    fn a_socket_left_by_a_dead_supervisor_is_cleared_rather_than_fatal() {
        let dir = scratch("stale");
        let at = address(&dir, "ghost").unwrap();
        std::fs::create_dir_all(socket_dir(&dir)).unwrap();
        std::fs::write(&at, b"").expect("leave a corpse");

        assert!(!unix_socket_is_live(&at), "a plain file answered a connection");
        let (_at, _listener) = listen(&dir, "ghost").expect("the corpse should not block this");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_client_and_a_supervisor_can_say_something_to_each_other() {
        let dir = scratch("talk");
        let (_at, listener) = listen(&dir, "chat").expect("listen");

        let serving = std::thread::spawn(move || {
            let mut conn = listener.incoming().next().expect("a client").expect("accepted");
            // What a supervisor sends first: what was missed.
            Frame::Replay(b"while you were out".to_vec())
                .write_to(&mut conn)
                .expect("replay");
            Frame::read_from(&mut conn).expect("a reply")
        });

        let mut client = attach(&dir, "chat").expect("attach");
        let first = Frame::read_from(&mut client).expect("read");
        assert_eq!(first, Frame::Replay(b"while you were out".to_vec()));

        Frame::Data(b"ls\n".to_vec()).write_to(&mut client).expect("write");
        client.flush().ok();

        assert_eq!(serving.join().expect("thread"), Frame::Data(b"ls\n".to_vec()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_that_is_really_a_path_never_reaches_the_socket_layer() {
        let dir = scratch("evil");
        assert!(listen(&dir, "../escape").is_err());
        assert!(attach(&dir, "../escape").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
