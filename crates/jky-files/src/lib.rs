//! Reading and writing files, inside one directory and nowhere else.
//!
//! The editor is the first thing in this app that needs the filesystem, and
//! the reason it took until now is that "let the window name a path" is the
//! single widest thing an IPC surface can offer: it is arbitrary read and
//! arbitrary write, in one command, dressed as a feature.
//!
//! So the window never names a path. It names a **workspace-relative** one,
//! and this crate resolves it against a root the person chose in Settings and
//! refuses anything that lands outside — checked after the path is
//! canonicalised, so `../` and a symlink pointing out of the tree are refused
//! by the same rule rather than by a list of tricks somebody thought of.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("no folder is open. Choose one in Settings → Editor")]
    NoRoot,
    #[error("`{0}` is outside the open folder")]
    Outside(String),
    #[error("`{0}` is not a file this editor can open")]
    NotText(String),
    #[error("`{0}` is larger than this editor will open")]
    TooBig(String),
    #[error("could not read `{path}`: {reason}")]
    Read { path: String, reason: String },
    #[error("could not write `{path}`: {reason}")]
    Write { path: String, reason: String },
}

/// The largest file the editor will open.
///
/// Not a limit of the editor so much as of the trip: the whole file crosses
/// IPC as a string and is held in the window twice over. A four-megabyte log
/// opened by accident should say so rather than freeze the app.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// One entry in a listing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    /// Workspace-relative, with `/` separators on every platform.
    ///
    /// One spelling, so a path that came from a listing is a path that can be
    /// opened — on Windows too, where the OS would otherwise hand back
    /// backslashes the next call has to understand.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// A directory the editor may work inside.
#[derive(Debug)]
pub struct Workspace {
    root: PathBuf,
}

/// Directories never worth listing, and expensive to walk into by accident.
const SKIP: &[&str] = &["node_modules", ".git", "target", "dist", ".next", ".turbo"];

impl Workspace {
    /// Open a root. The path is canonicalised once, here, so every later
    /// comparison is between two real paths rather than two spellings.
    pub fn new(root: impl AsRef<Path>) -> Result<Self, FileError> {
        let root = root.as_ref();
        let real = root.canonicalize().map_err(|e| FileError::Read {
            path: root.display().to_string(),
            reason: e.to_string(),
        })?;
        Ok(Self { root: real })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Turn a workspace-relative path into a real one, or refuse it.
    ///
    /// Two checks, and both are needed. The first refuses `..` and absolute
    /// paths before touching the disk, because a path that escapes should be
    /// refused whether or not it happens to exist. The second canonicalises
    /// and checks containment, which is what catches a symlink pointing out
    /// of the tree — the case no amount of string inspection can see.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, FileError> {
        let candidate = Path::new(relative);
        let refused = || FileError::Outside(relative.to_string());

        for part in candidate.components() {
            match part {
                Component::Normal(_) | Component::CurDir => {}
                // `..`, a leading `/`, and a Windows drive or UNC prefix.
                _ => return Err(refused()),
            }
        }

        let joined = self.root.join(candidate);

        // A file that does not exist yet has no canonical path, so the check
        // falls to its parent — which must exist and must be inside.
        let anchor = if joined.exists() { joined.clone() } else { joined.parent().map(Path::to_path_buf).ok_or_else(refused)? };
        let real = anchor.canonicalize().map_err(|_| refused())?;
        if !real.starts_with(&self.root) {
            return Err(refused());
        }

        Ok(joined)
    }

    /// What is in one directory. An empty path is the root.
    pub fn list(&self, relative: &str) -> Result<Vec<Entry>, FileError> {
        let dir = if relative.is_empty() { self.root.clone() } else { self.resolve(relative)? };

        let entries = std::fs::read_dir(&dir).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;

        let mut out = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            // The directories that are somebody's build output rather than
            // their work. Walking into `node_modules` by accident is a tree
            // nobody can scroll and a listing nobody wanted.
            if is_dir && SKIP.contains(&name.as_str()) {
                continue;
            }

            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{}/{name}", relative.trim_end_matches('/'))
            };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(Entry { path, name, is_dir, size });
        }

        // Directories first, then by name: the order a tree is read in.
        out.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    /// One file's text.
    ///
    /// Text, not bytes. Something that is not valid UTF-8 is refused rather
    /// than shown with the broken parts replaced: an editor that silently
    /// rewrote the bytes it could not read would corrupt the file the moment
    /// it was saved.
    pub fn read(&self, relative: &str) -> Result<String, FileError> {
        let path = self.resolve(relative)?;

        let meta = std::fs::metadata(&path).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;
        if meta.len() > MAX_BYTES {
            return Err(FileError::TooBig(relative.to_string()));
        }

        let bytes = std::fs::read(&path).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;

        String::from_utf8(bytes).map_err(|_| FileError::NotText(relative.to_string()))
    }

    /// Write one file, in place.
    ///
    /// Through a neighbouring file and a rename, so an interrupted save
    /// leaves the previous version whole rather than half of the new one.
    /// Creating a directory is deliberately not offered: this is an editor
    /// for files that are already there.
    pub fn write(&self, relative: &str, text: &str) -> Result<(), FileError> {
        let path = self.resolve(relative)?;
        let fail = |e: std::io::Error| FileError::Write {
            path: relative.to_string(),
            reason: e.to_string(),
        };

        let temp = path.with_extension("jky-saving");
        std::fs::write(&temp, text).map_err(fail)?;
        std::fs::rename(&temp, &path).map_err(fail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn workspace() -> (TempDir, Workspace) {
        let d = TempDir::new().unwrap();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::create_dir(d.path().join("node_modules")).unwrap();
        std::fs::write(d.path().join("README.md"), "hello\n").unwrap();
        std::fs::write(d.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let w = Workspace::new(d.path()).unwrap();
        (d, w)
    }

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_the_root_with_directories_first() {
        let (_d, w) = workspace();
        assert_eq!(names(&w.list("").unwrap()), ["src", "README.md"]);
    }

    #[test]
    fn skips_the_directories_that_are_build_output() {
        // Walking into node_modules by accident is a tree nobody can scroll.
        let (_d, w) = workspace();
        assert!(!names(&w.list("").unwrap()).contains(&"node_modules"));
    }

    #[test]
    fn a_listed_path_is_a_path_that_can_be_opened() {
        let (_d, w) = workspace();
        let src = w.list("src").unwrap();
        assert_eq!(src[0].path, "src/main.rs");
        assert_eq!(w.read(&src[0].path).unwrap(), "fn main() {}\n");
    }

    #[test]
    fn reads_and_writes_a_file() {
        let (_d, w) = workspace();
        w.write("README.md", "changed\n").unwrap();
        assert_eq!(w.read("README.md").unwrap(), "changed\n");
    }

    #[test]
    fn a_save_leaves_no_stray_file_behind() {
        let (d, w) = workspace();
        w.write("README.md", "changed\n").unwrap();
        assert!(!d.path().join("README.jky-saving").exists());
    }

    #[test]
    fn refuses_a_path_that_climbs_out_of_the_workspace() {
        let (_d, w) = workspace();
        for evil in ["../secrets", "src/../../secrets", "..", "src/.."] {
            assert!(matches!(w.read(evil), Err(FileError::Outside(_))), "read {evil}");
            assert!(matches!(w.write(evil, "x"), Err(FileError::Outside(_))), "write {evil}");
        }
    }

    #[test]
    fn refuses_an_absolute_path() {
        let (_d, w) = workspace();
        for evil in ["/etc/passwd", "/", "C:\\Windows\\win.ini"] {
            assert!(w.read(evil).is_err(), "accepted {evil}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn refuses_a_symlink_pointing_out_of_the_workspace() {
        // The case no amount of string inspection can see, and the reason
        // containment is checked after canonicalising rather than before.
        let (d, w) = workspace();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret"), "s3kr1t\n").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), d.path().join("link")).unwrap();

        assert!(matches!(w.read("link"), Err(FileError::Outside(_))));
        assert!(matches!(w.write("link", "x"), Err(FileError::Outside(_))));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_that_stays_inside_is_fine() {
        // Refusing it would break a perfectly ordinary repository.
        let (d, w) = workspace();
        std::os::unix::fs::symlink(d.path().join("README.md"), d.path().join("link")).unwrap();
        assert_eq!(w.read("link").unwrap(), "hello\n");
    }

    #[test]
    fn a_file_that_does_not_exist_yet_can_still_be_written_inside() {
        let (_d, w) = workspace();
        w.write("src/new.rs", "// new\n").unwrap();
        assert_eq!(w.read("src/new.rs").unwrap(), "// new\n");
    }

    #[test]
    fn a_new_file_outside_the_workspace_is_still_refused() {
        let (_d, w) = workspace();
        assert!(matches!(w.write("../escape.txt", "x"), Err(FileError::Outside(_))));
    }

    #[test]
    fn refuses_a_file_that_is_not_text() {
        // An editor that silently rewrote the bytes it could not read would
        // corrupt the file the moment it was saved.
        let (d, w) = workspace();
        std::fs::write(d.path().join("logo.png"), [0xff, 0xd8, 0xff, 0xe0]).unwrap();
        assert!(matches!(w.read("logo.png"), Err(FileError::NotText(_))));
    }

    #[test]
    fn refuses_a_file_larger_than_it_will_open() {
        let (d, w) = workspace();
        std::fs::write(d.path().join("huge.log"), vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(matches!(w.read("huge.log"), Err(FileError::TooBig(_))));
    }

    #[test]
    fn a_missing_file_says_so_rather_than_looking_empty() {
        let (_d, w) = workspace();
        assert!(matches!(w.read("nope.txt"), Err(FileError::Read { .. })));
    }

    #[test]
    fn a_root_that_is_not_there_is_refused_when_it_is_opened() {
        assert!(Workspace::new("/definitely/not/here").is_err());
    }
}
