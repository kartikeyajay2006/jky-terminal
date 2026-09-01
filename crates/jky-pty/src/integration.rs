//! Telling the app when a command failed.
//!
//! A terminal emulator sees bytes, not commands: it has no idea where one
//! ended, what it was, or whether it worked. The shell knows all three, so the
//! shell is asked — through its own prompt hook, which is the mechanism every
//! shell already provides for exactly this.
//!
//! What is emitted is one OSC sequence carrying the exit status and the
//! command that produced it, and only when the status is not zero. Nothing is
//! written after a command that worked: a terminal emitting an escape
//! sequence after every successful command would be paying for the one case
//! in fifty where something failed, and any multiplexer that did not
//! understand it would show the escape.
//!
//! It rides the OSC the app already listens on rather than claiming a second
//! one, beside `JKYAsk=` and `JKYCmd=`.
//!
//! Two shells are hooked, by two different mechanisms, because they offer two
//! different ones. Anything else is left alone rather than half-hooked — the
//! feature is absent there, which is a thing the panel can say.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use crate::ASK_OSC;

/// Marker introducing an exit report inside an OSC 1337 sequence.
pub const EXIT_PREFIX: &str = "JKYExit=";

/// Where the zsh startup files that hand control back live.
pub fn integration_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("shell")
}

/// The shell fragment that reports a failure, shared by both shells.
///
/// `command -v base64` is not caution for its own sake: a machine without it
/// is one where this feature does not work, and it must not also be one where
/// the prompt prints an error after every command.
///
/// The command text is base64 before it goes near an OSC sequence. A command
/// line is arbitrary text — quotes, semicolons, newlines, and the BEL that
/// terminates the sequence — so interpolating it raw would let anyone who
/// could get a command into your history write whatever they liked into the
/// stream this app parses.
fn report(command_expr: &str) -> String {
    format!(
        "if [ $__jky_status -ne 0 ] && command -v base64 >/dev/null 2>&1; then \
printf '\\033]{osc};{prefix}%s\\007' \
\"$(printf '%s\\n%s' \"$__jky_status\" \"{command_expr}\" | base64 | tr -d '\\n')\"; fi",
        osc = ASK_OSC,
        prefix = EXIT_PREFIX,
    )
}

/// The hook bash runs before drawing each prompt.
///
/// `history 1` is how bash is asked what just ran; `$_` holds the last
/// argument rather than the command, and a `DEBUG` trap would fire for every
/// line of every function.
pub fn bash_hook() -> String {
    format!(
        "__jky_status=$?; \
__jky_cmd=$(HISTTIMEFORMAT= history 1 2>/dev/null | sed 's/^ *[0-9]* *//'); \
{}",
        report("$__jky_cmd")
    )
}

/// What zsh runs *before* a command, to remember what it was.
///
/// zsh hands `preexec` the command line as `$1`, which is the whole reason to
/// use it. The obvious alternative, `$history[$HISTCMD]`, is empty unless the
/// shell happens to be keeping history — and a shell started with no
/// configuration is not. Measured against a real zsh through a real pty: the
/// report arrived with a correct exit code and a blank command until this
/// existed.
pub fn zsh_preexec() -> String {
    "__jky_cmd=$1".to_string()
}

/// What zsh runs before drawing each prompt.
pub fn zsh_hook() -> String {
    format!("__jky_status=$?; {}", report("$__jky_cmd"))
}

/// What `PROMPT_COMMAND` should be set to.
///
/// Whatever was already there is kept and runs after ours. Replacing it would
/// be the difference between adding a hook and taking someone's prompt away.
pub fn bash_prompt_command(existing: Option<&str>) -> String {
    match existing.map(str::trim).filter(|e| !e.is_empty()) {
        Some(theirs) => format!("{}; {theirs}", bash_hook()),
        None => bash_hook(),
    }
}

/// The four startup files zsh looks for, as `(name, contents)`.
///
/// All four, because pointing `ZDOTDIR` at our directory means zsh reads ours
/// *instead of* the user's — not as well as. A directory holding only
/// `.zshrc` silently unconfigures everyone who keeps anything in `.zshenv`,
/// which is where exported variables usually live.
///
/// The ordering here is the whole difficulty, and getting it wrong fails
/// quietly. zsh reads `.zshenv` first and then looks for every later file in
/// whatever `ZDOTDIR` says *at that moment* — so restoring it in `.zshenv`,
/// which is the obvious place, sends zsh to the user's directory for `.zshrc`
/// and ours is never read at all. The shell works, the user's setup loads,
/// and the hook is simply absent.
///
/// So each file sources the user's counterpart by path, leaving `ZDOTDIR`
/// pointing here, and only `.zshrc` puts it back — at the end, once there is
/// nothing left for zsh to find in this directory.
pub fn zsh_files(user_zdotdir: &Path) -> Vec<(String, String)> {
    let home = user_zdotdir.display();
    let head = |name: &str| {
        format!(
            "# JKY Terminal shell integration.\n\
             #\n\
             # Your own zsh setup is sourced below and is what actually\n\
             # configures this shell. This file exists to add one prompt hook.\n\
             # Deleting the directory it lives in costs the hook and nothing\n\
             # else.\n\
             __jky_home=\"${{JKY_USER_ZDOTDIR:-{home}}}\"\n\
             [ -f \"$__jky_home/.{name}\" ] && . \"$__jky_home/.{name}\"\n"
        )
    };

    let hook = format!(
        "\n# Report a failed command to JKY Terminal. Appended to the hook arrays\n# rather than replacing precmd and preexec, so anything your own setup\n# installed keeps running.\n#\n# preexec is given the command line as $1. Reading it back from $history\n# afterwards is empty in any shell not keeping history, which a shell\n# started with no configuration is not.\n__jky_preexec() {{ {preexec} }}\n__jky_precmd() {{ {hook} }}\ntypeset -ag preexec_functions precmd_functions\npreexec_functions+=(__jky_preexec)\nprecmd_functions+=(__jky_precmd)\n\n# Put ZDOTDIR back now that zsh has no more files to find here, so anything\n# started from this shell sees the value it expects.\nZDOTDIR=\"$__jky_home\"\n",
        preexec = zsh_preexec(),
        hook = zsh_hook()
    );

    vec![
        (".zshenv".to_string(), head("zshenv")),
        (".zprofile".to_string(), head("zprofile")),
        (".zshrc".to_string(), format!("{}{hook}", head("zshrc"))),
        (".zlogin".to_string(), head("zlogin")),
    ]
}

/// Write the zsh startup files. Bash needs none: its hook fits in an
/// environment variable.
pub fn install_shell_integration(config_dir: &Path, user_zdotdir: &Path) -> io::Result<()> {
    let dir = integration_dir(config_dir);
    std::fs::create_dir_all(&dir)?;
    for (name, body) in zsh_files(user_zdotdir) {
        std::fs::write(dir.join(name), body)?;
    }
    Ok(())
}

/// The environment that hooks a given shell, or nothing for one this does not
/// know how to hook.
///
/// Nothing, rather than a best guess: half-hooking a shell means an escape
/// sequence in the wrong place or a startup file that never runs, and the
/// honest outcome for fish or PowerShell is that the feature is absent.
pub fn integration_env(
    shell: &str,
    config_dir: &Path,
    user_zdotdir: Option<&Path>,
) -> HashMap<String, String> {
    let name = Path::new(shell)
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let name = name.trim_end_matches(".exe");

    let home = user_zdotdir
        .map(|p| p.display().to_string())
        .or_else(|| std::env::var("ZDOTDIR").ok())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default();

    match name {
        "bash" => HashMap::from([(
            "PROMPT_COMMAND".to_string(),
            bash_prompt_command(std::env::var("PROMPT_COMMAND").ok().as_deref()),
        )]),
        "zsh" => HashMap::from([
            (
                "ZDOTDIR".to_string(),
                integration_dir(config_dir).display().to_string(),
            ),
            ("JKY_USER_ZDOTDIR".to_string(), home),
        ]),
        _ => HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_report_is_carried_on_the_channel_the_app_already_listens_to() {
        assert!(bash_hook().contains(&format!("]{}", crate::ASK_OSC)));
        assert!(bash_hook().contains(EXIT_PREFIX));
    }

    /*
     * Nothing is sent when a command succeeds.
     *
     * Not an optimisation. A terminal that emitted a sequence after every
     * successful command would be writing into the stream constantly for the
     * benefit of the one case in fifty where something failed — and any shell
     * or multiplexer that did not understand it would show the escape.
     */
    #[test]
    fn a_command_that_worked_reports_nothing() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains("-eq 0") || hook.contains("== 0") || hook.contains("-ne 0"),
                    "no exit-code guard in: {hook}");
        }
    }

    // The exit status has to be read before anything else runs, or it is the
    // status of whatever the hook itself did.
    #[test]
    fn the_status_is_taken_before_the_hook_does_anything_else() {
        for hook in [bash_hook(), zsh_hook()] {
            let first = hook
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with('#'))
                .expect("a first statement");
            assert!(first.contains("$?"), "the status is not read first: {first}");
        }
    }

    /*
     * A command is arbitrary text: quotes, semicolons, newlines, and the BEL
     * that ends an OSC sequence. Interpolating it raw would let a command
     * line close the sequence and write whatever it liked into the stream the
     * app parses, so it is base64 before it goes anywhere near one.
     */
    #[test]
    fn the_command_is_encoded_rather_than_interpolated() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains("base64"), "not encoded: {hook}");
        }
    }

    // A machine without base64 is one where this feature does not work. It is
    // not one where the prompt should print an error after every command.
    #[test]
    fn a_machine_without_base64_loses_the_feature_and_nothing_else() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains("command -v base64"), "unguarded: {hook}");
        }
    }

    // ---- zsh ----

    /*
     * Pointing ZDOTDIR at our own directory means zsh reads our startup files
     * instead of the user's. Every one of them has to hand control back, or
     * this silently unconfigures the shell of anyone who uses it.
     */
    #[test]
    fn every_zsh_file_sources_the_user_s_own() {
        for (name, body) in zsh_files(Path::new("/home/someone")) {
            let own = name.trim_start_matches('.');
            assert!(
                body.contains(&format!("/.{own}")),
                "{name} never sources the user's own"
            );
            assert!(body.contains("/home/someone"), "{name} does not know where home is");
        }
    }

    /*
     * The ordering that fails quietly.
     *
     * zsh reads .zshenv first and then looks for every later file in whatever
     * ZDOTDIR says at that moment. Restoring it in .zshenv — the obvious
     * place — sends zsh to the user's directory for .zshrc, so ours is never
     * read: the shell works, the user's setup loads, and the hook is simply
     * absent. Measured against a real zsh before this test existed.
     */
    #[test]
    fn only_the_last_file_zsh_reads_here_puts_zdotdir_back() {
        for (name, body) in zsh_files(Path::new("/home/someone")) {
            let restores = body.contains("ZDOTDIR=\"$__jky_home\"");
            assert_eq!(
                restores,
                name == ".zshrc",
                "{name} restores ZDOTDIR at the wrong time"
            );
        }
    }

    // And it restores it after the hook, not before — there is nothing left
    // for zsh to find here by then.
    #[test]
    fn zdotdir_goes_back_only_once_the_hook_is_installed() {
        let (_, rc) = zsh_files(Path::new("/home/someone"))
            .into_iter()
            .find(|(n, _)| n == ".zshrc")
            .expect(".zshrc");
        assert!(
            rc.find("precmd_functions+=").unwrap() < rc.find("ZDOTDIR=\"$__jky_home\"").unwrap(),
            "ZDOTDIR is restored before the hook is installed"
        );
    }

    #[test]
    fn every_zsh_startup_file_is_accounted_for() {
        let names: Vec<String> = zsh_files(Path::new("/home/someone"))
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        for expected in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            assert!(names.iter().any(|n| n == expected), "{expected} is not written");
        }
    }

    // Only .zshrc runs for an interactive shell, so that is the only one that
    // should carry a prompt hook.
    #[test]
    fn only_the_interactive_file_carries_the_hook() {
        for (name, body) in zsh_files(Path::new("/home/someone")) {
            let has_hook = body.contains("precmd");
            assert_eq!(has_hook, name == ".zshrc", "{name} has the wrong contents");
        }
    }

    // A missing file is the ordinary case — plenty of people have a .zshrc
    // and nothing else. Sourcing one that is not there must not be an error.
    #[test]
    fn a_startup_file_the_user_does_not_have_is_not_an_error() {
        for (_, body) in zsh_files(Path::new("/home/someone")) {
            assert!(body.contains("[ -f"), "unguarded source");
        }
    }

    /*
     * zsh is told the command by preexec, not asked for it afterwards.
     *
     * `$history[$HISTCMD]` is the obvious way and it is empty in any shell
     * that is not keeping history — which a shell started with no
     * configuration is not. Measured against a real zsh through a real pty:
     * the report arrived with a correct exit code and a blank command until
     * preexec existed.
     */
    #[test]
    fn zsh_is_told_the_command_rather_than_asked_for_it_later() {
        let (_, rc) = zsh_files(Path::new("/home/someone"))
            .into_iter()
            .find(|(n, _)| n == ".zshrc")
            .expect(".zshrc");
        assert!(rc.contains("preexec_functions+="), "no preexec hook");
        assert!(!rc.contains("$history["), "still reading history after the fact");
        assert!(zsh_preexec().contains("$1"), "preexec ignores what it was given");
    }

    // ---- the environment ----

    #[test]
    fn bash_is_hooked_through_its_own_prompt_variable() {
        let env = integration_env("bash", Path::new("/cfg"), Some(Path::new("/home/someone")));
        assert!(env.contains_key("PROMPT_COMMAND"));
        assert!(!env.contains_key("ZDOTDIR"), "bash has no use for ZDOTDIR");
    }

    #[test]
    fn zsh_is_hooked_by_being_pointed_at_our_startup_files() {
        let env = integration_env("zsh", Path::new("/cfg"), Some(Path::new("/home/someone")));
        // Its own directory, not the config root: these are files zsh will
        // read on every start, and they should not sit among settings.
        assert_eq!(
            env.get("ZDOTDIR").map(String::as_str),
            Some(integration_dir(Path::new("/cfg")).to_str().unwrap())
        );
        // Without this the restored ZDOTDIR would be wrong for anyone who had
        // set one of their own.
        assert_eq!(
            env.get("JKY_USER_ZDOTDIR").map(String::as_str),
            Some("/home/someone")
        );
    }

    // A shell this does not know how to hook gets no environment of its own,
    // rather than one meant for a different shell.
    #[test]
    fn a_shell_that_cannot_be_hooked_is_left_alone() {
        for shell in ["fish", "nu", "pwsh", "powershell.exe", ""] {
            let env = integration_env(shell, Path::new("/cfg"), Some(Path::new("/home")));
            assert!(env.is_empty(), "{shell} got {env:?}");
        }
    }

    // The shell arrives as a path, not a name.
    #[test]
    fn recognises_a_shell_by_the_end_of_its_path() {
        assert!(!integration_env("/usr/bin/zsh", Path::new("/cfg"), None).is_empty());
        assert!(!integration_env("/bin/bash", Path::new("/cfg"), None).is_empty());
        assert!(integration_env("/usr/bin/fish", Path::new("/cfg"), None).is_empty());
    }

    // Keeping a user's own PROMPT_COMMAND is the difference between adding a
    // hook and replacing their prompt.
    #[test]
    fn bash_keeps_whatever_prompt_command_was_already_there() {
        assert!(bash_prompt_command(Some("__mine")).contains("__mine"));
        assert!(!bash_prompt_command(None).contains("__mine"));
    }
}
