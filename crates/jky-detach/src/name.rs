//! Where a detached session can be found, and what it may be called.
//!
//! A session that outlives its window has to be discoverable by the next
//! window, which means a name on the filesystem. Two things make that
//! delicate, and both are here rather than next to the socket code so they
//! can be tested without creating one.
//!
//! The name comes from the window and becomes a path, so it is checked the
//! way any path built from an argument has to be: a name containing a
//! separator or a parent reference is a name that addresses somewhere else
//! entirely. Only the alphabet that ids are actually made of is allowed.
//!
//! And on Windows the path is not a path at all — a named pipe lives in a
//! flat namespace with a fixed prefix, not in a directory — so what these
//! return differs by platform while the checking does not.

use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum NameError {
    #[error("a session name cannot be empty")]
    Empty,
    #[error("`{0}` is not a name this can use: only letters, digits, dash and underscore")]
    Unusable(String),
    #[error("a session name cannot be longer than {max} characters")]
    TooLong { max: usize },
}

/// The longest a session name may be.
///
/// A Unix socket path is bounded by the OS at around 104 bytes on macOS, and
/// the directory it sits in takes most of that. This leaves room.
pub const MAX_NAME: usize = 48;

/// Check a name before it is ever used to build a path.
///
/// Rejecting is the whole job. `..` and `/` are the obvious ones; a leading
/// dot hides the socket from a directory listing, which makes a leaked
/// session invisible to the person who would otherwise clean it up.
pub fn check(name: &str) -> Result<&str, NameError> {
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > MAX_NAME {
        return Err(NameError::TooLong { max: MAX_NAME });
    }
    // An allow-list, not a deny-list: every path trick anybody thinks of
    // later is already excluded rather than needing another rule.
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(NameError::Unusable(name.to_string()));
    }
    Ok(name)
}

/// The directory detached sessions live in, given the app's runtime directory.
///
/// Its own directory so the sockets can be listed, and so removing it removes
/// every one of them and nothing else.
pub fn socket_dir(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join("sessions")
}

/// Where one session listens.
///
/// On Unix this is a path; on Windows it is a pipe name, which is not a path
/// and is not created in any directory. Callers treat the result as an opaque
/// address rather than as a file, except when cleaning up — which is why
/// `is_file_backed` exists.
pub fn address(runtime_dir: &Path, name: &str) -> Result<String, NameError> {
    let name = check(name)?;

    #[cfg(windows)]
    {
        // A named pipe does not live in a directory. The namespace is flat
        // and machine-wide, so the runtime directory — which is what makes
        // two instances or two logged-in users distinct — has to be folded
        // into the name itself or they collide. Two windows each opening a
        // session called `pty-1` is not a corner case; it is Tuesday.
        Ok(format!(r"\\.\pipe\jky-terminal-{}-{name}", digest(runtime_dir)))
    }

    #[cfg(not(windows))]
    {
        Ok(socket_dir(runtime_dir).join(format!("{name}.sock")).display().to_string())
    }
}

/// A short, stable digest of a path.
///
/// Windows only, because only there is the namespace flat: a Unix socket path
/// already contains the runtime directory and needs nothing folded in.
///
/// FNV-1a, written out rather than taken from the standard library, because
/// `DefaultHasher` makes no promise about being the same from one release of
/// Rust to the next — and a supervisor started by yesterday's build has to be
/// findable by today's.
#[cfg(windows)]
fn digest(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.display().to_string().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Where the note recording a session lives.
///
/// A named pipe leaves nothing on disk, so on Windows there is no directory
/// to list and no way to find a detached session again. A small marker file
/// gives every platform the same answer to "what sessions are there": list
/// these, then ask each one whether anything is still listening.
///
/// The marker is only a name. Whether the session is alive is never read from
/// a file — that is decided by connecting, because a file can outlive the
/// process that wrote it and a connection cannot.
pub fn marker(runtime_dir: &Path, name: &str) -> Result<PathBuf, NameError> {
    let name = check(name)?;
    Ok(socket_dir(runtime_dir).join(format!("{name}.session")))
}

/// Whether an address is a file that has to be cleaned up.
///
/// True on Unix, where a socket outlives the process that made it and a stale
/// one has to be removed before the address can be used again. False on
/// Windows, where a pipe disappears with its owner and there is nothing to
/// sweep.
pub const fn is_file_backed() -> bool {
    !cfg!(windows)
}

/// The session a socket file belongs to, or None when it is not one of ours.
///
/// Used when listing what is running: anything in the directory that is not a
/// `.sock` we could have made is somebody else's business.
pub fn name_of(path: &Path) -> Option<String> {
    let file = path.file_name()?.to_str()?;
    let name = file.strip_suffix(".session")?;
    check(name).ok().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_ids_are_usable() {
        for name in ["pty-1", "tab_3", "a", "Session-42"] {
            assert!(check(name).is_ok(), "{name}");
        }
    }

    /*
     * The reason this file exists.
     *
     * The name arrives from the window and becomes a path. A separator or a
     * parent reference in it addresses somewhere else entirely, and a leading
     * dot hides the socket from the listing that would show a leaked session.
     */
    #[test]
    fn a_name_that_is_really_a_path_is_refused() {
        for name in [
            "../escape",
            "..",
            ".",
            "a/b",
            r"a\b",
            "/etc/passwd",
            ".hidden",
            "has space",
            "semi;colon",
            "null\0byte",
            "tilde~",
        ] {
            assert!(check(name).is_err(), "{name:?} was accepted");
        }
    }

    #[test]
    fn an_empty_name_is_refused_by_its_own_error() {
        assert!(matches!(check(""), Err(NameError::Empty)));
    }

    #[test]
    fn a_name_too_long_for_a_socket_path_is_refused() {
        // macOS bounds the whole path near 104 bytes, and the directory takes
        // most of it — so this is refused here rather than by a bind() that
        // fails for a reason nobody can read.
        let long = "a".repeat(MAX_NAME + 1);
        assert!(matches!(check(&long), Err(NameError::TooLong { .. })));
        assert!(check(&"a".repeat(MAX_NAME)).is_ok());
    }

    #[test]
    fn an_address_is_refused_for_a_name_that_was_refused() {
        assert!(address(Path::new("/run/jky"), "../nope").is_err());
    }

    #[test]
    fn sessions_live_together_so_they_can_be_listed_and_swept() {
        assert_eq!(socket_dir(Path::new("/run/jky")), Path::new("/run/jky/sessions"));
    }

    #[cfg(not(windows))]
    #[test]
    fn a_unix_address_is_a_socket_in_that_directory() {
        let at = address(Path::new("/run/jky"), "pty-1").unwrap();
        assert_eq!(at, "/run/jky/sessions/pty-1.sock");
        assert!(is_file_backed(), "a unix socket has to be swept");
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_address_is_a_pipe_rather_than_a_file() {
        let at = address(Path::new(r"C:\run\jky"), "pty-1").unwrap();
        assert!(at.starts_with(r"\\.\pipe\"), "{at}");
        // Nothing to sweep: a pipe goes when its owner does.
        assert!(!is_file_backed());
    }

    #[test]
    fn a_marker_says_which_session_it_belongs_to() {
        assert_eq!(name_of(Path::new("/run/jky/sessions/pty-7.session")).as_deref(), Some("pty-7"));
    }

    /*
     * The Windows namespace is flat and machine-wide.
     *
     * Nothing about the runtime directory is in the path there, so without
     * folding it into the name, two windows — or two people logged in at
     * once — each opening `pty-1` would meet each other's shell.
     */
    #[test]
    fn two_instances_do_not_share_an_address() {
        let one = address(Path::new("/run/a"), "pty-1").unwrap();
        let two = address(Path::new("/run/b"), "pty-1").unwrap();
        assert_ne!(one, two);
    }

    #[test]
    fn the_same_instance_always_gets_the_same_address() {
        // A supervisor started by an earlier launch has to be findable by a
        // later one, so this cannot drift between runs or Rust versions.
        assert_eq!(
            address(Path::new("/run/a"), "pty-1").unwrap(),
            address(Path::new("/run/a"), "pty-1").unwrap()
        );
    }

    #[test]
    fn anything_else_in_the_directory_is_somebody_elses_business() {
        for path in ["/run/jky/sessions/notes.txt", "/run/jky/sessions/.session", "/run/jky"] {
            assert_eq!(name_of(Path::new(path)), None, "{path}");
        }
    }

    /*
     * The name is checked, not the path it came from.
     *
     * These paths only ever come from listing the directory, so a parent
     * reference in one is not a case that arises — and `file_name` ignores it
     * anyway. What has to hold is that a *file name* nobody could have
     * created is not reported as a session.
     */
    #[test]
    fn a_socket_named_something_we_would_never_make_is_not_ours() {
        for path in [
            "/run/jky/sessions/has space.session",
            "/run/jky/sessions/...session",
            "/run/jky/sessions/semi;colon.session",
        ] {
            assert_eq!(name_of(Path::new(path)), None, "{path}");
        }
    }
}
