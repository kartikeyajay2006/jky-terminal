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
    /// The bytes, base64, for images small enough to be worth sending.
    ///
    /// Only images. A PDF would need `frame-src` widened to accept `data:`,
    /// and the webview this ships against on Linux does not render PDFs
    /// inline anyway — so that would be a hole in the one rule bought for a
    /// feature that would not work. A PDF is named and measured instead, and
    /// says plainly that it cannot be shown here.
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

        // A path that does not exist yet has no canonical form, so the check
        // falls to the deepest part of it that does. Walking up rather than
        // taking the immediate parent is what lets `a/b/c.txt` be created
        // when neither `a` nor `b` is there — and it gives nothing away,
        // because every component was already refused above unless it was an
        // ordinary name.
        let mut anchor = joined.clone();
        while !anchor.exists() {
            anchor = anchor.parent().map(Path::to_path_buf).ok_or_else(refused)?;
        }
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

impl Workspace {
    /// Make a new, empty file.
    ///
    /// Refuses one that is already there rather than truncating it. "New
    /// file" and "erase this file" are different requests, and a name typed
    /// by accident into the first must never perform the second.
    pub fn create_file(&self, relative: &str) -> Result<(), FileError> {
        let path = self.checked(relative)?;
        if path.exists() {
            return Err(FileError::Exists(relative.to_string()));
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| FileError::Write {
                path: relative.to_string(),
                reason: e.to_string(),
            })?;
        }
        std::fs::write(&path, "").map_err(|e| FileError::Write {
            path: relative.to_string(),
            reason: e.to_string(),
        })
    }

    /// Make a new directory, and any directory above it that is missing.
    pub fn create_dir(&self, relative: &str) -> Result<(), FileError> {
        let path = self.checked(relative)?;
        if path.exists() {
            return Err(FileError::Exists(relative.to_string()));
        }
        std::fs::create_dir_all(&path).map_err(|e| FileError::Write {
            path: relative.to_string(),
            reason: e.to_string(),
        })
    }

    /// Move or rename, inside this workspace.
    ///
    /// Both ends are resolved and both must land inside, so a rename cannot
    /// be a way out of the tree — which is the obvious thing to try once
    /// reading and writing are both fenced.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), FileError> {
        let source = self.checked_entry(from)?;
        let target = self.checked(to)?;

        if !source.exists() {
            return Err(FileError::Read {
                path: from.to_string(),
                reason: "it is not there".to_string(),
            });
        }
        // Refused rather than overwriting. A rename that silently replaced
        // another file would destroy it with no way back.
        if target.exists() && target != source {
            return Err(FileError::Exists(to.to_string()));
        }

        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| FileError::Write {
                path: to.to_string(),
                reason: e.to_string(),
            })?;
        }
        std::fs::rename(&source, &target).map_err(|e| FileError::Write {
            path: to.to_string(),
            reason: e.to_string(),
        })
    }

    /// Delete one file, or one directory that has nothing in it.
    ///
    /// A directory with contents is refused. There is no undo here and no
    /// wastebasket to fish something out of, so an editor that removed a tree
    /// on one click would be one misclick from taking somebody's project —
    /// and the shell is right there for anyone who really means it.
    pub fn delete(&self, relative: &str) -> Result<(), FileError> {
        let path = self.checked_entry(relative)?;

        let meta = std::fs::symlink_metadata(&path).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;

        // A symlink is removed as the link it is, never followed — following
        // one would delete a file outside the workspace through a name inside
        // it.
        if meta.file_type().is_symlink() || meta.is_file() {
            return std::fs::remove_file(&path).map_err(|e| FileError::Write {
                path: relative.to_string(),
                reason: e.to_string(),
            });
        }

        let empty = std::fs::read_dir(&path)
            .map_err(|e| FileError::Read { path: relative.to_string(), reason: e.to_string() })?
            .next()
            .is_none();
        if !empty {
            return Err(FileError::NotEmpty(relative.to_string()));
        }

        std::fs::remove_dir(&path).map_err(|e| FileError::Write {
            path: relative.to_string(),
            reason: e.to_string(),
        })
    }

    /// What a file is, for something that cannot be edited.
    ///
    /// Reads the same bytes `read` does and is fenced by the same two checks;
    /// it differs only in what it does with a file that is not UTF-8. Nothing
    /// here can write.
    pub fn preview(&self, relative: &str) -> Result<Preview, FileError> {
        let path = self.resolve(relative)?;
        let meta = std::fs::metadata(&path).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;

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

        let size = meta.len();
        if kind != PreviewKind::Image {
            let note = match kind {
                PreviewKind::Pdf => "PDFs cannot be shown in this window yet",
                _ => "there is no useful way to show this",
            };
            return Ok(Preview { kind, mime: mime.into(), size, data: None, note: Some(note.into()) });
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

        let bytes = std::fs::read(&path).map_err(|e| FileError::Read {
            path: relative.to_string(),
            reason: e.to_string(),
        })?;

        Ok(Preview {
            kind,
            mime: mime.into(),
            size,
            data: Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)),
            note: None,
        })
    }

    /// Resolve a path that must also carry a name.
    ///
    /// `resolve` accepts the workspace root itself, which is right for
    /// listing and wrong for every call here: creating, renaming or deleting
    /// "" would mean doing it to the whole folder.
    fn checked(&self, relative: &str) -> Result<PathBuf, FileError> {
        Self::named(relative)?;
        self.resolve(relative)
    }

    /// Resolve a path whose last part must not be followed.
    ///
    /// Deleting or renaming a symlink acts on the link, never on what it
    /// points at — otherwise removing a link inside the workspace would
    /// remove a file outside it. So the directory holding the entry is
    /// resolved and checked in full, and only then is the bare name put back
    /// on. A link pointing out of the tree can be taken off your project;
    /// nothing at the other end of it is touched.
    fn checked_entry(&self, relative: &str) -> Result<PathBuf, FileError> {
        let name = Self::named(relative)?;
        let parent = match relative.trim_end_matches('/').rfind('/') {
            Some(at) => self.resolve(&relative[..at])?,
            None => self.root.clone(),
        };

        let real = parent.canonicalize().map_err(|_| FileError::Outside(relative.to_string()))?;
        if !real.starts_with(&self.root) {
            return Err(FileError::Outside(relative.to_string()));
        }
        Ok(real.join(name))
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
    fn a_pdf_is_named_and_measured_rather_than_drawn() {
        // Drawing one would need frame-src widened to accept data:, and the
        // webview this ships against on Linux does not render PDFs inline —
        // a hole in the one rule bought for something that would not work.
        let (_d, w) = workspace();
        let preview = w.preview("scan.pdf").unwrap();

        assert_eq!(preview.kind, PreviewKind::Pdf);
        assert_eq!(preview.data, None);
        assert!(preview.note.is_some());
        assert!(preview.size > 0);
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
