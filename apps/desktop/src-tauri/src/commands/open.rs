//! Handing a link to the operating system.
//!
//! A URL in terminal output should be clickable, and the webview must not be
//! the thing that opens it: `connect-src 'self'` exists precisely so a
//! compromised frontend has nowhere to send anything, and `window.open` would
//! be a hole straight through it. So the renderer asks, Rust checks, and the
//! OS opens it in the user's real browser — outside the app entirely.
//!
//! What this command will accept is deliberately narrow. It is the only place
//! in the app where a string from the window becomes an argument to a process,
//! so the validation below is the whole security boundary.

/// Why a URL was refused, or `None` when it is safe to open.
///
/// Split out from the command so the rule itself is directly testable without
/// launching anything.
pub fn why_not_openable(url: &str) -> Option<&'static str> {
    // A length bound before anything else: the rest of these checks are cheap
    // but there is no reason to run them over a megabyte of text.
    if url.len() > 2048 {
        return Some("that link is too long to open");
    }

    let lowered = url.to_ascii_lowercase();
    if !lowered.starts_with("http://") && !lowered.starts_with("https://") {
        // Everything else is a way to reach something that is not a web page:
        // `file://` opens local files, `javascript:` would run in whatever
        // opens it, and the various application schemes launch other programs.
        return Some("only http and https links can be opened");
    }

    // Control characters, spaces and quotes are the shapes that let a string
    // stop being one argument. Command::arg does not go through a shell, so
    // this is belt and braces on every platform except Windows — where the
    // console host does its own parsing and this check is load-bearing.
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Some("that link contains characters that cannot be opened");
    }
    if url.contains('"') || url.contains('\'') || url.contains('`') {
        return Some("that link contains quotes and will not be opened");
    }

    // A bare scheme with no host opens nothing and is more likely a mistake
    // or an attempt at something than a real link.
    let rest = &url[url.find("//").map(|i| i + 2).unwrap_or(0)..];
    if rest.is_empty() || rest.starts_with('/') {
        return Some("that link has no address");
    }

    None
}

/// Open a link in the user's browser.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if let Some(why) = why_not_openable(&url) {
        return Err(why.to_string());
    }
    launch(&url).map_err(|e| format!("could not open that link: {e}"))
}

/// The per-platform incantation. Arguments are passed as arguments, never
/// interpolated into a command line.
fn launch(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        // The empty string is `start`'s title argument. Without it, a URL in
        // quotes is taken as the window title and nothing opens.
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", url]);
        c
    };

    // Spawned and forgotten. Waiting would block the IPC call for as long as
    // the browser takes to start, which on a cold start is seconds.
    command.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_web_links_are_allowed() {
        for url in [
            "https://example.com",
            "http://example.com",
            "https://example.com/path?query=1&other=2#fragment",
            "HTTPS://EXAMPLE.COM",
            "https://sub.domain.example.co.uk:8443/x",
        ] {
            assert_eq!(why_not_openable(url), None, "refused {url}");
        }
    }

    #[test]
    fn only_http_and_https_are_allowed() {
        // Everything here reaches something that is not a web page.
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vscode://file/etc/passwd",
            "smb://host/share",
            "ftp://example.com",
            "//example.com",
            "example.com",
        ] {
            assert!(why_not_openable(url).is_some(), "allowed {url}");
        }
    }

    #[test]
    fn a_scheme_hidden_behind_whitespace_is_refused() {
        // " javascript:..." would pass a naive starts_with check on a trimmed
        // copy while still being handed over whole.
        assert!(why_not_openable(" https://example.com").is_some());
        assert!(why_not_openable("https://exa mple.com").is_some());
        assert!(why_not_openable("https://example.com\n").is_some());
        assert!(why_not_openable("https://example.com\u{0}").is_some());
    }

    #[test]
    fn quotes_are_refused_because_windows_parses_its_own_command_line() {
        // Command::arg does not go through a shell, but the Windows console
        // host re-parses, so this is load-bearing there.
        assert!(why_not_openable("https://example.com/\"").is_some());
        assert!(why_not_openable("https://example.com/'").is_some());
        assert!(why_not_openable("https://example.com/`").is_some());
    }

    #[test]
    fn a_link_with_no_address_is_refused() {
        assert!(why_not_openable("https://").is_some());
        assert!(why_not_openable("http:///path").is_some());
    }

    #[test]
    fn an_absurdly_long_link_is_refused_before_anything_else() {
        let long = format!("https://example.com/{}", "a".repeat(4000));
        assert!(why_not_openable(&long).is_some());
    }

    #[test]
    fn the_refusal_never_echoes_the_link_back() {
        // The message is shown in the window; repeating a hostile URL into it
        // would be a small injection surface for nothing gained.
        let why = why_not_openable("javascript:alert(1)").unwrap();
        assert!(!why.contains("javascript"), "{why}");
    }
}
