use std::path::{Path, PathBuf};

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

/// Resolve a tool-supplied path, refusing anything outside `root`.
///
/// Every tool goes through this. Tool arguments are untrusted: they are
/// influenced by whatever the model has already read, which can include text
/// written by someone else — a README, a dependency, a branch name.
///
/// Canonicalisation is what makes it safe rather than merely careful. String
/// inspection would pass a symlink that points outside the project, because
/// the string looks contained; only resolving the link reveals where it goes.
pub fn resolve_within(root: &Path, requested: &str) -> Result<PathBuf, SandboxError> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err(SandboxError::NotUtf8(requested.to_string()));
    }
    // A NUL byte truncates the path at the syscall boundary on some platforms,
    // so "a\0b" can open "a". Refuse rather than reason about it.
    if trimmed.contains('\0') {
        return Err(SandboxError::NotUtf8("<path containing a null byte>".into()));
    }

    let candidate = Path::new(trimmed);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };

    // Both sides must be canonical before comparison: a root reached through a
    // symlink would otherwise never prefix-match its own children.
    let real_root = root
        .canonicalize()
        .map_err(|_| SandboxError::Missing("the project directory".into()))?;
    let real_path = joined
        .canonicalize()
        .map_err(|_| SandboxError::Missing(trimmed.to_string()))?;

    if !real_path.starts_with(&real_root) {
        return Err(SandboxError::Escape(trimmed.to_string()));
    }

    Ok(real_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

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
        let path = resolve_within(dir.path(), "src/main.rs").unwrap();
        assert!(path.ends_with("src/main.rs"));
    }

    #[test]
    fn the_project_root_itself_resolves() {
        let dir = project();
        assert!(resolve_within(dir.path(), ".").is_ok());
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
                matches!(resolve_within(dir.path(), attempt), Err(SandboxError::Escape(_)))
                    || matches!(resolve_within(dir.path(), attempt), Err(SandboxError::Missing(_))),
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
                matches!(resolve_within(dir.path(), &attempt), Err(SandboxError::Escape(_))),
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
            resolve_within(dir.path(), &secret.to_string_lossy()),
            Err(SandboxError::Escape(_))
        ));
    }

    #[test]
    fn an_absolute_path_inside_the_project_is_allowed() {
        // Legitimate: a model that has seen an absolute path in output may
        // reasonably hand it back.
        let dir = project();
        let inside = dir.path().join("README.md");
        assert!(resolve_within(dir.path(), &inside.to_string_lossy()).is_ok());
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
            resolve_within(dir.path(), "link"),
            Err(SandboxError::Escape(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlink_pointing_inside_the_project_is_allowed() {
        let dir = project();
        std::os::unix::fs::symlink(dir.path().join("README.md"), dir.path().join("readme-link"))
            .unwrap();
        assert!(resolve_within(dir.path(), "readme-link").is_ok());
    }

    #[test]
    fn a_missing_file_is_reported_as_missing_not_as_an_escape() {
        // The two are different: one is a mistake, the other is an attack.
        // Reporting both the same way hides the signal that matters.
        let dir = project();
        assert!(matches!(
            resolve_within(dir.path(), "src/nope.rs"),
            Err(SandboxError::Missing(_))
        ));
    }

    #[test]
    fn an_empty_path_is_refused() {
        let dir = project();
        assert!(resolve_within(dir.path(), "").is_err());
        assert!(resolve_within(dir.path(), "   ").is_err());
    }

    #[test]
    fn the_error_never_leaks_the_resolved_absolute_path() {
        // Errors are shown to the model. Telling it where the project sits on
        // disk hands it the information it needs to aim the next attempt.
        let dir = project();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret"), "s").unwrap();
        let err = resolve_within(dir.path(), &outside.path().join("secret").to_string_lossy())
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
        assert!(resolve_within(dir.path(), "src/main.rs\0.txt").is_err());
    }
}
