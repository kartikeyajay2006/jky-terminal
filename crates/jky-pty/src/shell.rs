use std::collections::HashMap;

/// The program a PTY should launch, and its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
}

/// Resolve the shell from the environment, with a per-platform fallback.
///
/// Taking the environment values as arguments rather than reading them here
/// is what makes this testable: a test can assert the Windows fallback while
/// running on Linux.
pub fn resolve_shell(shell_var: Option<String>, comspec_var: Option<String>) -> ShellSpec {
    let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());

    #[cfg(windows)]
    {
        let _ = shell_var;
        // PowerShell is the modern default; COMSPEC (usually cmd.exe) is the
        // guaranteed fallback because every Windows install has it.
        if let Some(comspec) = non_empty(comspec_var) {
            return ShellSpec { program: comspec, args: vec![] };
        }
        return ShellSpec {
            program: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
        };
    }

    #[cfg(not(windows))]
    {
        let _ = comspec_var;
        if let Some(shell) = non_empty(shell_var) {
            return ShellSpec { program: shell, args: vec![] };
        }
        // POSIX guarantees /bin/sh exists. $SHELL is not guaranteed to be
        // exported — cron jobs and slim container images often omit it.
        ShellSpec { program: "/bin/sh".to_string(), args: vec![] }
    }
}

pub fn default_shell() -> ShellSpec {
    resolve_shell(std::env::var("SHELL").ok(), std::env::var("COMSPEC").ok())
}

/// Environment additions every JKY Terminal PTY receives.
pub fn pty_env() -> HashMap<String, String> {
    HashMap::from([
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "jky-terminal".to_string()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_shell_is_never_empty() {
        let spec = default_shell();
        assert!(!spec.program.is_empty(), "no shell resolved for this platform");
    }

    #[test]
    #[cfg(windows)]
    fn windows_falls_back_to_a_real_windows_shell() {
        let spec = resolve_shell(None, None);
        let p = spec.program.to_lowercase();
        assert!(
            p.contains("powershell") || p.contains("cmd"),
            "unusable Windows shell: {}",
            spec.program
        );
    }

    #[test]
    #[cfg(unix)]
    fn unix_prefers_the_shell_environment_variable() {
        let spec = resolve_shell(Some("/usr/bin/fish".into()), None);
        assert_eq!(spec.program, "/usr/bin/fish");
    }

    #[test]
    #[cfg(unix)]
    fn unix_falls_back_to_sh_when_shell_is_unset() {
        // A login shell is not guaranteed to be exported — cron and some
        // container images do not set it. /bin/sh is the one shell POSIX
        // requires to exist.
        let spec = resolve_shell(None, None);
        assert_eq!(spec.program, "/bin/sh");
    }

    #[test]
    #[cfg(unix)]
    fn an_empty_shell_variable_is_treated_as_unset() {
        assert_eq!(resolve_shell(Some(String::new()), None).program, "/bin/sh");
    }

    #[test]
    fn the_environment_declares_a_colour_capable_terminal() {
        let env = pty_env();
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
    }

    #[test]
    fn the_environment_identifies_this_terminal() {
        // Shell prompts and tools branch on this. Setting it means a user can
        // detect JKY Terminal in their rc files.
        assert_eq!(
            pty_env().get("TERM_PROGRAM").map(String::as_str),
            Some("jky-terminal")
        );
    }
}
