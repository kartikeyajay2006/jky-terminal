use std::path::{Component, Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, File, Metadata, ReadDir};

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// The path resolved outside the project. Deliberately vague — this text
    /// is shown to the model, and naming the root would help it aim.
    #[error("'{0}' is outside the project")]
    Escape(String),
    #[error("'{0}' does not exist")]
    Missing(String),
    #[error("'{0}' is not a usable path")]
    NotUtf8(String),
}

/// The project the assistant's tools may read, held open.
///
/// Every tool goes through this. Tool arguments are untrusted: they are
/// influenced by whatever the model has already read, which can include text
/// written by someone else — a README, a dependency, a branch name.
///
/// The folder is held as an open directory handle, and every path is resolved
/// **beneath it** by the same system call that opens it (`openat2` with
/// `RESOLVE_BENEATH` on Linux, an equivalent component-by-component walk
/// elsewhere, via `cap-std`). Resolving a path first and opening it by name
/// afterwards — what this used to do — leaves a gap in which another process
/// can swap a directory for a link pointing out of the project. There is no
/// such gap now: the check and the open are one operation.
///
/// One consequence: a symlink with an **absolute** target is refused even
/// when it points inside, because only a relative link can be followed
/// without a second, raceable lookup. Relative links that stay inside work.
pub struct Project {
    /// The folder as it was named, and as it really is. Both are kept because
    /// an absolute path from the model may use either spelling — `/var` and
    /// `/private/var` on macOS, a short and a long name on Windows.
    given: PathBuf,
    root: PathBuf,
    dir: Dir,
}

fn escaped(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied && e.to_string().contains("outside of the filesystem")
}

impl Project {
    pub fn open(root: &Path) -> Result<Self, SandboxError> {
        let missing = |_| SandboxError::Missing("the project directory".into());
        let real = root.canonicalize().map_err(missing)?;
        let dir = Dir::open_ambient_dir(&real, ambient_authority()).map_err(missing)?;
        Ok(Self { given: root.to_path_buf(), root: real, dir })
    }

    /// Turn a requested path into one relative to the project, by its
    /// spelling alone. Nothing here touches the disk; containment is decided
    /// by the handle at the moment of use.
    pub fn relative(&self, requested: &str) -> Result<PathBuf, SandboxError> {
        let trimmed = requested.trim();
        if trimmed.is_empty() {
            return Err(SandboxError::NotUtf8(requested.to_string()));
        }
        // A NUL byte truncates the path at the syscall boundary on some
        // platforms, so "a\0b" can open "a". Refuse rather than reason about it.
        if trimmed.contains('\0') {
            return Err(SandboxError::NotUtf8("<path containing a null byte>".into()));
        }
        let candidate = Path::new(trimmed);
        if candidate.has_root() || candidate.components().any(|c| matches!(c, Component::Prefix(_))) {
            // Legitimate when it names something inside: a model that has
            // seen an absolute path in output may reasonably hand it back.
            //
            // Resolving it here only decides which relative name to use. The
            // open that follows still happens beneath the handle, so a path
            // that changes underneath us is refused at that moment instead.
            let inside = |p: &Path| -> Option<PathBuf> {
                let rest = p.strip_prefix(&self.root).or_else(|_| p.strip_prefix(&self.given)).ok()?;
                Some(if rest.as_os_str().is_empty() { PathBuf::from(".") } else { rest.to_path_buf() })
            };
            let resolved = candidate.canonicalize().ok().or_else(|| {
                // Not there yet: resolve the folder holding it.
                let parent = candidate.parent()?.canonicalize().ok()?;
                Some(parent.join(candidate.file_name()?))
            });
            return inside(candidate)
                .or_else(|| resolved.as_deref().and_then(inside))
                .ok_or_else(|| SandboxError::Escape(trimmed.to_string()));
        }
        Ok(candidate.to_path_buf())
    }

    fn fail(requested: &str) -> impl Fn(std::io::Error) -> SandboxError + '_ {
        move |e| {
            let shown = requested.trim().to_string();
            if escaped(&e) { SandboxError::Escape(shown) } else { SandboxError::Missing(shown) }
        }
    }

    /// What is at a path — following links, inside the project only.
    pub fn metadata(&self, requested: &str) -> Result<Metadata, SandboxError> {
        let rel = self.relative(requested)?;
        self.dir.metadata(&rel).map_err(Self::fail(requested))
    }

    pub fn open_file(&self, requested: &str) -> Result<File, SandboxError> {
        let rel = self.relative(requested)?;
        self.dir.open(&rel).map_err(Self::fail(requested))
    }

    pub fn read_dir(&self, requested: &str) -> Result<ReadDir, SandboxError> {
        let rel = self.relative(requested)?;
        self.dir.read_dir(&rel).map_err(Self::fail(requested))
    }

    /// The handle itself, for a walk that keeps every step beneath it.
    pub fn dir(&self) -> &Dir {
        &self.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// The old `resolve_within` contract, on the new type: does this path
    /// name something inside the project?
    fn check(root: &Path, requested: &str) -> Result<PathBuf, SandboxError> {
        let project = Project::open(root)?;
        let rel = project.relative(requested)?;
        project.metadata(requested)?;
        Ok(rel)
    }

    fn project() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join("README.md"), "# hi").unwrap();
        dir
    }

    #[test]
    fn a_relative_path_inside_the_project_resolves() {
        let dir = project();
        let path = check(dir.path(), "src/main.rs").unwrap();
        assert_eq!(path, Path::new("src/main.rs"));
    }

    #[test]
    fn the_project_root_itself_resolves() {
        let dir = project();
        assert!(check(dir.path(), ".").is_ok());
    }

    #[test]
    fn a_parent_traversal_is_refused() {
        // The whole point. Tool arguments are influenced by file contents the
        // model has read, which may include text written by someone else.
        let dir = project();
        for attempt in [
            "../etc/passwd",
            "src/../../etc/passwd",
            "./../../etc/passwd",
            "src/./../../../etc/passwd",
        ] {
            assert!(
                matches!(check(dir.path(), attempt), Err(SandboxError::Escape(_)))
                    || matches!(check(dir.path(), attempt), Err(SandboxError::Missing(_))),
                "traversal not refused: {attempt}"
            );
        }
    }

    #[test]
    fn an_absolute_path_outside_the_project_is_refused() {
        // A real directory that exists on every platform, rather than
        // /etc/passwd: on Windows that path does not exist, canonicalize
        // fails first, and the test would pass for the wrong reason while
        // proving nothing about containment.
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s3cret").unwrap();

        for attempt in [
            outside.path().join("secret").to_string_lossy().to_string(),
            outside.path().to_string_lossy().to_string(),
        ] {
            assert!(
                matches!(check(dir.path(), &attempt), Err(SandboxError::Escape(_))),
                "absolute path not refused: {attempt}"
            );
        }
    }

    #[test]
    fn a_readable_file_outside_the_project_is_still_refused() {
        // The property that matters: not "the path is odd" but "this file is
        // readable and must not be reachable through a tool".
        let dir = project();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("id_rsa");
        fs::write(&secret, "PRIVATE KEY").unwrap();
        assert!(secret.is_file(), "the fixture must actually exist");

        assert!(matches!(
            check(dir.path(), &secret.to_string_lossy()),
            Err(SandboxError::Escape(_))
        ));
    }

    #[test]
    fn an_absolute_path_inside_the_project_is_allowed() {
        // Legitimate: a model that has seen an absolute path in output may
        // reasonably hand it back.
        let dir = project();
        let inside = dir.path().join("README.md");
        assert!(check(dir.path(), &inside.to_string_lossy()).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_pointing_outside_the_project_is_refused() {
        // A path that looks contained and is not. Checking the string alone
        // would pass this; only resolving the link catches it.
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s3cret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), dir.path().join("link")).unwrap();

        assert!(matches!(
            check(dir.path(), "link"),
            Err(SandboxError::Escape(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn a_relative_symlink_pointing_inside_the_project_is_allowed() {
        let dir = project();
        std::os::unix::fs::symlink("README.md", dir.path().join("readme-link")).unwrap();
        assert!(check(dir.path(), "readme-link").is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn an_absolute_symlink_is_refused_even_when_it_points_inside() {
        // Only a relative link can be followed beneath the handle without a
        // second lookup that could be raced.
        let dir = project();
        std::os::unix::fs::symlink(dir.path().join("README.md"), dir.path().join("readme-link"))
            .unwrap();
        assert!(matches!(check(dir.path(), "readme-link"), Err(SandboxError::Escape(_))));
    }

    #[test]
    #[cfg(unix)]
    fn an_absolute_path_through_an_alias_of_the_project_is_allowed() {
        // macOS keeps temporary folders under /var, a link to /private/var:
        // the project is named one way and resolves another. An absolute
        // path in either spelling names the same file.
        let real = project();
        let holder = TempDir::new().unwrap();
        let alias = holder.path().join("alias");
        std::os::unix::fs::symlink(real.path(), &alias).unwrap();

        let through_alias = alias.join("README.md");
        assert!(check(&alias, &through_alias.to_string_lossy()).is_ok());
        let through_real = real.path().canonicalize().unwrap().join("README.md");
        assert!(check(&alias, &through_real.to_string_lossy()).is_ok());
    }

    #[test]
    fn a_missing_file_is_reported_as_missing_not_as_an_escape() {
        // The two are different: one is a mistake, the other is an attack.
        // Reporting both the same way hides the signal that matters.
        let dir = project();
        assert!(matches!(
            check(dir.path(), "src/nope.rs"),
            Err(SandboxError::Missing(_))
        ));
    }

    #[test]
    fn an_empty_path_is_refused() {
        let dir = project();
        assert!(check(dir.path(), "").is_err());
        assert!(check(dir.path(), "   ").is_err());
    }

    #[test]
    fn the_error_never_leaks_the_resolved_absolute_path() {
        // Errors are shown to the model. Telling it where the project sits on
        // disk hands it the information it needs to aim the next attempt.
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s").unwrap();
        let err = check(dir.path(), &outside.path().join("secret").to_string_lossy())
            .unwrap_err();
        let text = err.to_string();
        assert!(
            !text.contains(&dir.path().to_string_lossy().to_string()),
            "error leaked the project root: {text}"
        );
    }

    #[test]
    fn a_path_with_a_null_byte_is_refused() {
        let dir = project();
        assert!(check(dir.path(), "src/main.rs\0.txt").is_err());
    }
}
