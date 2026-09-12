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
        // Tail expression, not `return`: clippy's needless_return fires here,
        // and this branch only compiles on Windows so the lint is invisible
        // on any other machine.
        ShellSpec {
            program: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
        }
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

/// What to call a shell, given the program that runs it.
///
/// The status bar used to guess this from the browser's user agent — Windows
/// meant PowerShell, Mac meant zsh, anything else meant bash. That is a guess
/// about the operating system dressed up as a fact about the shell, and it
/// was wrong for everyone on Linux running zsh, everyone on a Mac running
/// bash, and everyone anywhere running fish. The shell is already resolved
/// here; naming it is the only part that was missing.
///
/// The file extension goes because `powershell.exe` is called PowerShell by
/// the people using it, and a version suffix stays because `python3.11` and
/// `bash-5.2` are the names those programs go by.
pub fn shell_name(program: &str) -> String {
    let file = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .trim();

    let bare = file.strip_suffix(".exe").unwrap_or(file);
    let bare = bare.strip_suffix(".EXE").unwrap_or(bare);

    if bare.is_empty() {
        // Better to say nothing than to name a shell that is not running.
        return String::new();
    }
    bare.to_lowercase()
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
mod name_tests {
    use super::shell_name;

    #[test]
    fn a_shell_is_named_by_the_end_of_its_path() {
        assert_eq!(shell_name("/usr/bin/zsh"), "zsh");
        assert_eq!(shell_name("/bin/bash"), "bash");
        assert_eq!(shell_name("/usr/local/bin/fish"), "fish");
        assert_eq!(shell_name("nu"), "nu");
    }

    #[test]
    fn a_windows_shell_is_named_the_way_people_say_it() {
        // Backslashes, and an extension nobody says out loud.
        assert_eq!(shell_name(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"), "powershell");
        assert_eq!(shell_name(r"C:\Windows\system32\cmd.exe"), "cmd");
        assert_eq!(shell_name("PWSH.EXE"), "pwsh");
    }

    #[test]
    fn a_version_in_the_name_is_part_of_the_name() {
        // `bash-5.2` and `python3.11` are what those programs are called.
        // Stripping to the last dot would name them `bash-5` and `python3`.
        assert_eq!(shell_name("/opt/bin/bash-5.2"), "bash-5.2");
    }

    #[test]
    fn nothing_is_named_nothing_rather_than_guessed_at() {
        assert_eq!(shell_name(""), "");
        assert_eq!(shell_name("   "), "");
        assert_eq!(shell_name("/"), "");
    }
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
