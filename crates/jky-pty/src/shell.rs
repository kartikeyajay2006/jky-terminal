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
    #[cfg(windows)]
    {
        // PowerShell, and neither variable gets a say.
        //
        // This used to prefer COMSPEC and fall back to PowerShell, under a
        // comment saying it did the opposite — and COMSPEC names cmd.exe on
        // every Windows install that has ever booted, so the fallback was the
        // only branch that ever ran. Every Windows user got cmd.exe.
        //
        // Wrong twice over. Windows Terminal, VS Code and every modern
        // terminal open PowerShell, so it is what people expect. And cmd.exe
        // cannot be hooked at all: it has no prompt hook worth the name, so
        // under it the timeline, the live panels, the exit codes and the
        // recognisers are all silently dead.
        //
        // So COMSPEC is deliberately not consulted, rather than kept as a
        // fallback that would always win. `$SHELL` is a POSIX idea and is not
        // set here either. PowerShell has shipped with Windows since 7, which
        // is older than anything this app supports.
        let _ = (shell_var, comspec_var);
        ShellSpec {
            program: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
        }
    }

    #[cfg(not(windows))]
    {
        let _ = comspec_var;
        // Declared here rather than above the branches: the Windows arm reads
        // no variables at all any more, so a closure defined for both would
        // be unused there — which is an error under `-D warnings`, on the one
        // platform this machine cannot compile for.
        let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
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

    // The separator has to be handled by hand: `Path::file_name` splits on
    // `\` only when it is compiled for Windows, so a test asserting the
    // Windows answer from a Linux runner — which is this repository's whole
    // approach to cross-platform code — would get the entire string back.
    #[test]
    fn a_windows_path_is_read_as_a_windows_path_on_any_machine() {
        assert_eq!(shell_name(r"C:\Windows\System32\cmd.exe"), "cmd");
        assert_eq!(shell_name(r"C:\Program Files\PowerShell\7\pwsh.exe"), "pwsh");
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

    /*
     * PowerShell, even with COMSPEC set — which it always is.
     *
     * The old order asked for COMSPEC first, so every Windows user got
     * cmd.exe: a shell with no prompt hook, under which the timeline, the
     * live panels, the exit codes and the recognisers are all silently dead.
     */
    #[test]
    #[cfg(windows)]
    fn windows_opens_powershell_even_though_comspec_is_always_set() {
        let spec = resolve_shell(None, Some(r"C:\Windows\system32\cmd.exe".to_string()));
        assert!(
            spec.program.to_lowercase().contains("powershell"),
            "COMSPEC won again: {}",
            spec.program
        );
    }

    // Distinct from the test above: that one says COMSPEC cannot win, this
    // one says an empty environment is still enough to find a shell at all.
    #[test]
    #[cfg(windows)]
    fn windows_needs_no_environment_to_find_a_shell() {
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
