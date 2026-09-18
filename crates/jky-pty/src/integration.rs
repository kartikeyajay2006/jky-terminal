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
//! Each shell is hooked through the mechanism it actually offers. Anything
//! else is left alone rather than half-hooked — the feature is absent there,
//! which is a thing the panel can say.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use crate::ASK_OSC;

/// Marker introducing a completion report inside an OSC 1337 sequence.
pub const DONE_PREFIX: &str = "JKYDone=";

/// The OSC carrying semantic prompt marks.
///
/// Unlike 1337, this one is not ours and the number is not a choice. OSC 133
/// is the convention iTerm2, WezTerm, Kitty, Ghostty and Windows Terminal all
/// already speak, so a shell configured for this app keeps working in those,
/// and a shell configured for those keeps working here. Inventing a private
/// sequence for a solved problem would make this app the odd one out in
/// somebody's dotfiles, which is the surest way to be removed from them.
///
/// Four marks matter. `A` is where a prompt begins, `C` is where a command's
/// output begins, and `D` carries the exit status. `B` — the boundary between
/// the prompt and what the user typed — is deliberately not emitted: it has
/// to live inside `PS1`, and rewriting somebody's prompt string risks their
/// line wrapping for a mark none of the features here need.
pub const MARK_OSC: u16 = 133;

/// The OSC carrying the working directory.
///
/// Also a shared convention rather than an invention. The completion report
/// already carries `$PWD`, but only once a command has finished — which is
/// too late for the two things that need it most: a new split or tab opening
/// where you already are, and a relative path in output being resolvable to a
/// real file. This fires on every prompt, so the answer is always current.
pub const CWD_OSC: u16 = 7;

/// Where the zsh startup files that hand control back live.
pub fn integration_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("shell")
}

/// The shell fragment that reports a finished command, shared by both shells.
///
/// **Every command, not only the ones that failed.** That is a reversal, and
/// a deliberate one. When the only consumer was the offer of help under a
/// broken command, staying silent on success was right: a terminal writing an
/// escape sequence after every successful command was paying constantly for
/// the one case in fifty that needed it.
///
/// It is not right any more. A finished command is now the moment the
/// terminal decides whether its output can be shown as something better than
/// text — and a command that succeeded is exactly the interesting case, since
/// `ls`, `git log` and `docker ps` do not fail. Reporting only failures would
/// mean the feature could never see the commands it exists for.
///
/// `command -v base64` is not caution for its own sake: a machine without it
/// is one where this does not work, and it must not also be one where the
/// prompt prints an error after every command.
///
/// The working directory travels with it. Several things the terminal can do
/// with a finished command need to know where it ran — `ls` in one directory
/// is a different answer from `ls` in another, and a path shown without the
/// directory it is relative to is a path you cannot act on.
///
/// The command text is base64 before it goes near an OSC sequence. A command
/// line is arbitrary text — quotes, semicolons, newlines, and the BEL that
/// terminates the sequence — so interpolating it raw would let anyone who
/// could get a command into your history write whatever they liked into the
/// stream this app parses.
fn report(command_expr: &str) -> String {
    format!(
        "if command -v base64 >/dev/null 2>&1; then \
printf '\\033]{osc};{prefix}%s\\007' \
\"$(printf '%s\\n%s\\n%s' \"$__jky_status\" \"$PWD\" \"{command_expr}\" | base64 | tr -d '\\n')\"; fi",
        osc = ASK_OSC,
        prefix = DONE_PREFIX,
    )
}

/// The marks written before each prompt: the last command's status, where we
/// are now, and the start of the prompt itself.
///
/// One `printf` rather than three. This runs before every prompt for
/// everybody, so the difference between one write and three is paid all day.
///
/// `D` is emitted unconditionally, including on the very first prompt where no
/// command has run and `$?` is whatever the startup files left behind. The
/// alternative is a flag threaded through both shells to suppress one
/// meaningless mark, and a consumer that sees `D` without a preceding `C`
/// already knows to ignore it — the existing completion report has behaved
/// this way since it was written.
fn marks_before_prompt() -> String {
    format!(
        "printf '\\033]{mark};D;%s\\007\\033]{cwd};file://%s%s\\007\\033]{mark};A\\007' \
\"$__jky_status\" \"${{HOSTNAME:-}}\" \"$PWD\"",
        mark = MARK_OSC,
        cwd = CWD_OSC,
    )
}

/// The mark written when a command starts, before any of its output.
///
/// This is the one that earns the feature. Everything before it on screen is
/// prompt and typed command; everything after it, until the next `D`, is
/// output. Without it that boundary has to be guessed by searching the screen
/// for the command's own text, which is wrong the moment a command prints
/// something that looks like itself.
pub fn mark_output_start() -> String {
    format!("printf '\\033]{mark};C\\007'", mark = MARK_OSC)
}

/// What bash prints after reading a command and before running it.
///
/// `PS0` is the only hook bash offers at that moment. The alternative is a
/// `DEBUG` trap, which fires for every line of every function and would make
/// the terminal's idea of "output starts here" wrong in exactly the scripts
/// where it matters most.
///
/// This is a prompt string rather than a command, so the escape is spelled the
/// way bash expands prompts — `\e` and `\a` — and not as a `printf`.
///
/// `PS0` arrived in bash 4.4. macOS still ships bash 3.2, where this variable
/// is simply ignored: no error, no mark, and the terminal falls back to
/// locating output by searching for the command's own text. That is the same
/// behaviour it had before any of this existed, which is the right way for a
/// feature to be missing.
pub fn bash_ps0(existing: Option<&str>) -> String {
    let mark = format!("\\e]{};C\\a", MARK_OSC);
    match existing.map(str::trim).filter(|e| !e.is_empty()) {
        // Theirs first: PS0 is printed, and anything it prints belongs before
        // the mark that says output has started.
        Some(theirs) => format!("{theirs}{mark}"),
        None => mark,
    }
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
{marks}; {report}",
        marks = marks_before_prompt(),
        report = report("$__jky_cmd"),
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
    format!("__jky_cmd=$1; {}", mark_output_start())
}

/// What zsh runs before drawing each prompt.
pub fn zsh_hook() -> String {
    format!(
        "__jky_status=$?; {marks}; {report}",
        marks = marks_before_prompt(),
        report = report("$__jky_cmd"),
    )
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
    // Written on every platform rather than behind `cfg(windows)`: PowerShell
    // runs on macOS and Linux too, and a file nobody dot-sources costs a few
    // hundred bytes on disk.
    std::fs::write(dir.join(POWERSHELL_FILE), powershell_hook())?;
    std::fs::write(
        dir.join(NUSHELL_FILE),
        nushell_hook(nushell_user_config().as_deref()),
    )?;
    Ok(())
}

/// The environment that hooks a given shell, or nothing for one this does not
/// know how to hook.
///
/// Nothing, rather than a best guess: half-hooking a shell means an escape
/// sequence in the wrong place or a startup file that never runs, and the
/// honest outcome for a shell nobody has written hooks for is that the
/// feature is absent.
///
/// Empty here does not mean unhooked any more. fish is hooked by argument —
/// see `integration_args` — because it has no environment variable that would
/// do it without editing the user's own configuration.
/// The fish hooks, as one script to run after fish has read its config.
///
/// fish is hooked by argument rather than by environment, which is the whole
/// reason this is shaped differently from the other two. There is no `ZDOTDIR`
/// for fish: the only directory it reads is the user's own `conf.d`, and
/// writing a file into somebody's configuration to make a terminal work is a
/// thing they did not ask for and would have to find to undo. `--init-command`
/// runs after their config and leaves nothing behind.
///
/// The events line up with the marks better than bash's do. `fish_preexec`
/// fires between reading a command and running it, which is exactly `C`, and
/// `fish_postexec` fires with the command line in hand, which is `D` and the
/// report together — no `PS0` to abuse and no trap that fires per function.
///
/// `set -l s $status` is the first line of the postexec handler and has to be:
/// `$status` is clobbered by the next command run, and every line after this
/// one is a command.
pub fn fish_hook() -> String {
    format!(
        r"function __jky_prompt --on-event fish_prompt
printf ']{mark};A'
end
function __jky_preexec --on-event fish_preexec
printf ']{mark};C'
end
function __jky_postexec --on-event fish_postexec
set -l s $status
printf ']{mark};D;%s]{cwd};file://%s%s' $s $hostname $PWD
if command -v base64 >/dev/null 2>&1
printf ']{osc};{prefix}%s' (printf '%s
%s
%s' $s $PWD $argv[1] | base64 | tr -d '
')
end
end",
        mark = MARK_OSC,
        cwd = CWD_OSC,
        osc = ASK_OSC,
        prefix = DONE_PREFIX,
    )
}

/// The name the PowerShell hook is written under.
pub const POWERSHELL_FILE: &str = "jky-integration.ps1";

/// The Nushell configuration overlay, loaded after the user's own config.
pub const NUSHELL_FILE: &str = "jky-integration.nu";

/// Nushell's configuration normally lives in a platform-specific directory.
///
/// We need the original config path because `nu --config` replaces its normal
/// `config.nu` discovery. The overlay we pass to Nu sources this file first,
/// then appends its hooks — preserving themes, aliases, prompts, and plugins.
fn nushell_user_config() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|dir| dir.join("nushell").join("config.nu"))
    }

    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|dir| {
                dir.join("Library")
                    .join("Application Support")
                    .join("nushell")
                    .join("config.nu")
            })
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .map(|dir| dir.join("nushell").join("config.nu"))
    }
}

/// A Nushell source operand. `source` resolves its input while parsing, so a
/// runtime environment variable is not enough; it must be a literal path or
/// the documented `null` no-op.
fn nu_source(path: Option<&Path>) -> String {
    path.filter(|path| path.is_file())
        // Rust's debug string is a double-quoted literal with backslashes and
        // quotes escaped, which is also the string syntax Nu accepts here.
        .map(|path| format!("{:?}", path.to_string_lossy()))
        .unwrap_or_else(|| "null".to_string())
}

/// The Nushell overlay, loaded with `nu --config`.
///
/// Nu's interactive hooks are precisely the prompt and pre-execution hooks
/// this terminal needs. The overlay deliberately loads the original config
/// first and *appends* to its hook lists. That means a user's prompt, Starship
/// setup, aliases, and hooks keep their own order and behaviour.
pub fn nushell_hook(user_config: Option<&Path>) -> String {
    let source = nu_source(user_config);
    r#"# JKY Terminal shell integration.
#
# This overlay is passed only to Nu started by JKY. It sources your normal
# config first, then adds telemetry hooks without editing your dotfiles.
source __JKY_USER_CONFIG__

$env.config.hooks.pre_execution = (
  ($env.config.hooks.pre_execution? | default [])
  | append {||
      $env.JKY_NU_LAST_COMMAND = (commandline)
      print -n $"(char esc)]133;C(char bel)"
    }
)

$env.config.hooks.pre_prompt = (
  ($env.config.hooks.pre_prompt? | default [])
  | append {||
      let status = ($env.LAST_EXIT_CODE? | default 0)
      let cwd = ($env.PWD | into string)
      let command = ($env.JKY_NU_LAST_COMMAND? | default "")
      let payload = ([$status $cwd $command] | str join (char newline) | encode base64)
      let host = ($env.HOSTNAME? | default "")
      print -n $"(char esc)]133;D;($status)(char bel)"
      print -n $"(char esc)]7;file://($host)($cwd)(char bel)"
      print -n $"(char esc)]1337;JKYDone=($payload)(char bel)"
      print -n $"(char esc)]133;A(char bel)"
    }
)
"#.replace("__JKY_USER_CONFIG__", &source)
}

/// The PowerShell hooks, as a file to be dot-sourced after the profile.
///
/// A file rather than a string on the command line, and that is the whole
/// design. PowerShell's `-Command` takes a script as one argument, and a
/// script this size carrying quotes, braces and `$` through a Windows command
/// line is a quoting problem with no good answer. Dot-sourcing a path means
/// only the path needs quoting, and the path is ours.
///
/// It runs after the user's profile, which is what lets it wrap the prompt
/// they actually ended up with rather than the one they started from.
///
/// Two hooks, because PowerShell splits what bash does in one place:
///
/// `prompt` runs before each prompt and carries the status, the directory and
/// the last command — `D`, the cwd report and `A`. `PSConsoleHostReadLine` is
/// what PSReadLine calls to read a line, so wrapping it gives the moment
/// between "the command has been read" and "the command runs", which is `C`
/// and has no other hook in PowerShell.
///
/// Getting the status right is the fiddly part and it is why `$ok = $?` is
/// the first statement. `$?` is whether the last thing succeeded and is
/// clobbered by the next statement; `$LASTEXITCODE` is the exit code of the
/// last *native* program and is stale after a cmdlet. Neither alone is the
/// answer, so both are read, in that order, before anything else runs.
pub fn powershell_hook() -> String {
    format!(
        r#"# JKY Terminal shell integration.
#
# Dot-sourced after your profile. It wraps the prompt to report what a
# command did; deleting this file costs that and nothing else.

if (-not $global:__jkyInstalled) {{
  $global:__jkyInstalled = $true
  $global:__jkyPrompt = $function:prompt

  if (Test-Path function:PSConsoleHostReadLine) {{
    $global:__jkyReadLine = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {{
      $line = & $global:__jkyReadLine
      [Console]::Write("$([char]27)]{mark};C$([char]7)")
      $line
    }}
  }}

  function global:prompt {{
    $ok = $?
    $native = $global:LASTEXITCODE
    $code = if ($null -ne $native) {{ $native }} elseif ($ok) {{ 0 }} else {{ 1 }}

    $e = [char]27
    $a = [char]7
    $here = $PWD.Path

    [Console]::Write("$e]{mark};D;$code$a")
    [Console]::Write("$e]{cwd};file://$env:COMPUTERNAME$($here -replace '\\', '/')$a")

    $last = (Get-History -Count 1).CommandLine
    if ($last) {{
      $text = "$code`n$here`n$last"
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
      [Console]::Write("$e]{osc};{prefix}$b64$a")
    }}

    [Console]::Write("$e]{mark};A$a")
    & $global:__jkyPrompt
  }}
}}
"#,
        mark = MARK_OSC,
        cwd = CWD_OSC,
        osc = ASK_OSC,
        prefix = DONE_PREFIX,
    )
}

/// A path as PowerShell reads it inside single quotes.
///
/// Only the quote needs handling: inside single quotes PowerShell expands
/// nothing, so a doubled quote is the whole escape.
fn ps_quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "''"))
}

/// Arguments that hook a shell the environment cannot reach.
///
/// Empty for every shell hooked by environment, which is most of them.
pub fn integration_args(shell: &str, config_dir: &Path) -> Vec<String> {
    match crate::shell::shell_name(shell).as_str() {
        "fish" => vec!["--init-command".to_string(), fish_hook()],
        // `-NoExit` because `-Command` would otherwise run the hook and leave;
        // the hook is setup, not the session. The profile has already loaded
        // by the time this runs, which is what lets it wrap the real prompt.
        "pwsh" | "powershell" => vec![
            "-NoLogo".to_string(),
            "-NoExit".to_string(),
            "-Command".to_string(),
            format!(". {}", ps_quote(&integration_dir(config_dir).join(POWERSHELL_FILE))),
        ],
        // `--config` is an overlay rather than a replacement: the overlay
        // sources the platform's usual config.nu before it appends hooks.
        // Unlike `-c`, this leaves Nu in its interactive REPL where hooks run.
        "nu" => vec![
            "--config".to_string(),
            integration_dir(config_dir).join(NUSHELL_FILE).display().to_string(),
        ],
        _ => Vec::new(),
    }
}

pub fn integration_env(
    shell: &str,
    config_dir: &Path,
    user_zdotdir: Option<&Path>,
) -> HashMap<String, String> {
    let name = crate::shell::shell_name(shell);
    let name = name.as_str();

    let home = user_zdotdir
        .map(|p| p.display().to_string())
        .or_else(|| std::env::var("ZDOTDIR").ok())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default();

    match name {
        "bash" => HashMap::from([
            (
                "PROMPT_COMMAND".to_string(),
                bash_prompt_command(std::env::var("PROMPT_COMMAND").ok().as_deref()),
            ),
            (
                "PS0".to_string(),
                bash_ps0(std::env::var("PS0").ok().as_deref()),
            ),
        ]),
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

    /// The four things a consumer needs to bound a command exactly.
    #[test]
    fn every_prompt_reports_status_directory_and_its_own_start() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains(&format!("]{};D;%s", MARK_OSC)), "no exit mark: {hook}");
            assert!(hook.contains(&format!("]{};file://", CWD_OSC)), "no cwd report: {hook}");
            assert!(hook.contains(&format!("]{};A", MARK_OSC)), "no prompt mark: {hook}");
        }
    }

    #[test]
    fn zsh_marks_where_output_begins() {
        // Without this the start of output is guessed by searching the screen
        // for the command's own text.
        assert!(zsh_preexec().contains(&format!("]{};C", MARK_OSC)));
    }

    #[test]
    fn the_command_the_shell_remembered_still_travels() {
        // The marks were added beside the existing report, not instead of it.
        assert!(zsh_preexec().contains("__jky_cmd=$1"));
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains(DONE_PREFIX), "the completion report went missing");
        }
    }

    /// `B` is the one mark deliberately not emitted.
    #[test]
    fn nothing_rewrites_the_users_prompt_string() {
        for hook in [bash_hook(), zsh_hook(), zsh_preexec()] {
            assert!(!hook.contains("PS1"), "the prompt string must not be touched");
            assert!(!hook.contains(&format!("]{};B", MARK_OSC)));
        }
    }

    /// One write per prompt, not three.
    #[test]
    fn the_marks_cost_a_single_printf() {
        assert_eq!(marks_before_prompt().matches("printf").count(), 1);
    }

    /// The fragment has to be valid shell, and it has to emit what it claims.
    ///
    /// This is the test that matters most in this file. The hook runs before
    /// every prompt of every shell this app starts, so a syntax error here is
    /// not a broken feature — it is an error message printed under every
    /// command the user ever runs. Reading the string and asserting it
    /// contains `]133;A` proves nothing about whether a shell can run it.
    ///
    /// Unix only: there is no `sh` to run it with on Windows, and the hook is
    /// not installed there either.
    #[cfg(unix)]
    #[test]
    fn a_real_shell_runs_the_hook_and_emits_the_marks() {
        use std::process::Command;

        for (shell, hook) in [("bash", bash_hook()), ("sh", zsh_hook())] {
            // Skip rather than fail where the shell is absent; a runner
            // without bash is a runner this cannot speak for.
            if Command::new(shell).arg("-c").arg("exit 0").output().is_err() {
                continue;
            }

            let script = format!("__jky_cmd='echo hi'; PWD=/tmp; {hook}");
            let out = Command::new(shell)
                .arg("-c")
                .arg(&script)
                .output()
                .expect("the shell should run");

            assert!(
                out.status.success(),
                "{shell} could not run the hook: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert!(
                String::from_utf8_lossy(&out.stderr).is_empty(),
                "{shell} printed to stderr under the hook: {}",
                String::from_utf8_lossy(&out.stderr)
            );

            let stdout = String::from_utf8_lossy(&out.stdout);
            // The real bytes, with a real ESC, not the source's backslash-033.
            assert!(stdout.contains("\u{1b}]133;D;"), "{shell}: no exit mark emitted");
            assert!(stdout.contains("\u{1b}]7;file://"), "{shell}: no cwd reported");
            assert!(stdout.contains("\u{1b}]133;A"), "{shell}: no prompt mark emitted");
        }
    }

    /// The output mark, likewise run rather than merely read.
    #[cfg(unix)]
    #[test]
    fn a_real_shell_runs_the_output_mark() {
        use std::process::Command;

        let out = Command::new("sh")
            .arg("-c")
            .arg(mark_output_start())
            .output()
            .expect("sh should run");

        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout), "\u{1b}]133;C\u{7}");
    }

    #[test]
    fn the_report_is_carried_on_the_channel_the_app_already_listens_to() {
        assert!(bash_hook().contains(&format!("]{}", crate::ASK_OSC)));
        assert!(bash_hook().contains(DONE_PREFIX));
    }

    /*
     * Every command is reported, including the ones that worked.
     *
     * This used to be the opposite, with a good reason: a terminal writing an
     * escape after every successful command paid constantly for the one case
     * in fifty that failed. The reason stopped applying when a finished
     * command became the moment the terminal decides whether its output can
     * be shown as something better than text — `ls`, `git log` and `docker
     * ps` do not fail, and reporting only failures would mean never seeing
     * the commands the feature exists for.
     */
    // Where it ran travels with it: `ls` in one directory is a different
    // answer from `ls` in another.
    #[test]
    fn carries_the_directory_the_command_ran_in() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(hook.contains("$PWD"), "no working directory in: {hook}");
        }
    }

    #[test]
    fn reports_a_command_that_worked_as_well_as_one_that_did_not() {
        for hook in [bash_hook(), zsh_hook()] {
            assert!(
                !hook.contains("-ne 0"),
                "still reporting only failures: {hook}"
            );
            assert!(hook.contains("$__jky_status"), "the status is not carried: {hook}");
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
        let shell = "";
        let env = integration_env(shell, Path::new("/cfg"), Some(Path::new("/home")));
        assert!(env.is_empty(), "{shell} got {env:?}");
        assert!(integration_args(shell, Path::new("/cfg")).is_empty(), "{shell} got arguments");
    }

    #[test]
    fn nushell_uses_an_interactive_overlay_that_keeps_user_configuration() {
        let args = integration_args("/usr/bin/nu", Path::new("/cfg"));
        assert_eq!(args.first().map(String::as_str), Some("--config"));
        assert!(args.last().is_some_and(|arg| arg.ends_with(NUSHELL_FILE)));

        let hook = nushell_hook(Some(Path::new("/home/someone/.config/nushell/config.nu")));
        assert!(hook.contains("source null"), "missing user config should be a no-op");
        assert!(!hook.contains("source \"/home/someone/.config/nushell/config.nu\""),
            "a missing config cannot be resolved at Nu parse time");
        let existing = tempfile::tempdir().expect("temp dir");
        let config = existing.path().join("config.nu");
        std::fs::write(&config, "# user config").expect("config");
        let hook = nushell_hook(Some(&config));
        assert!(
            hook.contains(&format!("source {:?}", config.to_string_lossy())),
            "user config is replaced"
        );
        assert!(hook.contains("pre_execution"), "no command boundary");
        assert!(hook.contains("pre_prompt"), "no completion boundary");
        assert!(hook.contains("]133;C"), "no output mark");
        assert!(hook.contains("]1337;JKYDone="), "no command report");
    }

    // fish is hooked by argument, so an empty environment is the right answer
    // for it and not the sign of an unsupported shell it used to be.
    #[test]
    fn fish_is_hooked_by_argument_rather_than_environment() {
        assert!(integration_env("fish", Path::new("/cfg"), None).is_empty());

        let args = integration_args("/usr/bin/fish", Path::new("/cfg"));
        assert_eq!(args.first().map(String::as_str), Some("--init-command"));
        // Nothing is written anywhere. Dropping a file into somebody's
        // `conf.d` to make a terminal work is a thing they did not ask for
        // and would have to go looking for to undo.
        assert!(args[1].contains("--on-event fish_preexec"));
        assert!(args[1].contains("--on-event fish_postexec"));
    }

    #[test]
    fn powershell_is_hooked_by_dot_sourcing_a_file_we_wrote() {
        let args = integration_args("powershell.exe", Path::new("/cfg"));
        assert_eq!(args.first().map(String::as_str), Some("-NoLogo"));
        // Without -NoExit, -Command runs the hook and leaves. The hook is
        // setup; the session is the point.
        assert!(args.contains(&"-NoExit".to_string()), "the session would exit");
        let last = args.last().expect("a command");
        assert!(last.starts_with(". "), "not dot-sourced: {last}");
        assert!(last.contains(POWERSHELL_FILE), "does not name the hook: {last}");
    }

    #[test]
    fn pwsh_is_hooked_the_same_way_as_windows_powershell() {
        let seven = integration_args("/usr/bin/pwsh", Path::new("/cfg"));
        let five = integration_args(r"C:\Windows\...\powershell.exe", Path::new("/cfg"));
        assert_eq!(seven, five);
        assert!(!seven.is_empty());
    }

    // cmd.exe has no prompt hook worth the name, so it gets nothing rather
    // than something meant for a shell it is not.
    #[test]
    fn cmd_is_not_pretended_to_be_powershell() {
        assert!(integration_args("cmd.exe", Path::new("/cfg")).is_empty());
    }

    #[test]
    fn the_powershell_hook_reports_the_same_four_things_the_others_do() {
        let hook = powershell_hook();
        assert!(hook.contains(&format!("{MARK_OSC};A")), "no prompt mark");
        assert!(hook.contains(&format!("{MARK_OSC};C")), "no output mark");
        assert!(hook.contains(&format!("{MARK_OSC};D")), "no done mark");
        assert!(hook.contains(&format!("{CWD_OSC};file://")), "no directory");
        assert!(hook.contains(DONE_PREFIX), "no command report");
    }

    /*
     * `$?` is clobbered by the next statement, so it has to be read first.
     *
     * Reading it late reports the success of whatever the hook itself just
     * did, which is always true — so every command would look like it worked
     * and the failure offer would never appear.
     */
    #[test]
    fn the_powershell_hook_takes_the_status_before_anything_can_change_it() {
        let hook = powershell_hook();
        let body = hook.split("function global:prompt {").nth(1).expect("the prompt");
        let first = body.lines().nth(1).unwrap_or("").trim();
        assert_eq!(first, "$ok = $?", "the status is read too late");
    }

    // It wraps the prompt the user ended up with rather than replacing it.
    #[test]
    fn the_powershell_hook_keeps_the_prompt_it_found() {
        let hook = powershell_hook();
        assert!(hook.contains("$global:__jkyPrompt = $function:prompt"), "does not save it");
        assert!(hook.contains("& $global:__jkyPrompt"), "does not call it back");
    }

    // Dot-sourced twice — a nested shell, a reloaded profile — would wrap the
    // wrapper, and every prompt would report twice.
    #[test]
    fn the_powershell_hook_installs_itself_only_once() {
        assert!(powershell_hook().contains("if (-not $global:__jkyInstalled)"));
    }

    #[test]
    fn a_path_with_a_quote_in_it_cannot_end_the_string_it_is_in() {
        let quoted = ps_quote(Path::new("/tmp/it's here"));
        assert_eq!(quoted, "'/tmp/it''s here'");
    }

    #[test]
    fn the_fish_hook_reports_the_same_four_things_the_others_do() {
        let hook = fish_hook();
        assert!(hook.contains(&format!("{MARK_OSC};A")), "no prompt mark");
        assert!(hook.contains(&format!("{MARK_OSC};C")), "no output mark");
        assert!(hook.contains(&format!("{MARK_OSC};D")), "no done mark");
        assert!(hook.contains(&format!("{CWD_OSC};file://")), "no directory");
        assert!(hook.contains(DONE_PREFIX), "no command report");
    }

    // `$status` is clobbered by the next command, and every line after the
    // first in that handler is a command.
    #[test]
    fn the_fish_hook_takes_the_status_before_anything_can_change_it() {
        let hook = fish_hook();
        let body = hook.split("--on-event fish_postexec").nth(1).expect("handler");
        let first = body.lines().nth(1).unwrap_or("").trim();
        assert_eq!(first, "set -l s $status", "the status is read too late");
    }

    /*
     * The hook, run by a real fish.
     *
     * fish only fires its prompt events under a tty, so this fires them by
     * hand with `emit` — which is the same code path the events take and the
     * only part this test is about. Skipped where fish is absent.
     */
    #[test]
    fn a_real_fish_runs_the_hook_and_emits_the_marks() {
        use std::process::Command;

        if Command::new("fish").arg("-c").arg("true").output().is_err() {
            return;
        }

        let script = format!(
            "{}\nemit fish_prompt\nemit fish_preexec 'echo hi'\nemit fish_postexec 'echo hi'",
            fish_hook()
        );
        let out = Command::new("fish")
            .arg("-c")
            .arg(script.replace("\\n", "\n"))
            .output()
            .expect("fish should run");

        assert!(
            out.status.success(),
            "fish could not run the hook: {}",
            String::from_utf8_lossy(&out.stderr)
        );

        let seen = String::from_utf8_lossy(&out.stdout);
        assert!(seen.contains("\u{1b}]133;A\u{7}"), "no prompt mark in {seen:?}");
        assert!(seen.contains("\u{1b}]133;C\u{7}"), "no output mark in {seen:?}");
        assert!(seen.contains("\u{1b}]133;D;0\u{7}"), "no done mark in {seen:?}");
        assert!(seen.contains("]1337;JKYDone="), "no command report in {seen:?}");
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
