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

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
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
    #[error("`{0}` is already there")]
    Exists(String),
    #[error("`{0}` is not empty")]
    NotEmpty(String),
    #[error("a name cannot be empty")]
    NoName,
}

/// The largest file the editor will open.
///
/// Not a limit of the editor so much as of the trip: the whole file crosses
/// IPC as a string and is held in the window twice over. A four-megabyte log
/// opened by accident should say so rather than freeze the app.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024;
static SAVE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// What a file that is not text turns out to be.
///
/// The editor refuses to *edit* anything it cannot decode, and that refusal
/// is right — an editor that silently rewrote the bytes it could not read
/// would corrupt the file on the next save. But refusing to *show* it is a
/// different thing, and it left the person who clicked a `.jpeg` looking at
/// an error and an empty pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewKind {
    /// Shown as a picture.
    Image,
    /// Named and measured, not drawn: see the note on `Preview::data`.
    Pdf,
    /// Anything else that is not text.
    Binary,
}

/// A file the editor can show but not edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Preview {
    pub kind: PreviewKind,
    /// For the `data:` URL an image is drawn from.
    pub mime: String,
    pub size: u64,
    /// The bytes, base64, for anything small enough that showing it is worth
    /// the trip.
    ///
    /// Images and PDFs. Both are drawn in the window — the PDF by a renderer
    /// that turns its pages into pictures, which is what lets it be shown
    /// without widening `frame-src` to accept `data:` and without depending
    /// on a webview having its own PDF viewer. Anything else has no useful
    /// picture, so it is named and measured instead.
    pub data: Option<String>,
    /// Why there are no bytes, when there are none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// The largest picture worth sending over IPC.
///
/// The whole file crosses as base64 — a third larger than the bytes — and is
/// then held in the window twice over. A photograph off a phone is under
/// this; a raw scan is not, and is named rather than drawn.
pub const MAX_PREVIEW_BYTES: u64 = 4 * 1024 * 1024;

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
///
/// Holds an open handle to the folder, not just its name. Every operation is
/// resolved **beneath that handle** — `openat2(RESOLVE_BENEATH)` on Linux, an
/// equivalent component-by-component walk elsewhere, via `cap-std` — so the
/// question "is this inside the folder?" is answered by the same system call
/// that opens the file. There is no gap between checking a path and using
/// it for another process to swap a directory for a link, which is what the
/// earlier canonicalise-then-open design left open.
#[derive(Debug)]
pub struct Workspace {
    root: PathBuf,
    dir: Dir,
}

/// Directories never worth listing, and expensive to walk into by accident.
const SKIP: &[&str] = &["node_modules", ".git", "target", "dist", ".next", ".turbo"];

/// Whether an error is the sandbox refusing a path that led out of it.
fn escaped(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied && e.to_string().contains("outside of the filesystem")
}

fn read_err(relative: &str) -> impl Fn(std::io::Error) -> FileError + '_ {
    move |e| {
        if escaped(&e) {
            FileError::Outside(relative.to_string())
        } else {
            FileError::Read { path: relative.to_string(), reason: e.to_string() }
        }
    }
}

fn write_err(relative: &str) -> impl Fn(std::io::Error) -> FileError + '_ {
    move |e| {
        if escaped(&e) {
            FileError::Outside(relative.to_string())
        } else {
            FileError::Write { path: relative.to_string(), reason: e.to_string() }
        }
    }
}

impl Workspace {
    /// Open a root. The path is canonicalised once, here, for display and for
    /// callers that need to name the folder; every file operation after this
    /// goes through the open handle instead.
    pub fn new(root: impl AsRef<Path>) -> Result<Self, FileError> {
        let root = root.as_ref();
        let fail = |e: std::io::Error| FileError::Read { path: root.display().to_string(), reason: e.to_string() };
        let real = root.canonicalize().map_err(fail)?;
        let dir = Dir::open_ambient_dir(&real, ambient_authority()).map_err(fail)?;
        Ok(Self { root: real, dir })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Check a workspace-relative path by its spelling, before any disk access.
    ///
    /// `..`, a leading `/`, and a Windows drive or UNC prefix are refused
    /// whether or not the place they name exists. The sandbox would refuse
    /// them too; refusing them here gives the person the clearer message.
    /// What the spelling cannot reveal — a link pointing out of the tree — is
    /// caught by the handle at the moment of use.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, FileError> {
        let candidate = Path::new(relative);
        for part in candidate.components() {
            match part {
                Component::Normal(_) | Component::CurDir => {}
                _ => return Err(FileError::Outside(relative.to_string())),
            }
        }
        Ok(if relative.is_empty() { PathBuf::from(".") } else { candidate.to_path_buf() })
    }

    /// What is in one directory. An empty path is the root.
    pub fn list(&self, relative: &str) -> Result<Vec<Entry>, FileError> {
        let at = self.resolve(relative)?;
        let entries = self.dir.read_dir(&at).map_err(read_err(relative))?;

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

    /// Open a file for reading and measure it — through one handle, so the
    /// size checked is the size of the file actually read.
    fn open_read(&self, relative: &str) -> Result<(cap_std::fs::File, u64), FileError> {
        let at = self.resolve(relative)?;
        let file = self.dir.open(&at).map_err(read_err(relative))?;
        let meta = file.metadata().map_err(read_err(relative))?;
        if meta.is_dir() {
            return Err(FileError::Read { path: relative.to_string(), reason: "it is a folder".into() });
        }
        Ok((file, meta.len()))
    }

    /// One file's text.
    ///
    /// Text, not bytes. Something that is not valid UTF-8 is refused rather
    /// than shown with the broken parts replaced: an editor that silently
    /// rewrote the bytes it could not read would corrupt the file the moment
    /// it was saved.
    pub fn read(&self, relative: &str) -> Result<String, FileError> {
        let (file, size) = self.open_read(relative)?;
        if size > MAX_BYTES {
            return Err(FileError::TooBig(relative.to_string()));
        }
        let mut bytes = Vec::with_capacity(size as usize);
        // Bounded even if the file grows between the measure and the read.
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(read_err(relative))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(FileError::TooBig(relative.to_string()));
        }
        String::from_utf8(bytes).map_err(|_| FileError::NotText(relative.to_string()))
    }

    /// Write one file, in place.
    ///
    /// Through a neighbouring file and a rename, both beneath the folder's
    /// handle, so an interrupted save leaves the previous version whole and
    /// neither step can be redirected out of the tree. Creating a directory
    /// is deliberately not offered: this is an editor for files that are
    /// already there.
    pub fn write(&self, relative: &str, text: &str) -> Result<(), FileError> {
        let at = self.resolve(relative)?;
        let name = Self::named(relative)?;
        let parent = at.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let fail = write_err(relative);

        // A link at the final name would make the rename replace the link
        // and leave its target alone — fine — but a link pointing out of the
        // tree is refused outright, the same as reading through it.
        if let Ok(meta) = self.dir.symlink_metadata(&at) {
            if meta.file_type().is_symlink() {
                self.dir.metadata(&at).map_err(write_err(relative))?;
            }
        }

        for _ in 0..32 {
            let sequence = SAVE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let temp = parent.join(format!(".{name}.jky-saving-{}-{sequence}", std::process::id()));
            let mut options = cap_std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = match self.dir.open_with(&temp, &options) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(fail(e)),
            };
            let written = file.write_all(text.as_bytes()).and_then(|_| file.sync_all());
            drop(file);
            if let Err(error) = written.and_then(|_| self.dir.rename(&temp, &self.dir, &at)) {
                let _ = self.dir.remove_file(&temp);
                return Err(fail(error));
            }
            return Ok(());
        }
        Err(fail(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "could not reserve a temporary save file")))
    }

    /// Make a new, empty file.
    ///
    /// Refuses one that is already there rather than truncating it — with
    /// `create_new`, so the refusal is the same system call as the creation
    /// and nothing can appear in between. "New file" and "erase this file"
    /// are different requests, and a name typed by accident into the first
    /// must never perform the second.
    pub fn create_file(&self, relative: &str) -> Result<(), FileError> {
        let at = self.checked(relative)?;
        if let Some(parent) = at.parent().filter(|p| !p.as_os_str().is_empty()) {
            self.dir.create_dir_all(parent).map_err(write_err(relative))?;
        }
        let mut options = cap_std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        match self.dir.open_with(&at, &options) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(FileError::Exists(relative.to_string())),
            Err(e) => Err(write_err(relative)(e)),
        }
    }

    /// Make a new directory, and any directory above it that is missing.
    pub fn create_dir(&self, relative: &str) -> Result<(), FileError> {
        let at = self.checked(relative)?;
        if let Some(parent) = at.parent().filter(|p| !p.as_os_str().is_empty()) {
            self.dir.create_dir_all(parent).map_err(write_err(relative))?;
        }
        match self.dir.create_dir(&at) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(FileError::Exists(relative.to_string())),
            Err(e) => Err(write_err(relative)(e)),
        }
    }

    /// Move or rename, inside this workspace.
    ///
    /// Both ends are resolved beneath the folder's handle, so a rename cannot
    /// be a way out of the tree — which is the obvious thing to try once
    /// reading and writing are both fenced. A rename acts on the entry itself:
    /// a link is moved as the link it is, never followed.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), FileError> {
        let source = self.checked(from)?;
        let target = self.checked(to)?;
        self.dir.symlink_metadata(&source).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                FileError::Read { path: from.to_string(), reason: "it is not there".to_string() }
            } else {
                read_err(from)(e)
            }
        })?;
        // Refused rather than overwriting. A rename that silently replaced
        // another file would destroy it with no way back.
        if source != target && self.dir.symlink_metadata(&target).is_ok() {
            return Err(FileError::Exists(to.to_string()));
        }
        if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
            self.dir.create_dir_all(parent).map_err(write_err(to))?;
        }
        self.dir.rename(&source, &self.dir, &target).map_err(write_err(to))
    }

    /// Delete one file, or one directory that has nothing in it.
    ///
    /// A directory with contents is refused. There is no undo here and no
    /// wastebasket to fish something out of, so an editor that removed a tree
    /// on one click would be one misclick from taking somebody's project —
    /// and the shell is right there for anyone who really means it.
    pub fn delete(&self, relative: &str) -> Result<(), FileError> {
        let at = self.checked(relative)?;
        // A symlink is removed as the link it is, never followed — following
        // one would delete a file outside the workspace through a name inside
        // it. `symlink_metadata` and `remove_file` both act on the final name
        // itself.
        let meta = self.dir.symlink_metadata(&at).map_err(read_err(relative))?;
        if meta.file_type().is_symlink() || meta.is_file() {
            return self.dir.remove_file(&at).map_err(write_err(relative));
        }
        let empty = self.dir.read_dir(&at).map_err(read_err(relative))?.next().is_none();
        if !empty {
            return Err(FileError::NotEmpty(relative.to_string()));
        }
        self.dir.remove_dir(&at).map_err(write_err(relative))
    }

    /// What a file is, for something that cannot be edited.
    ///
    /// Opens the file through the same handle `read` does and is fenced the
    /// same way; it differs only in what it does with a file that is not
    /// UTF-8. Nothing here can write.
    pub fn preview(&self, relative: &str) -> Result<Preview, FileError> {
        let (file, size) = self.open_read(relative)?;

        let name = relative.rsplit('/').next().unwrap_or(relative).to_lowercase();
        let extension = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        let (kind, mime) = match extension {
            "png" => (PreviewKind::Image, "image/png"),
            "jpg" | "jpeg" => (PreviewKind::Image, "image/jpeg"),
            "gif" => (PreviewKind::Image, "image/gif"),
            "webp" => (PreviewKind::Image, "image/webp"),
            "bmp" => (PreviewKind::Image, "image/bmp"),
            "ico" => (PreviewKind::Image, "image/x-icon"),
            "avif" => (PreviewKind::Image, "image/avif"),
            "pdf" => (PreviewKind::Pdf, "application/pdf"),
            _ => (PreviewKind::Binary, "application/octet-stream"),
        };

        if kind == PreviewKind::Binary {
            return Ok(Preview {
                kind,
                mime: mime.into(),
                size,
                data: None,
                note: Some("there is no useful way to show this".into()),
            });
        }

        if size > MAX_PREVIEW_BYTES {
            return Ok(Preview {
                kind,
                mime: mime.into(),
                size,
                data: None,
                note: Some("larger than this editor will show".into()),
            });
        }

        let mut bytes = Vec::with_capacity(size as usize);
        file.take(MAX_PREVIEW_BYTES + 1).read_to_end(&mut bytes).map_err(read_err(relative))?;
        Ok(Preview {
            kind,
            mime: mime.into(),
            size,
            data: Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)),
            note: None,
        })
    }

    /// Check a path that must also carry a name.
    ///
    /// `resolve` accepts the workspace root itself, which is right for
    /// listing and wrong for every call here: creating, renaming or deleting
    /// "" would mean doing it to the whole folder.
    fn checked(&self, relative: &str) -> Result<PathBuf, FileError> {
        Self::named(relative)?;
        self.resolve(relative.trim_end_matches('/'))
    }

    /// The last part of a path, refusing one that has none.
    fn named(relative: &str) -> Result<String, FileError> {
        let trimmed = relative.trim_end_matches('/');
        let last = trimmed.rsplit('/').next().unwrap_or("").trim();
        if last.is_empty() || last == "." || last == ".." {
            return Err(FileError::NoName);
        }
        Ok(last.to_string())
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

    /// The time-of-check/time-of-use race the canonicalise-then-open design
    /// left open: a link inside the folder flips between a target inside and
    /// one outside while files are read through it. Checking the path and
    /// then opening it again by name lets the outside file through whenever
    /// the flip lands between the two. Every open must be judged at the
    /// moment it happens, against the directory handle itself.
    #[cfg(unix)]
    #[test]
    fn a_link_swapped_mid_read_never_lets_an_outside_file_through() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let d = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "OUTSIDE").unwrap();
        std::fs::create_dir(d.path().join("real")).unwrap();
        std::fs::write(d.path().join("real/secret.txt"), "INSIDE").unwrap();
        std::os::unix::fs::symlink("real", d.path().join("inner")).unwrap();
        let w = Workspace::new(d.path()).unwrap();

        let stop = AtomicBool::new(false);
        let leaked = std::thread::scope(|scope| {
            scope.spawn(|| {
                let swap = d.path().join("inner.swap");
                let mut out = false;
                while !stop.load(Ordering::Relaxed) {
                    let target = if out { outside.path().to_path_buf() } else { "real".into() };
                    let _ = std::fs::remove_file(&swap);
                    std::os::unix::fs::symlink(&target, &swap).unwrap();
                    std::fs::rename(&swap, d.path().join("inner")).unwrap();
                    out = !out;
                }
            });
            let started = std::time::Instant::now();
            let mut leaked = false;
            while started.elapsed() < std::time::Duration::from_millis(1500) {
                if let Ok(text) = w.read("inner/secret.txt") {
                    if text == "OUTSIDE" {
                        leaked = true;
                        break;
                    }
                }
            }
            stop.store(true, Ordering::Relaxed);
            leaked
        });
        assert!(!leaked, "a file outside the workspace was read through a swapped link");
    }

    /// The other half of the race: after a path is checked, a real directory
    /// in it is swapped for a link pointing outside before the file is opened.
    #[cfg(unix)]
    #[test]
    fn a_directory_swapped_for_a_link_mid_write_never_writes_outside() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let d = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::create_dir(d.path().join("real")).unwrap();
        std::fs::write(d.path().join("real/notes.md"), "inside").unwrap();
        std::fs::write(outside.path().join("notes.md"), "untouched").unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("real.link")).unwrap();
        let w = Workspace::new(d.path()).unwrap();

        let stop = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let p = |n: &str| d.path().join(n);
                while !stop.load(Ordering::Relaxed) {
                    let _ = std::fs::rename(p("real"), p("real.dir"));
                    let _ = std::fs::rename(p("real.link"), p("real"));
                    let _ = std::fs::rename(p("real"), p("real.link"));
                    let _ = std::fs::rename(p("real.dir"), p("real"));
                }
            });
            let started = std::time::Instant::now();
            while started.elapsed() < std::time::Duration::from_millis(1500) {
                let _ = w.write("real/notes.md", "WRITTEN");
            }
            stop.store(true, Ordering::Relaxed);
        });
        assert_eq!(
            std::fs::read_to_string(outside.path().join("notes.md")).unwrap(),
            "untouched",
            "a save landed outside the workspace through a swapped directory"
        );
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
    fn a_relative_symlink_that_stays_inside_is_fine() {
        // Refusing it would break a perfectly ordinary repository.
        let (d, w) = workspace();
        std::os::unix::fs::symlink("README.md", d.path().join("link")).unwrap();
        std::os::unix::fs::symlink("../README.md", d.path().join("src/up")).unwrap();
        assert_eq!(w.read("link").unwrap(), "hello\n");
        assert_eq!(w.read("src/up").unwrap(), "hello\n");
    }

    #[test]
    #[cfg(unix)]
    fn an_absolute_symlink_is_refused_even_when_it_points_inside() {
        // The price of resolving every path beneath the folder's handle: an
        // absolute target names the machine's root, which the handle cannot
        // vouch for without a second, raceable lookup. Relative links — the
        // kind Git and most tools create — work; absolute ones are refused
        // rather than checked in a way that could be swapped mid-check.
        let (d, w) = workspace();
        std::os::unix::fs::symlink(d.path().join("README.md"), d.path().join("link")).unwrap();
        assert!(matches!(w.read("link"), Err(FileError::Outside(_))));
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

#[cfg(test)]
mod change_tests {
    use super::*;
    use tempfile::TempDir;

    fn workspace() -> (TempDir, Workspace) {
        let d = TempDir::new().unwrap();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::write(d.path().join("README.md"), "hello\n").unwrap();
        std::fs::write(d.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let w = Workspace::new(d.path()).unwrap();
        (d, w)
    }

    #[test]
    fn makes_an_empty_file() {
        let (_d, w) = workspace();
        w.create_file("notes.md").unwrap();
        assert_eq!(w.read("notes.md").unwrap(), "");
    }

    #[test]
    fn makes_the_directories_a_new_file_needs() {
        let (_d, w) = workspace();
        w.create_file("a/b/c.txt").unwrap();
        assert_eq!(w.read("a/b/c.txt").unwrap(), "");
    }

    #[test]
    fn refuses_to_make_a_file_that_is_already_there() {
        // "New file" and "erase this file" are different requests, and a name
        // typed by accident into the first must never perform the second.
        let (_d, w) = workspace();
        assert!(matches!(w.create_file("README.md"), Err(FileError::Exists(_))));
        assert_eq!(w.read("README.md").unwrap(), "hello\n");
    }

    #[test]
    fn makes_a_directory() {
        let (_d, w) = workspace();
        w.create_dir("docs/img").unwrap();
        assert!(w.list("docs").is_ok());
    }

    #[test]
    fn renames_a_file_and_keeps_what_was_in_it() {
        let (_d, w) = workspace();
        w.rename("README.md", "READ.md").unwrap();
        assert_eq!(w.read("READ.md").unwrap(), "hello\n");
        assert!(w.read("README.md").is_err());
    }

    #[test]
    fn moves_a_file_into_another_directory() {
        let (_d, w) = workspace();
        w.rename("README.md", "src/README.md").unwrap();
        assert_eq!(w.read("src/README.md").unwrap(), "hello\n");
    }

    #[test]
    fn refuses_a_rename_that_would_destroy_another_file() {
        let (_d, w) = workspace();
        assert!(matches!(w.rename("README.md", "src/main.rs"), Err(FileError::Exists(_))));
        assert_eq!(w.read("src/main.rs").unwrap(), "fn main() {}\n");
    }

    #[test]
    fn refuses_to_rename_something_that_is_not_there() {
        let (_d, w) = workspace();
        assert!(w.rename("ghost.md", "other.md").is_err());
    }

    #[test]
    fn deletes_a_file() {
        let (_d, w) = workspace();
        w.delete("README.md").unwrap();
        assert!(w.read("README.md").is_err());
    }

    #[test]
    fn deletes_an_empty_directory_and_refuses_one_that_is_not() {
        // No undo and no wastebasket, so removing a tree on one click would
        // be one misclick from taking somebody's project.
        let (_d, w) = workspace();
        w.create_dir("empty").unwrap();
        w.delete("empty").unwrap();

        assert!(matches!(w.delete("src"), Err(FileError::NotEmpty(_))));
        assert_eq!(w.read("src/main.rs").unwrap(), "fn main() {}\n");
    }

    #[test]
    fn every_change_refuses_a_path_that_climbs_out() {
        // The obvious thing to try once reading and writing are both fenced.
        let (_d, w) = workspace();
        for evil in ["../escape.txt", "/etc/passwd", "src/../../escape"] {
            assert!(w.create_file(evil).is_err(), "create {evil}");
            assert!(w.create_dir(evil).is_err(), "mkdir {evil}");
            assert!(w.delete(evil).is_err(), "delete {evil}");
            assert!(w.rename("README.md", evil).is_err(), "rename to {evil}");
            assert!(w.rename(evil, "here.txt").is_err(), "rename from {evil}");
        }
        assert_eq!(w.read("README.md").unwrap(), "hello\n");
    }

    #[test]
    fn refuses_to_act_on_the_workspace_itself() {
        // `resolve` accepts the root, which is right for listing and wrong for
        // every one of these: deleting "" would mean deleting the folder.
        let (_d, w) = workspace();
        for empty in ["", "   ", "/", ".", ".."] {
            assert!(matches!(w.delete(empty), Err(FileError::NoName)), "delete {empty:?}");
            assert!(matches!(w.create_file(empty), Err(FileError::NoName)), "create {empty:?}");
            assert!(matches!(w.rename(empty, "x"), Err(FileError::NoName)), "rename {empty:?}");
        }
    }

    #[test]
    fn a_trailing_slash_still_names_the_directory_it_is_on() {
        let (_d, w) = workspace();
        w.create_dir("empty").unwrap();
        w.delete("empty/").unwrap();
        assert!(w.list("empty").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn deleting_a_symlink_removes_the_link_and_not_what_it_points_at() {
        // Following one would delete a file outside the workspace through a
        // name inside it.
        let (d, w) = workspace();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret");
        std::fs::write(&secret, "s3kr1t\n").unwrap();
        std::os::unix::fs::symlink(&secret, d.path().join("link")).unwrap();

        w.delete("link").unwrap();
        assert!(secret.exists(), "the file the link pointed at was deleted");
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    use tempfile::TempDir;

    /// The smallest real PNG: one transparent pixel.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89,
    ];

    fn workspace() -> (TempDir, Workspace) {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("shot.png"), PNG).unwrap();
        std::fs::write(d.path().join("scan.pdf"), b"%PDF-1.4\n").unwrap();
        std::fs::write(d.path().join("notes.md"), "hello\n").unwrap();
        let w = Workspace::new(d.path()).unwrap();
        (d, w)
    }

    #[test]
    fn an_image_comes_back_with_its_bytes_and_its_type() {
        // Enough to build a data: URL from, which is all the window needs —
        // `img-src 'self' data:` already permits one.
        let (_d, w) = workspace();
        let preview = w.preview("shot.png").unwrap();

        assert_eq!(preview.kind, PreviewKind::Image);
        assert_eq!(preview.mime, "image/png");
        assert_eq!(preview.size, PNG.len() as u64);
        assert!(preview.data.is_some());
        assert_eq!(preview.note, None);
    }

    #[test]
    fn a_jpeg_is_an_image_however_it_is_spelled() {
        let (d, w) = workspace();
        for name in ["a.jpg", "b.jpeg", "c.JPEG"] {
            std::fs::write(d.path().join(name), PNG).unwrap();
            assert_eq!(w.preview(name).unwrap().mime, "image/jpeg", "{name}");
        }
    }

    #[test]
    fn a_pdf_comes_back_with_its_bytes_to_be_drawn_from() {
        // Drawn by a renderer that turns its pages into pictures, which is
        // what lets it be shown without widening frame-src to accept data:
        // and without depending on the webview having a PDF viewer.
        let (_d, w) = workspace();
        let preview = w.preview("scan.pdf").unwrap();

        assert_eq!(preview.kind, PreviewKind::Pdf);
        assert_eq!(preview.mime, "application/pdf");
        assert!(preview.data.is_some());
        assert_eq!(preview.note, None);
        assert!(preview.size > 0);
    }

    #[test]
    fn a_pdf_too_large_to_send_is_named_instead() {
        let (d, w) = workspace();
        std::fs::write(d.path().join("huge.pdf"), vec![0u8; (MAX_PREVIEW_BYTES + 1) as usize])
            .unwrap();

        let preview = w.preview("huge.pdf").unwrap();
        assert_eq!(preview.kind, PreviewKind::Pdf);
        assert_eq!(preview.data, None);
        assert!(preview.note.is_some());
    }

    #[test]
    fn anything_else_says_so_rather_than_pretending() {
        let (d, w) = workspace();
        std::fs::write(d.path().join("thing.bin"), [0xff, 0xd8, 0x00]).unwrap();
        let preview = w.preview("thing.bin").unwrap();

        assert_eq!(preview.kind, PreviewKind::Binary);
        assert_eq!(preview.data, None);
        assert!(preview.note.is_some());
    }

    #[test]
    fn a_picture_too_large_to_send_is_named_instead_of_refused() {
        let (d, w) = workspace();
        std::fs::write(d.path().join("huge.png"), vec![0u8; (MAX_PREVIEW_BYTES + 1) as usize])
            .unwrap();

        let preview = w.preview("huge.png").unwrap();
        assert_eq!(preview.kind, PreviewKind::Image);
        assert_eq!(preview.data, None);
        assert!(preview.note.is_some());
    }

    #[test]
    fn preview_is_fenced_exactly_as_reading_is() {
        // It reads the same bytes through the same resolver; the only
        // difference is what it does with a file that is not UTF-8.
        let (_d, w) = workspace();
        for evil in ["../escape.png", "/etc/passwd", "src/../../escape"] {
            assert!(w.preview(evil).is_err(), "{evil}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn preview_refuses_a_symlink_pointing_out_of_the_workspace() {
        let (d, w) = workspace();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.png"), PNG).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.png"), d.path().join("link.png"))
            .unwrap();

        assert!(matches!(w.preview("link.png"), Err(FileError::Outside(_))));
    }

    #[test]
    fn a_missing_file_says_so() {
        let (_d, w) = workspace();
        assert!(w.preview("nowhere.png").is_err());
    }
}
