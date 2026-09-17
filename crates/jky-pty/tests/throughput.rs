//! A repeatable PTY throughput probe.
//!
//! This is deliberately an ignored test: its result is a machine measurement,
//! not a CI pass/fail threshold. Run it with:
//!
//! `cargo test -p jky-pty --test throughput -- --ignored --nocapture`
//!
//! What *is* non-negotiable is losslessness. The probe writes a known number
//! of newline-delimited records through a real PTY, reads every one back, and
//! prints the achieved MiB/s for comparisons between releases.

use std::io::Read;
use std::time::{Duration, Instant};

use jky_pty::{PtySession, ShellSpec, SpawnConfig};

const LINES: usize = 100_000;
const MARKER: &str = "JKY_PTY_THROUGHPUT";

fn writer_shell() -> ShellSpec {
    #[cfg(windows)]
    {
        ShellSpec {
            program: "powershell.exe".into(),
            args: vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                format!("1..{LINES} | ForEach-Object {{ [Console]::WriteLine('{MARKER}') }}"),
            ],
        }
    }

    #[cfg(not(windows))]
    {
        ShellSpec {
            program: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                format!("i=0; while [ $i -lt {LINES} ]; do printf '{MARKER}\\n'; i=$((i+1)); done"),
            ],
        }
    }
}

fn config() -> SpawnConfig {
    SpawnConfig {
        shell: writer_shell(),
        cwd: std::env::temp_dir(),
        cols: 120,
        rows: 40,
        path_prepend: None,
        config_dir: None,
    }
}

#[test]
#[ignore = "prints a host-specific throughput measurement"]
fn reports_lossless_pty_throughput() {
    let session = PtySession::spawn(config()).expect("spawn PTY writer");
    let mut reader = session.take_reader().expect("take PTY reader");
    let started = Instant::now();
    let deadline = started + Duration::from_secs(30);
    let mut bytes = 0usize;
    let mut records = 0usize;
    let mut pending = String::new();
    let mut buffer = [0u8; 16 * 1024];

    while records < LINES && Instant::now() < deadline {
        let read = reader.read(&mut buffer).expect("read PTY output");
        if read == 0 {
            break;
        }
        bytes += read;
        pending.push_str(&String::from_utf8_lossy(&buffer[..read]));
        while let Some(end) = pending.find('\n') {
            let line = pending[..end].trim_end_matches('\r');
            if line == MARKER {
                records += 1;
            }
            pending.drain(..=end);
        }
    }

    let seconds = started.elapsed().as_secs_f64();
    let mib_per_second = bytes as f64 / (1024.0 * 1024.0) / seconds.max(f64::MIN_POSITIVE);
    eprintln!(
        "jky-pty: {records}/{LINES} records, {bytes} bytes in {seconds:.3}s ({mib_per_second:.2} MiB/s)"
    );
    assert_eq!(records, LINES, "PTY output was truncated or corrupted");
}
