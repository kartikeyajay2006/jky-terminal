//! Cross-platform regressions for the failure mode normal terminal demos miss:
//! a program that writes faster than a UI can paint.

use std::io::Read;
use std::time::{Duration, Instant};

use jky_pty::{PtySession, ShellSpec, SpawnConfig};

const LINES: usize = 25_000;
const START: &str = "JKY_STRESS_START";
const BODY: &str = "JKY_STRESS_BODY";
const END: &str = "JKY_STRESS_END";

fn stress_shell() -> ShellSpec {
    #[cfg(windows)]
    {
        ShellSpec {
            // `cmd` parses a `for` body differently depending on whether it
            // was launched from a batch file or a direct CreateProcess call.
            // That made the old loop print only a tiny prefix on GitHub's
            // Windows runner and turned a transport test into a shell-parser
            // test. PowerShell is present on every Windows version we ship
            // to and gives the PTY one unambiguous writer.
            program: "powershell.exe".into(),
            args: vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                format!(
                    "[Console]::WriteLine('{START}'); 1..{LINES} | ForEach-Object {{ [Console]::WriteLine('{BODY}') }}; [Console]::WriteLine('{END}')"
                ),
            ],
        }
    }

    #[cfg(not(windows))]
    {
        ShellSpec {
            program: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                format!("printf '{START}\\n'; i=0; while [ $i -lt {LINES} ]; do printf '{BODY}\\n'; i=$((i+1)); done; printf '{END}\\n'"),
            ],
        }
    }
}

#[test]
fn streams_a_large_burst_without_losing_its_boundaries_or_records() {
    let session = PtySession::spawn(SpawnConfig {
        shell: stress_shell(),
        cwd: std::env::temp_dir(),
        cols: 120,
        rows: 40,
        path_prepend: None,
        config_dir: None,
    })
    .expect("spawn stress writer");
    let mut reader = session.take_reader().expect("take reader");
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut output = String::new();
    let mut buffer = [0u8; 16 * 1024];

    while !output.contains(END) && Instant::now() < deadline {
        let read = reader.read(&mut buffer).expect("read output");
        if read == 0 {
            break;
        }
        output.push_str(&String::from_utf8_lossy(&buffer[..read]));
    }

    assert!(output.contains(START), "the beginning of a burst was lost");
    assert!(output.contains(END), "the end of a burst was lost");
    assert_eq!(
        output.matches(BODY).count(),
        LINES,
        "the PTY dropped or duplicated output during a large burst"
    );
}
