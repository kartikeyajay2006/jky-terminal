//! The socket a detached session is reached through.
//!
//! Thin on purpose. Everything that can be decided without a connection lives
//! in `frame`, `name` and `replay`; what is left here is opening the thing,
//! which differs between a Unix socket and a Windows named pipe and is the
//! part no test can replace with arithmetic.
//!
//! A Unix socket also has to be swept. It is a file, it outlives the process
//! that created it, and binding to an address a dead supervisor left behind
//! fails — so a stale one is removed first. "Stale" is decided by trying to
//! connect: a socket nobody is listening on refuses, and that is a far more
//! reliable answer than reading a pid file and hoping the number has not been
//! reused.

use std::io;
use std::path::Path;

use interprocess::local_socket::traits::{ListenerExt, Stream as StreamTrait};
use interprocess::local_socket::{GenericFilePath, GenericNamespaced, ListenerOptions, Stream};
use interprocess::local_socket::{Name, ToFsName, ToNsName};

use crate::name::{address, is_file_backed, marker, socket_dir};
use crate::NameError;

/// Turn an address into whatever the platform's socket layer wants.
fn as_name(at: &str) -> io::Result<Name<'_>> {
    if is_file_backed() {
        at.to_fs_name::<GenericFilePath>()
    } else {
        at.to_ns_name::<GenericNamespaced>()
    }
}

/// Whether something is listening at this address right now.
///
/// By connecting, which is the only answer that cannot be stale. A pid file
/// says a process existed once; this says a supervisor is accepting
/// connections at the moment the question was asked.
pub fn is_live(at: &str) -> bool {
    match as_name(at) {
        Ok(name) => Stream::connect(name).is_ok(),
        Err(_) => false,
    }
}

/// Listen at an address, clearing anything dead that is already there.
///
/// Refuses rather than steals when a live supervisor holds the address: two
/// supervisors on one session would each own half the conversation.
pub fn listen(runtime_dir: &Path, session: &str) -> io::Result<(String, impl ListenerExt)> {
    let at = address(runtime_dir, session).map_err(to_io)?;

    if is_file_backed() {
        std::fs::create_dir_all(socket_dir(runtime_dir))?;

        if Path::new(&at).exists() {
            if is_live(&at) {
                return Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    format!("a session called {session} is already running"),
                ));
            }
            // Left by a supervisor that was killed rather than asked to stop.
            // Nothing is listening, so nothing is lost by removing it.
            std::fs::remove_file(&at)?;
        }
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

/// Attach to a session that is already running.
pub fn attach(runtime_dir: &Path, session: &str) -> io::Result<Stream> {
    let at = address(runtime_dir, session).map_err(to_io)?;
    Stream::connect(as_name(&at)?)
}

/// Every session with something listening, and the dead ones swept away.
///
/// Sweeping here rather than in a timer: the list is asked for when a window
/// opens, which is exactly when a socket left by the last one should go.
pub fn sweep(runtime_dir: &Path) -> Vec<String> {
    let dir = socket_dir(runtime_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        // No directory means no sessions, which is the ordinary first run.
        return Vec::new();
    };

    let mut live = Vec::new();
    let mut orphans = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        let Some(session) = crate::name_of(&path) else {
            // A socket with no marker beside it: written by a supervisor that
            // died between binding and recording itself, or left by a version
            // that had no markers. Nothing indexes it, so nothing would ever
            // clean it up — it is collected here rather than left for ever.
            if is_file_backed() && path.extension().is_some_and(|e| e == "sock") {
                orphans.push(path);
            }
            // Anything else is somebody else's file, and not something to
            // delete on their behalf.
            continue;
        };

        // Asked, not read. A marker is a name; whether anything is behind it
        // is a question only a connection can answer, because a file happily
        // outlives the process that wrote it.
        let Ok(at) = address(runtime_dir, &session) else { continue };
        if is_live(&at) {
            live.push(session);
        } else {
            let _ = std::fs::remove_file(&path);
            if is_file_backed() {
                let _ = std::fs::remove_file(&at);
            }
        }
    }

    // Swept after the markers, so a socket belonging to a session that *is*
    // alive is never mistaken for an orphan by an unlucky ordering.
    for path in orphans {
        let at = path.display().to_string();
        if !is_live(&at) {
            let _ = std::fs::remove_file(&path);
        }
    }

    live.sort();
    live
}

fn to_io(e: NameError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Frame;
    use std::io::Write;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jky-detach-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    #[test]
    fn nothing_is_listening_at_an_address_nobody_made() {
        let dir = scratch("absent");
        assert!(!is_live(&address(&dir, "never").unwrap()));
        assert!(sweep(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_listener_can_be_reached_and_is_listed() {
        let dir = scratch("live");
        let (at, _listener) = listen(&dir, "one").expect("listen");

        assert!(is_live(&at), "nothing answered at {at}");
        assert_eq!(sweep(&dir), vec!["one".to_string()]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_supervisor_refuses_rather_than_stealing_the_session() {
        // Two owners would each hold half the conversation, and the window
        // would see a shell that answers every other keystroke.
        let dir = scratch("taken");
        let (_at, _listener) = listen(&dir, "one").expect("listen");

        let again = listen(&dir, "one");
        assert!(again.is_err(), "the address was stolen");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /*
     * A socket left by a supervisor that was killed.
     *
     * It is a file, so it outlives the process, and binding to it fails until
     * it is removed. Deciding by connecting rather than by a pid means a
     * reused pid cannot make a dead session look alive.
     */
    #[cfg(not(windows))]
    #[test]
    fn a_socket_left_by_a_dead_supervisor_is_cleared_rather_than_fatal() {
        let dir = scratch("stale");
        let at = address(&dir, "ghost").unwrap();
        std::fs::create_dir_all(socket_dir(&dir)).unwrap();
        std::fs::write(&at, b"").expect("leave a corpse");

        assert!(!is_live(&at), "a plain file answered a connection");
        let (_at, _listener) = listen(&dir, "ghost").expect("the corpse should not block this");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(windows))]
    #[test]
    fn sweeping_removes_what_is_dead_and_keeps_what_is_not() {
        let dir = scratch("mixed");
        let (_at, _listener) = listen(&dir, "alive").expect("listen");

        // A session that was recorded and then died: both its marker and its
        // socket are left behind, and both have to go.
        let dead = address(&dir, "dead").unwrap();
        std::fs::write(&dead, b"").expect("leave a corpse");
        std::fs::write(marker(&dir, "dead").unwrap(), b"dead").expect("and its marker");

        // And one that died before it could record itself, so nothing indexes
        // it. Without the orphan pass this would sit there for ever.
        let unrecorded = address(&dir, "unrecorded").unwrap();
        std::fs::write(&unrecorded, b"").expect("leave a second corpse");
        // Something that is not ours at all, which must survive untouched.
        let theirs = socket_dir(&dir).join("notes.txt");
        std::fs::write(&theirs, b"keep me").unwrap();

        assert_eq!(sweep(&dir), vec!["alive".to_string()]);
        assert!(!Path::new(&dead).exists(), "the dead socket was left behind");
        assert!(!marker(&dir, "dead").unwrap().exists(), "its marker was left behind");
        assert!(!Path::new(&unrecorded).exists(), "an unrecorded socket was left for ever");
        assert!(theirs.exists(), "somebody else's file was deleted");
        // The live one keeps both halves.
        assert!(marker(&dir, "alive").unwrap().exists(), "a live session lost its marker");

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
