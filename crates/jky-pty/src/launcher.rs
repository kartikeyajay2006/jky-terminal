use std::io;
use std::path::{Path, PathBuf};

/// The command names that reprint the banner.
///
/// Three spellings because people type what they remember, not what a manual
/// says. On Windows the filesystem is case-insensitive so two of these resolve
/// to one file, which is harmless — the last write wins and every spelling
/// still works.
pub const LAUNCHER_NAMES: &[&str] = &["jky-terminal", "jkyterminal", "jkyTerminal"];

/// Filename holding the pre-rendered banner the launchers print.
const BANNER_FILE: &str = "banner.ansi";

/// Filename holding the pre-rendered command list.
const COMMANDS_FILE: &str = "commands.ansi";

/// OSC code carrying a question from the shell to the assistant panel.
///
/// 1337 is the iTerm2 convention for application-defined sequences. Terminals
/// that do not recognise it ignore it silently, which is exactly the
/// behaviour we want if this script is ever run outside JKY Terminal.
pub const ASK_OSC: u16 = 1337;

/// Install the banner and the small scripts that print it.
///
/// This is the same trick an editor uses to make its own name work as a shell
/// command: drop a launcher in a directory and put that directory on the PATH
/// of the shell we spawn. Nothing is installed system-wide, nothing outlives
/// the session, and the user's shell configuration is never touched.
pub fn install_launchers(bin_dir: &Path, banner: &str, commands: &str) -> io::Result<()> {
    std::fs::create_dir_all(bin_dir)?;

    let banner_path = bin_dir.join(BANNER_FILE);
    std::fs::write(&banner_path, banner)?;

    let commands_path = bin_dir.join(COMMANDS_FILE);
    std::fs::write(&commands_path, commands)?;

    for name in LAUNCHER_NAMES {
        write_launcher(bin_dir, name, &banner_path)?;
    }
    write_ask_launcher(bin_dir, &banner_path, &commands_path, &bin_dir.join("data"))?;
    Ok(())
}

/// The `jky` command: `jky ask <question>` sends a question to the assistant.
///
/// It emits an OSC escape sequence rather than talking to the app directly.
/// The sequence travels the pty like any other output, the terminal decodes
/// it, and nothing has to know the app's address or hold a socket open. Run
/// outside JKY Terminal it prints nothing and does no harm.
#[cfg(not(windows))]
fn write_ask_launcher(
    bin_dir: &Path,
    banner_path: &Path,
    commands_path: &Path,
    data_dir: &Path,
) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let script = bin_dir.join("jky");
    let body = format!(
        r#"#!/bin/sh
# Print a whole listing.
jky_show() {{
  if [ -f "{data}/$1.ansi" ]; then
    cat "{data}/$1.ansi"
  else
    echo "jky: nothing saved yet. Add one with jky $1 add, or from the Dashboard." >&2
    exit 1
  fi
}}

# Print one record by its handle.
jky_read() {{
  one="{data}/$1/$2.ansi"
  if [ -f "$one" ]; then
    cat "$one"
  else
    echo "jky: no $1 entry '$2'" >&2
    [ -f "{data}/$1.ansi" ] && cat "{data}/$1.ansi" >&2
    exit 1
  fi
}}

# Send a verb and its arguments to the app.
#
# Built as JSON so an argument containing a quote, a newline, or the sequence
# terminator itself stays one argument — splitting on a separator would fail
# the first time anyone wrote one into a note. Then base64, so none of those
# characters reach the escape sequence at all.
#
# The JSON is assembled with printf rather than a here-doc because a here-doc
# would need the arguments interpolated, which is exactly the escaping problem
# being avoided.
jky_send() {{
  verb="$1"
  shift
  json='{{"verb":"'"$verb"'","args":['
  first=1
  for arg in "$@"; do
    # Backslashes first, or the escaping of quotes would itself be escaped.
    esc=$(printf '%s' "$arg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    if [ $first -eq 1 ]; then
      first=0
    else
      json="$json,"
    fi
    json="$json\"$esc\""
  done
  json="$json]}}"
  payload=$(printf '%s' "$json" | base64 | tr -d '\n')
  printf '\033]{osc};JKYCmd=%s\007' "$payload"
}}

case "$1" in
  ask|asks)
    shift
    if [ $# -eq 0 ]; then
      echo "usage: jky ask <question>" >&2
      exit 1
    fi
    # base64 so a question containing quotes, newlines, or the terminator
    # itself cannot break out of the sequence. `tr -d` rather than `base64 -w0`
    # because the BSD base64 on macOS has no -w flag.
    payload=$(printf '%s' "$*" | base64 | tr -d '\n')
    printf '\033]{osc};JKYAsk=%s\007' "$payload"
    ;;
  commands|command|help|--help|-h)
    cat "{commands}"
    ;;
  games|game)
    # No argument lists them with their records; a number opens that one in
    # the app, which the window picks up from the escape sequence exactly as
    # it does for `jky ask`.
    shift
    if [ $# -eq 0 ]; then
      if [ -f "{data}/games.ansi" ]; then
        cat "{data}/games.ansi"
      else
        echo "jky: open the Games section once so the listing is written." >&2
        exit 1
      fi
    else
      case "$1" in
        1|2|3|4)
          printf '\033]{osc};JKYGame=%s\007' "$1"
          ;;
        *)
          echo "jky: no game $1. Choose 1, 2, 3 or 4." >&2
          [ -f "{data}/games.ansi" ] && cat "{data}/games.ansi" >&2
          exit 1
          ;;
      esac
    fi
    ;;
  note)
    # Writes ride the same escape sequence `jky ask` uses. Nothing here parses
    # or formats — the app owns every rule about what a note may be — so this
    # only has to package the arguments without letting one break out.
    shift
    verb="$1"
    [ $# -gt 0 ] && shift
    case "$verb" in
      new|add) jky_send "note.new" "$@" ;;
      write|append) jky_send "note.write" "$@" ;;
      rename) jky_send "note.rename" "$@" ;;
      rm|delete|del) jky_send "note.rm" "$@" ;;
      "") jky_show notes ;;
      *) jky_read notes "$verb" ;;
    esac
    ;;
  todo)
    shift
    verb="$1"
    [ $# -gt 0 ] && shift
    case "$verb" in
      add|new) jky_send "todo.add" "$@" ;;
      done|tick) jky_send "todo.done" "$@" ;;
      undone|untick) jky_send "todo.undone" "$@" ;;
      rm|delete|del) jky_send "todo.rm" "$@" ;;
      "") jky_show todos ;;
      *) jky_read todos "$verb" ;;
    esac
    ;;
  reminder)
    shift
    verb="$1"
    [ $# -gt 0 ] && shift
    case "$verb" in
      add|new) jky_send "reminder.add" "$@" ;;
      done|tick) jky_send "reminder.done" "$@" ;;
      undone|untick) jky_send "reminder.undone" "$@" ;;
      rm|delete|del) jky_send "reminder.rm" "$@" ;;
      "") jky_show reminders ;;
      *) jky_read reminders "$verb" ;;
    esac
    ;;
  theme)
    shift
    jky_send "theme" "$@"
    ;;
  open|go)
    shift
    jky_send "open" "$@"
    ;;
  notes|reminders|todos)
    # The app rewrites these files whenever the dashboard changes, so the
    # shell needs no JSON parser and no way to reach back into the app.
    kind="$1"
    shift
    if [ $# -eq 0 ]; then
      jky_show "$kind"
    else
      jky_read "$kind" "$1"
    fi
    ;;
  ""|banner)
    cat "{banner}"
    ;;
  *)
    echo "jky: unknown command '$1'" >&2
    cat "{commands}" >&2
    exit 1
    ;;
esac
"#,
        osc = ASK_OSC,
        banner = banner_path.display(),
        commands = commands_path.display(),
        data = data_dir.display()
    );
    std::fs::write(&script, body)?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
}

#[cfg(windows)]
fn write_ask_launcher(
    bin_dir: &Path,
    banner_path: &Path,
    commands_path: &Path,
    data_dir: &Path,
) -> io::Result<()> {
    let script = bin_dir.join("jky.cmd");
    let body = format!(
        "@echo off\r\n\
         if /i \"%1\"==\"ask\" goto ask\r\n\
         if /i \"%1\"==\"asks\" goto ask\r\n\
         if /i \"%1\"==\"commands\" goto cmds\r\n\
         if /i \"%1\"==\"command\" goto cmds\r\n\
         if /i \"%1\"==\"help\" goto cmds\r\n\
         if /i \"%1\"==\"games\" goto games\r\n\
         if /i \"%1\"==\"game\" goto games\r\n\
         if /i \"%1\"==\"theme\" goto send\r\n\
         if /i \"%1\"==\"open\" goto send\r\n\
         if /i \"%1\"==\"go\" goto send\r\n\
         if /i \"%1\"==\"note\" if not \"%2\"==\"\" goto send\r\n\
         if /i \"%1\"==\"todo\" if not \"%2\"==\"\" goto send\r\n\
         if /i \"%1\"==\"reminder\" if not \"%2\"==\"\" goto send\r\n\
         if /i \"%1\"==\"notes\" set KIND=notes&& goto data\r\n\
         if /i \"%1\"==\"note\" set KIND=notes&& goto data\r\n\
         if /i \"%1\"==\"reminders\" set KIND=reminders&& goto data\r\n\
         if /i \"%1\"==\"reminder\" set KIND=reminders&& goto data\r\n\
         if /i \"%1\"==\"todos\" set KIND=todos&& goto data\r\n\
         if /i \"%1\"==\"todo\" set KIND=todos&& goto data\r\n\
         type \"{banner}\"\r\n\
         goto :eof\r\n\
         :data\r\n\
         if \"%2\"==\"\" (\r\n\
         if exist \"{data}\\%KIND%.ansi\" (type \"{data}\\%KIND%.ansi\") else (echo jky: nothing saved yet. Add something from the Dashboard. 1>&2)\r\n\
         ) else (\r\n\
         if exist \"{data}\\%KIND%\\%2.ansi\" (type \"{data}\\%KIND%\\%2.ansi\") else (echo jky: no %KIND% entry '%2' 1>&2 & if exist \"{data}\\%KIND%.ansi\" type \"{data}\\%KIND%.ansi\" 1>&2)\r\n\
         )\r\n\
         goto :eof\r\n\
         :cmds\r\n\
         type \"{commands}\"\r\n\
         goto :eof\r\n\
         :games\r\n\
         if \"%2\"==\"\" (\r\n\
         if exist \"{data}\\games.ansi\" (type \"{data}\\games.ansi\") else (echo jky: open the Games section once so the listing is written. 1>&2)\r\n\
         ) else (\r\n\
         powershell -NoProfile -Command \"if ('%2' -match '^[1-4]$') {{ [Console]::Write([char]27 + ']{osc};JKYGame=%2' + [char]7) }} else {{ [Console]::Error.WriteLine('jky: no game %2. Choose 1, 2, 3 or 4.'); exit 1 }}\"\r\n\
         )\r\n\
         goto :eof\r\n\
         :send\r\n\
         powershell -NoProfile -Command \"$a = $args; $noun = $a[0].ToLower();          $verb = if ($a.Count -gt 1) {{ $a[1].ToLower() }} else {{ '' }};          $rest = if ($a.Count -gt 2) {{ @($a[2..($a.Count-1)]) }} else {{ @() }};          $map = @{{ 'new'='new'; 'add'='new'; 'write'='write'; 'append'='write';          'rename'='rename'; 'rm'='rm'; 'delete'='rm'; 'del'='rm';          'done'='done'; 'tick'='done'; 'undone'='undone'; 'untick'='undone' }};          if ($noun -eq 'theme' -or $noun -eq 'open' -or $noun -eq 'go') {{          $full = $(if ($noun -eq 'go') {{ 'open' }} else {{ $noun }});          $rest = @($a[1..($a.Count-1)]) }}          else {{ $tail = $map[$verb];          if (-not $tail) {{ [Console]::Error.WriteLine('jky: unknown command'); exit 1 }};          if ($noun -eq 'todo' -and $tail -eq 'new') {{ $tail = 'add' }};          if ($noun -eq 'reminder' -and $tail -eq 'new') {{ $tail = 'add' }};          $full = \"$noun.$tail\" }};          $json = (@{{ verb = $full; args = @($rest) }} | ConvertTo-Json -Compress);          $b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json));          [Console]::Write([char]27 + ']{osc};JKYCmd=' + $b + [char]7)\" %*\r\n\
         goto :eof\r\n\
         :ask\r\n\
         shift\r\n\
         powershell -NoProfile -Command \"$q = $args -join ' '; $b = \
         [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q)); \
         [Console]::Write([char]27 + ']{osc};JKYAsk=' + $b + [char]7)\" %*\r\n",
        osc = ASK_OSC,
        banner = banner_path.display(),
        commands = commands_path.display(),
        data = data_dir.display()
    );
    std::fs::write(script, body)
}

#[cfg(windows)]
fn write_launcher(bin_dir: &Path, name: &str, banner_path: &Path) -> io::Result<()> {
    // .cmd rather than a bare file: cmd.exe and PowerShell only treat an
    // extension in PATHEXT as executable, and a name with no extension is not.
    let script = bin_dir.join(format!("{name}.cmd"));
    let body = format!("@echo off\r\ntype \"{}\"\r\n", banner_path.display());
    std::fs::write(script, body)
}

#[cfg(not(windows))]
fn write_launcher(bin_dir: &Path, name: &str, banner_path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let script = bin_dir.join(name);
    let body = format!("#!/bin/sh\ncat \"{}\"\n", banner_path.display());
    std::fs::write(&script, body)?;
    // Without the execute bit the shell finds the file and refuses to run it,
    // which looks exactly like the command not existing.
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
}

/// Build a PATH with `bin_dir` in front of the inherited one.
///
/// Prepended rather than appended so our launcher wins over a same-named
/// binary elsewhere, and the inherited PATH is preserved so every other
/// command the user relies on still resolves.
pub fn path_with(bin_dir: &Path, inherited: Option<String>) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    match inherited {
        Some(existing) if !existing.is_empty() => {
            format!("{}{}{}", bin_dir.display(), sep, existing)
        }
        _ => bin_dir.display().to_string(),
    }
}

/// Where the launchers live, given the app's config directory.
pub fn launcher_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("bin")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Run an installed launcher, retrying past a fork/exec race.
    ///
    /// When one thread writes an executable while another forks to spawn a
    /// process, the child inherits a duplicate of the still-open write
    /// descriptor, and the kernel refuses to exec the file until it closes —
    /// ETXTBSY, "Text file busy". These tests install scripts and spawn
    /// processes concurrently, so the window is wide enough to hit regularly.
    ///
    /// It is a property of running the tests in parallel, not of the product:
    /// the app writes its launchers once at startup and the user's shell
    /// execs them later, from a different process entirely. Retrying keeps
    /// the assertion honest — the script really is executed — where routing
    /// everything through `sh` would stop proving the execute bit is set.
    #[cfg(not(windows))]
    fn run_script(path: &Path, args: &[&str]) -> std::process::Output {
        const ETXTBSY: i32 = 26;
        for _ in 0..100 {
            match std::process::Command::new(path).args(args).output() {
                Ok(out) => return out,
                Err(e) if e.raw_os_error() == Some(ETXTBSY) => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(e) => panic!("could not run {}: {e}", path.display()),
            }
        }
        panic!("{} stayed busy", path.display());
    }

    /// Run the generated `jky` script and give back (stdout, stderr, ok).
    ///
    /// A shell script checked only by matching strings in its source is not
    /// tested at all — a stray quote or an unbalanced `case` passes every
    /// such check and fails the moment a person types the command.
    #[cfg(not(windows))]
    fn run_jky(dir: &Path, args: &[&str]) -> (String, String, bool) {
        let out = run_script(&dir.join("jky"), args);
        (
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
            out.status.success(),
        )
    }

    #[cfg(not(windows))]
    fn with_listings(dir: &Path) {
        let data = dir.join("data");
        std::fs::create_dir_all(data.join("notes")).unwrap();
        std::fs::write(data.join("notes.ansi"), "NOTES-LISTING").unwrap();
        std::fs::write(data.join("notes").join("a3f2.ansi"), "ONE-NOTE").unwrap();
        std::fs::write(data.join("reminders.ansi"), "REMINDERS-LISTING").unwrap();
        std::fs::write(data.join("todos.ansi"), "TODOS-LISTING").unwrap();
    }

    #[test]
    #[cfg(not(windows))]
    fn the_generated_script_is_valid_shell() {
        // Catches an unbalanced quote or case arm before a user does.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let out = std::process::Command::new("sh")
            .arg("-n")
            .arg(dir.path().join("jky"))
            .output()
            .expect("sh runs");
        assert!(
            out.status.success(),
            "script does not parse: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_games_prints_the_listing() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        std::fs::create_dir_all(dir.path().join("data")).unwrap();
        std::fs::write(dir.path().join("data/games.ansi"), "GAMES-LISTING").unwrap();

        let (stdout, _, ok) = run_jky(dir.path(), &["games"]);
        assert!(ok);
        assert_eq!(stdout, "GAMES-LISTING");
    }

    #[test]
    #[cfg(not(windows))]
    fn both_spellings_of_games_work() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        std::fs::create_dir_all(dir.path().join("data")).unwrap();
        std::fs::write(dir.path().join("data/games.ansi"), "GAMES-LISTING").unwrap();

        for arg in ["games", "game"] {
            let (stdout, stderr, ok) = run_jky(dir.path(), &[arg]);
            assert!(ok, "`jky {arg}` failed: {stderr}");
            assert_eq!(stdout, "GAMES-LISTING", "`jky {arg}`");
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_games_with_a_number_emits_the_open_sequence() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        for n in ["1", "2", "3", "4"] {
            let (stdout, stderr, ok) = run_jky(dir.path(), &["games", n]);
            assert!(ok, "`jky games {n}` failed: {stderr}");
            assert!(stdout.contains(&format!("JKYGame={n}")), "{stdout:?}");
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_games_refuses_a_number_that_is_not_a_game() {
        // Four games, so anything else is a typo rather than a request. It
        // says so instead of emitting a sequence the window would ignore.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        for bad in ["0", "5", "9", "x"] {
            let (stdout, stderr, ok) = run_jky(dir.path(), &["games", bad]);
            assert!(!ok, "`jky games {bad}` should fail");
            assert!(!stdout.contains("JKYGame="), "emitted a sequence for {bad}");
            assert!(stderr.contains("no game"), "{stderr:?}");
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_games_says_what_to_do_when_no_listing_has_been_written() {
        // The listing is written by the window, so before the Games section
        // has ever been opened there is nothing to print.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (_, stderr, ok) = run_jky(dir.path(), &["games"]);
        assert!(!ok);
        assert!(stderr.contains("Games section"), "{stderr:?}");
    }

    /// Decode the base64 JSON a write command emits.
    #[cfg(not(windows))]
    fn sent(stdout: &str) -> String {
        let after = stdout.rsplit("JKYCmd=").next().expect("a command marker");
        let encoded: String = after.chars().take_while(|c| *c != '\u{7}').collect();

        // Minimal base64 decode, so the test does not need a dependency.
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bits = Vec::new();
        for c in encoded.bytes() {
            if c == b'=' {
                break;
            }
            let Some(v) = ALPHABET.iter().position(|a| *a == c) else { continue };
            for shift in (0..6).rev() {
                bits.push((v >> shift) & 1);
            }
        }
        let bytes: Vec<u8> = bits
            .chunks(8)
            .filter(|c| c.len() == 8)
            .map(|c| c.iter().fold(0u8, |acc, b| (acc << 1) | *b as u8))
            .collect();
        String::from_utf8_lossy(&bytes).to_string()
    }

    #[test]
    #[cfg(not(windows))]
    fn a_write_command_sends_its_verb_and_arguments() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (stdout, stderr, ok) = run_jky(dir.path(), &["note", "new", "Shopping list"]);
        assert!(ok, "failed: {stderr}");
        assert_eq!(sent(&stdout), r#"{"verb":"note.new","args":["Shopping list"]}"#);
    }

    #[test]
    #[cfg(not(windows))]
    fn every_write_verb_reaches_the_app() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        for (args, verb) in [
            (vec!["note", "new", "x"], "note.new"),
            (vec!["note", "write", "1", "x"], "note.write"),
            (vec!["note", "rename", "1", "x"], "note.rename"),
            (vec!["note", "rm", "1"], "note.rm"),
            (vec!["todo", "add", "x"], "todo.add"),
            (vec!["todo", "done", "1"], "todo.done"),
            (vec!["todo", "undone", "1"], "todo.undone"),
            (vec!["todo", "rm", "1"], "todo.rm"),
            (vec!["reminder", "add", "07:00", "x"], "reminder.add"),
            (vec!["reminder", "done", "1"], "reminder.done"),
            (vec!["reminder", "rm", "1"], "reminder.rm"),
            (vec!["theme", "nord"], "theme"),
            (vec!["open", "games"], "open"),
        ] {
            let (stdout, stderr, ok) = run_jky(dir.path(), &args);
            assert!(ok, "`jky {}` failed: {stderr}", args.join(" "));
            assert!(
                sent(&stdout).contains(&format!(r#""verb":"{verb}""#)),
                "`jky {}` sent {}",
                args.join(" "),
                sent(&stdout)
            );
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn an_argument_containing_a_quote_stays_one_argument() {
        // The whole reason the payload is JSON inside base64: splitting on a
        // separator would fail the first time anyone wrote one into a note.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (stdout, _, ok) = run_jky(dir.path(), &["note", "new", r#"say "hello" now"#]);
        assert!(ok);
        assert_eq!(
            sent(&stdout),
            r#"{"verb":"note.new","args":["say \"hello\" now"]}"#
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn an_argument_containing_a_backslash_survives() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (stdout, _, ok) = run_jky(dir.path(), &["note", "new", r"C:\path"]);
        assert!(ok);
        assert_eq!(sent(&stdout), r#"{"verb":"note.new","args":["C:\\path"]}"#);
    }

    #[test]
    #[cfg(not(windows))]
    fn several_words_stay_several_arguments() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (stdout, _, ok) = run_jky(dir.path(), &["reminder", "add", "07:00", "Go for a run"]);
        assert!(ok);
        assert_eq!(
            sent(&stdout),
            r#"{"verb":"reminder.add","args":["07:00","Go for a run"]}"#
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn a_bare_singular_still_lists() {
        // `jky note` with no verb should print the listing, the way it always
        // did, rather than becoming an error now that verbs exist.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        let (stdout, stderr, ok) = run_jky(dir.path(), &["note"]);
        assert!(ok, "failed: {stderr}");
        assert_eq!(stdout, "NOTES-LISTING");
    }

    #[test]
    #[cfg(not(windows))]
    fn a_singular_with_a_number_still_reads_one() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        let (stdout, stderr, ok) = run_jky(dir.path(), &["note", "a3f2"]);
        assert!(ok, "failed: {stderr}");
        assert_eq!(stdout, "ONE-NOTE");
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_notes_prints_the_listing() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        let (stdout, _, ok) = run_jky(dir.path(), &["notes"]);
        assert!(ok);
        assert_eq!(stdout, "NOTES-LISTING");
    }

    #[test]
    #[cfg(not(windows))]
    fn both_spellings_of_each_listing_work() {
        // People type what they remember, singular or plural.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        for (arg, expected) in [
            ("notes", "NOTES-LISTING"),
            ("note", "NOTES-LISTING"),
            ("reminders", "REMINDERS-LISTING"),
            ("reminder", "REMINDERS-LISTING"),
            ("todos", "TODOS-LISTING"),
            ("todo", "TODOS-LISTING"),
        ] {
            let (stdout, stderr, ok) = run_jky(dir.path(), &[arg]);
            assert!(ok, "`jky {arg}` failed: {stderr}");
            assert_eq!(stdout, expected, "`jky {arg}`");
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_notes_with_an_id_prints_that_note() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        let (stdout, _, ok) = run_jky(dir.path(), &["notes", "a3f2"]);
        assert!(ok);
        assert_eq!(stdout, "ONE-NOTE");
    }

    #[test]
    #[cfg(not(windows))]
    fn an_unknown_id_fails_and_shows_the_list_instead() {
        // Failing silently would leave someone retyping a handle that cannot
        // work; showing the list puts the real ones in front of them.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();
        with_listings(dir.path());

        let (_, stderr, ok) = run_jky(dir.path(), &["notes", "nope"]);
        assert!(!ok, "an unknown id should be an error");
        assert!(stderr.contains("no notes entry 'nope'"), "{stderr}");
        assert!(stderr.contains("NOTES-LISTING"), "{stderr}");
    }

    #[test]
    #[cfg(not(windows))]
    fn asking_before_anything_is_saved_says_so() {
        // No listing files exist yet on a first run.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        let (_, stderr, ok) = run_jky(dir.path(), &["notes"]);
        assert!(!ok);
        assert!(stderr.contains("Dashboard"), "{stderr}");
    }

    #[test]
    #[cfg(not(windows))]
    fn the_older_commands_still_work() {
        // The new case arms sit alongside these; a mistake in one would
        // swallow the others.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "BANNER", "COMMANDS").unwrap();

        assert_eq!(run_jky(dir.path(), &[]).0, "BANNER");
        assert_eq!(run_jky(dir.path(), &["banner"]).0, "BANNER");
        assert_eq!(run_jky(dir.path(), &["commands"]).0, "COMMANDS");
        assert!(run_jky(dir.path(), &["ask", "how do I list files"]).0.contains("JKYAsk="));
    }

    #[test]
    fn every_spelling_of_the_command_is_installed() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();

        for name in LAUNCHER_NAMES {
            let unix = dir.path().join(name);
            let windows = dir.path().join(format!("{name}.cmd"));
            assert!(
                unix.is_file() || windows.is_file(),
                "no launcher installed for '{name}'"
            );
        }
    }

    #[test]
    fn the_banner_is_written_verbatim() {
        let dir = TempDir::new().unwrap();
        let banner = "\u{1b}[38;2;0;229;255m█\u{1b}[0m\r\n";
        install_launchers(dir.path(), banner, "COMMAND-LIST").unwrap();

        let written = std::fs::read_to_string(dir.path().join(BANNER_FILE)).unwrap();
        assert_eq!(written, banner, "escape sequences must survive intact");
    }

    #[test]
    fn the_launcher_directory_is_created_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("deep/deeper/bin");
        install_launchers(&nested, "hello", "COMMAND-LIST").unwrap();
        assert!(nested.is_dir());
    }

    #[test]
    fn installing_twice_overwrites_rather_than_failing() {
        // The banner changes with the theme, so this runs on every spawn.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "first", "c1").unwrap();
        install_launchers(dir.path(), "second", "c2").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(BANNER_FILE)).unwrap(),
            "second"
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn the_unix_launcher_is_executable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();

        let mode = std::fs::metadata(dir.path().join("jky-terminal"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "launcher is not executable");
    }

    #[test]
    #[cfg(not(windows))]
    fn the_unix_launcher_actually_prints_the_banner() {
        // The point of the whole module. If this fails, typing the command
        // does nothing useful no matter how correct the rest looks.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "JKY-BANNER-MARKER", "COMMAND-LIST").unwrap();

        // Through `run_script`, which retries on ETXTBSY. Executing the file
        // directly is the point of this test, and doing that from a process
        // that is forking shells on other threads loses a race often enough
        // to fail CI — which is exactly what it did.
        let out = run_script(&dir.path().join("jky-terminal"), &[]);
        assert_eq!(String::from_utf8_lossy(&out.stdout), "JKY-BANNER-MARKER");
    }

    #[test]
    fn the_jky_command_is_installed() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "hello", "COMMAND-LIST").unwrap();
        assert!(
            dir.path().join("jky").is_file() || dir.path().join("jky.cmd").is_file(),
            "the jky command is missing"
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_ask_emits_an_osc_sequence_carrying_the_question() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = run_script(&dir.path().join("jky"), &["ask", "what", "does", "ls", "do"]);
        let stdout = String::from_utf8_lossy(&out.stdout);

        assert!(stdout.contains("JKYAsk="), "no ask marker in: {stdout:?}");
        assert!(stdout.starts_with('\u{1b}'), "the sequence must start with ESC");

        // The question survives the round trip through base64.
        let encoded = stdout
            .trim_end_matches('\u{7}')
            .rsplit("JKYAsk=")
            .next()
            .unwrap();
        let decoded = String::from_utf8(base64_decode(encoded)).unwrap();
        assert_eq!(decoded, "what does ls do");
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_asks_is_accepted_as_well_as_jky_ask() {
        // People type what they remember, and both readings are natural.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = run_script(&dir.path().join("jky"), &["asks", "hello"]);
        assert!(String::from_utf8_lossy(&out.stdout).contains("JKYAsk="));
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_ask_with_no_question_explains_itself_instead_of_emitting_nothing() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "COMMAND-LIST").unwrap();

        let out = run_script(&dir.path().join("jky"), &["ask"]);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("usage"));
    }

    #[test]
    #[cfg(not(windows))]
    fn bare_jky_prints_the_banner() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "THE-BANNER", "COMMAND-LIST").unwrap();

        let out = run_script(&dir.path().join("jky"), &[]);
        assert_eq!(String::from_utf8_lossy(&out.stdout), "THE-BANNER");
    }

    /// Minimal base64 decoder, so the test verifies the payload rather than
    /// trusting that the encoder and decoder agree.
    #[cfg(not(windows))]
    fn base64_decode(input: &str) -> Vec<u8> {
        const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new();
        let mut buf = 0u32;
        let mut bits = 0u32;
        for ch in input.bytes().filter(|c| *c != b'=' && !c.is_ascii_whitespace()) {
            let Some(idx) = TABLE.iter().position(|c| *c == ch) else {
                continue;
            };
            buf = (buf << 6) | idx as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        out
    }

    #[test]
    #[cfg(not(windows))]
    fn jky_commands_prints_the_command_list() {
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "THE-COMMAND-LIST").unwrap();

        for spelling in ["commands", "command", "help"] {
            let out = run_script(&dir.path().join("jky"), &[spelling]);
            assert_eq!(
                String::from_utf8_lossy(&out.stdout),
                "THE-COMMAND-LIST",
                "`jky {spelling}` did not print the list"
            );
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn an_unknown_subcommand_shows_the_list_rather_than_a_bare_error() {
        // Being told a command does not exist, without being told what does,
        // is the least useful possible response.
        let dir = TempDir::new().unwrap();
        install_launchers(dir.path(), "banner", "THE-COMMAND-LIST").unwrap();

        let out = run_script(&dir.path().join("jky"), &["nonsense"]);
        assert!(!out.status.success());
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(stderr.contains("unknown command"));
        assert!(stderr.contains("THE-COMMAND-LIST"));
    }

    #[test]
    fn our_directory_comes_first_on_the_path() {
        let dir = TempDir::new().unwrap();
        let sep = if cfg!(windows) { ";" } else { ":" };
        let path = path_with(dir.path(), Some(format!("/usr/bin{sep}/bin")));
        assert!(path.starts_with(&dir.path().display().to_string()));
        assert!(path.contains("/usr/bin"), "inherited PATH must be preserved");
    }

    #[test]
    fn an_absent_inherited_path_still_yields_our_directory() {
        let dir = TempDir::new().unwrap();
        assert_eq!(path_with(dir.path(), None), dir.path().display().to_string());
        assert_eq!(
            path_with(dir.path(), Some(String::new())),
            dir.path().display().to_string()
        );
    }

    #[test]
    fn the_launcher_directory_sits_under_the_config_directory() {
        assert_eq!(
            launcher_dir(Path::new("/cfg/jky")),
            PathBuf::from("/cfg/jky/bin")
        );
    }
}
