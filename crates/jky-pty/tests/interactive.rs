//! A real shell, driven the way a person drives it.
//!
//! `stress.rs` and `throughput.rs` prove output: a program writing faster than
//! anything can paint. This proves the other direction and the conversation
//! between them — keystrokes reaching an interactive shell through a real
//! pty, the shell answering, a resize reaching the program in the
//! foreground, Ctrl+C interrupting it, a large paste arriving whole, text
//! outside ASCII surviving the round trip, and an exit status reaching the
//! window. Each is a place a terminal can be quietly wrong while every unit
//! test passes.
//!
//! Every check waits for an answer the shell had to *compute* — `JKY_$((40+2))`
//! must come back as `JKY_42` — so the terminal echoing what was typed can
//! never pass for the shell having run it.

use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use jky_pty::{PtySession, ShellSpec, SpawnConfig};

const PATIENCE: Duration = Duration::from_secs(20);

/// A shell, and everything it has printed so far.
struct Driven {
    session: PtySession,
    seen: Arc<Mutex<Vec<u8>>>,
}

impl Driven {
    fn start(shell: ShellSpec, cols: u16, rows: u16) -> Self {
        Self::start_with_path(shell, cols, rows, None)
    }

    /// A shell with `dir` first on its PATH, the way the app puts its own
    /// commands in front of every shell it starts.
    fn start_with_path(shell: ShellSpec, cols: u16, rows: u16, path_prepend: Option<std::path::PathBuf>) -> Self {
        let session = PtySession::spawn(SpawnConfig {
            shell,
            cwd: std::env::temp_dir(),
            cols,
            rows,
            path_prepend,
            config_dir: None,
        })
        .expect("a shell starts in a pty");

        // Read continuously, on a thread of its own. A shell echoing a large
        // paste fills the pty's buffer, and a test that wrote without reading
        // would deadlock against it — which is exactly what a window must
        // never do either.
        let mut reader = session.take_reader().expect("one reader");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        });
        Self { session, seen }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.seen.lock().unwrap()).into_owned()
    }

    fn type_line(&self, line: &str) {
        // A carriage return, which is what a terminal sends for Enter.
        self.session.write(format!("{line}\r").as_bytes()).expect("type");
    }

    /// Wait until everything printed so far contains `needle`.
    fn wait_for(&self, needle: &str) -> bool {
        let until = Instant::now() + PATIENCE;
        while Instant::now() < until {
            if self.text().contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn report(&self) -> String {
        let text = self.text();
        let tail: String = text.chars().rev().take(1500).collect::<Vec<_>>().into_iter().rev().collect();
        format!("…{tail}")
    }
}

#[cfg(not(windows))]
fn interactive() -> ShellSpec {
    // `-i`: the shell a person gets — prompts, job control, line editing —
    // rather than one running a script.
    ShellSpec { program: "/bin/sh".into(), args: vec!["-i".into()] }
}

#[cfg(windows)]
fn interactive() -> ShellSpec {
    ShellSpec {
        program: "powershell.exe".into(),
        // Interactive, as a person runs it: no `-Command`, which would make
        // it a script reader rather than a shell at a prompt.
        args: vec!["-NoLogo".into(), "-NoProfile".into()],
    }
}

#[test]
#[cfg(not(windows))]
fn what_is_typed_is_run_and_the_answer_comes_back() {
    let shell = Driven::start(interactive(), 80, 24);
    shell.type_line("echo JKY_$((40+2))");
    assert!(shell.wait_for("JKY_42"), "the shell never answered: {}", shell.report());
}

#[test]
#[cfg(windows)]
fn what_is_typed_is_run_and_the_answer_comes_back() {
    let shell = Driven::start(interactive(), 80, 24);
    shell.type_line("[Console]::Out.WriteLine('JKY_' + (40 + 2))");
    assert!(shell.wait_for("JKY_42"), "the shell never answered: {}", shell.report());
}

#[test]
#[cfg(not(windows))]
fn a_resize_reaches_the_program_in_the_foreground() {
    let shell = Driven::start(interactive(), 80, 24);
    shell.type_line("stty size | sed 's/^/SIZE_/'");
    assert!(shell.wait_for("SIZE_24 80"), "the starting size was wrong: {}", shell.report());

    shell.session.resize(132, 43).expect("resize");
    shell.type_line("stty size | sed 's/^/SIZE_/'");
    assert!(shell.wait_for("SIZE_43 132"), "the new size never arrived: {}", shell.report());
}

#[test]
#[cfg(not(windows))]
fn ctrl_c_interrupts_what_is_running_and_the_shell_carries_on() {
    let shell = Driven::start(interactive(), 80, 24);
    // `sleep` on its own. Whether a shell runs the rest of a `;` list after
    // an interrupted command is the shell's choice — macOS's /bin/sh does,
    // Linux's does not — and not something a terminal decides. What the
    // terminal owns is delivering Ctrl+C, and the time it takes to come back
    // proves that.
    shell.type_line("sleep 30");
    std::thread::sleep(Duration::from_millis(400));
    let asked = Instant::now();
    shell.session.write(b"\x03").expect("Ctrl+C");
    shell.type_line("echo AFTER_$((2+3))");
    assert!(shell.wait_for("AFTER_5"), "the shell did not come back: {}", shell.report());
    assert!(asked.elapsed() < Duration::from_secs(10), "it waited for the sleep instead");
}

#[test]
#[cfg(not(windows))]
fn a_large_paste_arrives_whole() {
    // 2,000 lines of 99 characters and a newline: what pasting a log file
    // looks like. Lines stay under every platform's canonical-mode limit, so
    // what is measured is the pty, not the line discipline's own cap.
    const LINES: usize = 2_000;
    let shell = Driven::start(interactive(), 80, 24);
    // No echo, so the paste does not come straight back as output.
    shell.type_line("stty -echo; wc -c | sed 's/^ */BYTES_/'");
    std::thread::sleep(Duration::from_millis(300));

    let line = format!("{}\n", "x".repeat(99));
    let paste = line.repeat(LINES);
    for chunk in paste.as_bytes().chunks(4096) {
        shell.session.write(chunk).expect("paste");
    }
    // Ctrl+D ends wc's input.
    shell.session.write(b"\x04").expect("end of input");
    let want = format!("BYTES_{}", LINES * 100);
    assert!(shell.wait_for(&want), "the paste did not arrive whole: {}", shell.report());
}

#[test]
#[cfg(not(windows))]
fn text_beyond_ascii_survives_the_round_trip() {
    let shell = Driven::start(interactive(), 80, 24);
    // Accents, CJK, an emoji outside the BMP, and a combining mark: each a
    // different way bytes and characters stop being the same thing.
    let text = "héllo 日本語 🚀 e\u{301}";
    shell.type_line(&format!("printf 'UNI<%s>\\n' '{text}'"));
    assert!(shell.wait_for(&format!("UNI<{text}>")), "it came back altered: {}", shell.report());
}

#[test]
#[cfg(not(windows))]
fn the_exit_status_reaches_the_window() {
    let shell = Driven::start(interactive(), 80, 24);
    shell.type_line("exit 7");
    assert_eq!(shell.session.wait().expect("the shell exits"), 7);
}

#[test]
#[cfg(windows)]
fn the_exit_status_reaches_the_window() {
    let shell = Driven::start(interactive(), 80, 24);
    shell.type_line("exit 7");
    assert_eq!(shell.session.wait().expect("the shell exits"), 7);
}

#[test]
#[cfg(windows)]
fn jky_banner_draws_its_unicode_in_a_windows_console() {
    // In a real console, not through a pipe, because only a console garbles
    // it: a console reads the bytes a program writes in its own code page —
    // 437 on most machines — so a banner written as UTF-8 came out as "Γûê"
    // for every "█". On macOS and Linux the pty is UTF-8 throughout.
    let config = tempfile::TempDir::new().expect("a config folder");
    let bin = jky_pty::launcher_dir(config.path());
    jky_pty::install_launchers(&bin, "BANNER<█╗║╔╝═╚─✦>", "COMMANDS<█>", None).expect("launchers");
    let shell = Driven::start_with_path(interactive(), 120, 30, Some(bin));
    // The code page a console starts in on most machines, whatever this
    // runner happens to be set to.
    shell.type_line("[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437)");
    // The marker is split where it is typed, so the shell echoing the
    // command can never pass for its answer.
    shell.type_line("[Console]::Out.WriteLine('CP' + 'BEFORE_' + [Console]::OutputEncoding.CodePage + '_')");
    assert!(shell.wait_for("CPBEFORE_"), "{}", shell.report());

    shell.type_line("jky banner");
    assert!(shell.wait_for("BANNER<█╗║╔╝═╚─✦>"), "`jky banner` came out garbled: {}", shell.report());

    shell.type_line("jky commands");
    assert!(shell.wait_for("COMMANDS<█>"), "`jky commands` came out garbled: {}", shell.report());

    // `jky-terminal` prints the same banner by another name.
    shell.type_line("jky-terminal");
    let until = Instant::now() + PATIENCE;
    while shell.text().matches("BANNER<█╗║╔╝═╚─✦>").count() < 2 && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        shell.text().matches("BANNER<█╗║╔╝═╚─✦>").count() >= 2,
        "`jky-terminal` came out garbled: {}",
        shell.report()
    );
    assert!(!shell.text().contains("Γûê"), "UTF-8 was read as code page 437: {}", shell.report());

    // The console's code page is the person's, and is left as it was found.
    shell.type_line("[Console]::Out.WriteLine('CP' + 'AFTER_' + [Console]::OutputEncoding.CodePage + '_')");
    assert!(shell.wait_for("CPAFTER_"), "{}", shell.report());
    let code_page = |marker: &str| {
        let text = shell.text();
        let at = text.find(marker).expect("the marker") + marker.len();
        text[at..].chars().take_while(char::is_ascii_digit).collect::<String>()
    };
    let (before, after) = (code_page("CPBEFORE_"), code_page("CPAFTER_"));
    assert!(!before.is_empty(), "no code page was printed: {}", shell.report());
    assert_eq!(before, after, "the console's code page was changed and not put back");
}
