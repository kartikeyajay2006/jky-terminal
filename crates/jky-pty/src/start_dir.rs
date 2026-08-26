use std::path::{Path, PathBuf};

/// Where a new terminal should start.
///
/// A terminal that opens wherever the application binary happened to be
/// launched from is unpredictable: during development that is the project
/// folder, and from an installed shortcut it can be `/` or `C:\Windows\System32`.
/// Every established terminal opens in the user's home directory, so that is
/// the default here too.
///
/// Resolution order:
/// 1. an explicitly configured directory, if it exists
/// 2. the user's home directory
/// 3. the temp directory, which is the one path guaranteed to be writable
///
/// The environment is taken as arguments rather than read here, so the whole
/// order can be tested on any platform.
pub fn resolve_start_dir(configured: Option<&str>, home: Option<PathBuf>) -> PathBuf {
    if let Some(raw) = configured {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let expanded = expand_tilde(trimmed, home.as_deref());
            // A configured directory that no longer exists must not be used:
            // spawning into a missing directory fails, and a terminal that
            // refuses to open is worse than one in the wrong place.
            if expanded.is_dir() {
                return expanded;
            }
        }
    }

    match home {
        Some(dir) if dir.is_dir() => dir,
        _ => std::env::temp_dir(),
    }
}

/// Expand a leading `~` against the home directory.
///
/// People type `~/projects` into a settings field because that is what they
/// type into a shell. A shell expands it before the path ever reaches a
/// syscall; nothing does that for us, so a literal `~` directory would be
/// looked for and never found.
pub fn expand_tilde(input: &str, home: Option<&Path>) -> PathBuf {
    let Some(home) = home else {
        return PathBuf::from(input);
    };
    if input == "~" {
        return home.to_path_buf();
    }
    // Accept both separators: a Windows user may well type ~/foo.
    if let Some(rest) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) {
        return home.join(rest);
    }
    PathBuf::from(input)
}

/// The user's home directory, or None if the platform cannot say.
pub fn home_dir() -> Option<PathBuf> {
    #[allow(deprecated)]
    std::env::home_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn a_configured_directory_that_exists_is_used() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        assert_eq!(resolve_start_dir(Some(&path), None), dir.path());
    }

    #[test]
    fn a_configured_directory_that_is_gone_falls_back_to_home() {
        // Directories get deleted and drives get unmounted. A terminal that
        // refuses to open is worse than one that opens somewhere sensible.
        let home = TempDir::new().unwrap();
        let resolved = resolve_start_dir(
            Some("/definitely/not/a/real/directory"),
            Some(home.path().to_path_buf()),
        );
        assert_eq!(resolved, home.path());
    }

    #[test]
    fn an_empty_configured_value_is_treated_as_unset() {
        let home = TempDir::new().unwrap();
        for blank in ["", "   "] {
            assert_eq!(
                resolve_start_dir(Some(blank), Some(home.path().to_path_buf())),
                home.path()
            );
        }
    }

    #[test]
    fn nothing_configured_lands_in_the_home_directory() {
        let home = TempDir::new().unwrap();
        assert_eq!(
            resolve_start_dir(None, Some(home.path().to_path_buf())),
            home.path()
        );
    }

    #[test]
    fn a_home_that_does_not_exist_falls_back_to_temp() {
        let resolved = resolve_start_dir(None, Some(PathBuf::from("/no/such/home")));
        assert_eq!(resolved, std::env::temp_dir());
    }

    #[test]
    fn no_home_at_all_falls_back_to_temp() {
        assert_eq!(resolve_start_dir(None, None), std::env::temp_dir());
    }

    #[test]
    fn a_tilde_path_is_expanded_against_home() {
        let home = TempDir::new().unwrap();
        let projects = home.path().join("projects");
        fs::create_dir(&projects).unwrap();

        let resolved = resolve_start_dir(Some("~/projects"), Some(home.path().to_path_buf()));
        assert_eq!(resolved, projects);
    }

    #[test]
    fn a_bare_tilde_means_the_home_directory() {
        let home = TempDir::new().unwrap();
        assert_eq!(
            expand_tilde("~", Some(home.path())),
            home.path().to_path_buf()
        );
    }

    #[test]
    fn a_backslash_tilde_path_is_expanded_too() {
        // A Windows user typing ~\projects means the same thing.
        let home = TempDir::new().unwrap();
        assert_eq!(
            expand_tilde("~\\projects", Some(home.path())),
            home.path().join("projects")
        );
    }

    #[test]
    fn a_tilde_inside_a_path_is_left_alone() {
        // Only a leading ~ is a home reference. "foo~bar" is a real filename.
        assert_eq!(
            expand_tilde("/tmp/foo~bar", Some(Path::new("/home/x"))),
            PathBuf::from("/tmp/foo~bar")
        );
    }

    #[test]
    fn expanding_without_a_home_leaves_the_path_untouched() {
        assert_eq!(expand_tilde("~/projects", None), PathBuf::from("~/projects"));
    }

    #[test]
    fn the_resolved_directory_always_exists() {
        // Whatever the inputs, spawn must never be handed a missing directory.
        for configured in [None, Some(""), Some("/nope")] {
            assert!(resolve_start_dir(configured, None).is_dir());
        }
    }
}
