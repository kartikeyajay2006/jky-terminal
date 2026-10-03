//! Reproducible measurements of the parts of a terminal that can be timed
//! without a screen.
//!
//! Ignored, so it never gates CI: these are numbers about a machine, not
//! pass/fail facts about the code. Run it the way `docs/benchmarks.md` was
//! produced:
//!
//! ```sh
//! cargo build --release -p jky-terminal
//! cargo test --release -p jky-terminal --test bench -- --ignored --nocapture --test-threads=1
//! ```
//!
//! What it measures, and only what it measures:
//!
//! - **first output** — spawning an interactive shell in a pty until its first
//!   byte (the prompt) arrives;
//! - **keystroke round trip** — one byte written to the pty until its echo is
//!   read back: the latency the terminal itself adds before anything paints;
//! - **throughput** — a million lines through a pty, every one counted;
//! - **held shell** — starting a supervisor process and attaching, and
//!   rejoining one that is already running: what opening a pane and
//!   relaunching the app cost;
//! - **memory** — resident size of one supervisor holding a shell, and of
//!   twenty at once.
//!
//! What it does not measure: the window's cold start, how long a frame takes
//! to paint, or input latency through the webview. Those need a screen and are
//! not claimed by any number this prints.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use jky_detach::{join, open, Joined};
use jky_pty::{PtySession, ShellSpec, SpawnConfig};

fn binary() -> PathBuf {
    let mut path = std::env::current_exe().expect("this test's own path");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.join(if cfg!(windows) { "jky-terminal.exe" } else { "jky-terminal" })
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("jky-bench-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

fn shell() -> ShellSpec {
    if cfg!(windows) {
        ShellSpec { program: "powershell.exe".into(), args: vec!["-NoLogo".into(), "-NoProfile".into()] }
    } else {
        ShellSpec { program: "/bin/sh".into(), args: vec!["-i".into()] }
    }
}

fn spawn(spec: ShellSpec) -> PtySession {
    PtySession::spawn(SpawnConfig {
        shell: spec,
        cwd: std::env::temp_dir(),
        cols: 120,
        rows: 40,
        path_prepend: None,
        config_dir: None,
    })
    .expect("a pty")
}

/// Every chunk the pty produces, as it arrives.
fn chunks(session: &PtySession) -> mpsc::Receiver<Vec<u8>> {
    let mut reader = session.take_reader().expect("a reader");
    let (send, recv) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = [0u8; 64 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || send.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    recv
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Median and 99th percentile, in milliseconds.
fn spread(mut samples: Vec<Duration>) -> (f64, f64) {
    samples.sort();
    let at = |q: f64| ms(samples[((samples.len() - 1) as f64 * q).round() as usize]);
    (at(0.5), at(0.99))
}

fn first_output() -> (f64, f64) {
    let samples = (0..15)
        .map(|_| {
            let started = Instant::now();
            let session = spawn(shell());
            let recv = chunks(&session);
            recv.recv_timeout(Duration::from_secs(10)).expect("a prompt");
            let took = started.elapsed();
            let _ = session.kill();
            took
        })
        .collect();
    spread(samples)
}

fn keystroke_round_trip() -> (f64, f64) {
    let session = spawn(shell());
    let recv = chunks(&session);
    // Let the prompt arrive and settle, so it is not counted as an echo.
    std::thread::sleep(Duration::from_millis(800));
    while recv.try_recv().is_ok() {}

    let mut samples = Vec::new();
    for i in 0..300 {
        let key = b'a' + (i % 26) as u8;
        let started = Instant::now();
        session.write(&[key]).expect("type");
        loop {
            let chunk = recv.recv_timeout(Duration::from_secs(5)).expect("an echo");
            if chunk.contains(&key) {
                break;
            }
        }
        samples.push(started.elapsed());
    }
    let _ = session.kill();
    spread(samples)
}

fn throughput() -> (f64, usize) {
    const LINES: usize = 1_000_000;
    let spec = if cfg!(windows) {
        ShellSpec {
            program: "powershell.exe".into(),
            args: vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                format!("$s = [Console]::OpenStandardOutput(); $b = [Text.Encoding]::ASCII.GetBytes(('JKY_BENCH_LINE' + [char]10) * {LINES}); $s.Write($b, 0, $b.Length)"),
            ],
        }
    } else {
        ShellSpec {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), format!("yes JKY_BENCH_LINE | head -n {LINES}")],
        }
    };
    let session = spawn(spec);
    let recv = chunks(&session);
    let started = Instant::now();
    let (mut bytes, mut lines) = (0usize, 0usize);
    while lines < LINES {
        let Ok(chunk) = recv.recv_timeout(Duration::from_secs(30)) else { break };
        bytes += chunk.len();
        lines += chunk.iter().filter(|b| **b == b'\n').count();
    }
    let seconds = started.elapsed().as_secs_f64();
    assert_eq!(lines, LINES, "output was lost");
    (bytes as f64 / (1024.0 * 1024.0) / seconds, lines)
}

/// A supervisor that is killed when the bench ends, however it ends.
struct Held(Option<Child>);
impl Drop for Held {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn start_held(exe: &Path, config: &Path, name: &str) -> Held {
    let child = Command::new(exe)
        .arg("--supervise")
        .arg(name)
        .arg("--config-dir")
        .arg(config)
        .arg("--cwd")
        .arg(config)
        .spawn()
        .expect("a supervisor");
    Held(Some(child))
}

fn resident_kib(pid: u32) -> Option<u64> {
    if cfg!(target_os = "linux") {
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        let line = status.lines().find(|l| l.starts_with("VmRSS:"))?;
        line.split_whitespace().nth(1)?.parse().ok()
    } else if cfg!(target_os = "macos") {
        let out = Command::new("ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse().ok()
    } else {
        None
    }
}

/// Memory only this process holds — its private pages — in KiB. Linux only.
///
/// Resident size counts every shared library page each process maps, and a
/// supervisor is the app's own binary, linked against the GUI toolkit it never
/// opens. Those pages are shared by every supervisor and the window alike, so
/// the private figure is what each additional held shell actually costs.
fn private_kib(pid: u32) -> Option<u64> {
    let rollup = std::fs::read_to_string(format!("/proc/{pid}/smaps_rollup")).ok()?;
    let field = |name: &str| -> u64 {
        rollup
            .lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    };
    Some(field("Private_Clean:") + field("Private_Dirty:"))
}

#[test]
#[ignore = "prints measurements of this machine; see docs/benchmarks.md"]
fn measure() {
    let exe = binary();
    assert!(exe.exists(), "build the binary first: cargo build --release -p jky-terminal");

    let (first_p50, first_p99) = first_output();
    let (key_p50, key_p99) = keystroke_round_trip();
    let (mib_s, lines) = throughput();

    // A held shell: start a supervisor and attach — what opening a pane costs.
    let config = scratch("held");
    let dir = config.join("detached");
    let mut opens = Vec::new();
    let mut rejoins = Vec::new();
    let mut held = Vec::new();
    for i in 0..10 {
        let name = format!("bench-{i}");
        let started = Instant::now();
        let mut child = None;
        let opened = open(
            &dir,
            &name,
            || {
                child = Some(start_held(&exe, &config, &name));
                Ok(())
            },
            Duration::from_secs(10),
        )
        .expect("a held shell opens");
        opens.push(started.elapsed());
        opened.client.detach().ok();
        drop(opened);
        held.push(child.expect("started"));

        // Rejoining it — what relaunching the app costs, per pane.
        let started = Instant::now();
        loop {
            match join(&dir, &name) {
                Joined::Attached { client, .. } => {
                    rejoins.push(started.elapsed());
                    client.detach().ok();
                    break;
                }
                Joined::Busy => std::thread::sleep(Duration::from_millis(2)),
                other => panic!("rejoin failed: {}", matches!(other, Joined::Absent)),
            }
        }
    }
    let (open_p50, open_p99) = spread(opens);
    let (rejoin_p50, rejoin_p99) = spread(rejoins);
    let one = held[0].0.as_ref().and_then(|c| resident_kib(c.id()));
    let one_private = held[0].0.as_ref().and_then(|c| private_kib(c.id()));

    // Twenty at once, the way a large layout comes back.
    for i in 10..20 {
        let name = format!("bench-{i}");
        let mut child = None;
        let opened = open(
            &dir,
            &name,
            || {
                child = Some(start_held(&exe, &config, &name));
                Ok(())
            },
            Duration::from_secs(10),
        )
        .expect("a held shell opens");
        opened.client.detach().ok();
        held.push(child.expect("started"));
    }
    let twenty_private: Option<u64> = held
        .iter()
        .map(|h| h.0.as_ref().and_then(|c| private_kib(c.id())))
        .sum();

    let mem = |k: Option<u64>| k.map(|k| format!("{:.1} MiB", k as f64 / 1024.0)).unwrap_or("not measured on this OS".into());
    println!("\n| Measurement | Median | p99 |");
    println!("|---|---|---|");
    println!("| First output from a new shell | {first_p50:.1} ms | {first_p99:.1} ms |");
    println!("| Keystroke round trip through the pty | {key_p50:.3} ms | {key_p99:.3} ms |");
    println!("| Open a held shell (start supervisor + attach) | {open_p50:.1} ms | {open_p99:.1} ms |");
    println!("| Rejoin a held shell | {rejoin_p50:.2} ms | {rejoin_p99:.2} ms |");
    println!("\n| Measurement | Result |");
    println!("|---|---|");
    println!("| Throughput, {lines} lines, none lost | {mib_s:.1} MiB/s |");
    println!("| Memory one held shell adds — private to its supervisor | {} |", mem(one_private));
    println!("| Memory twenty held shells add — private, all supervisors | {} |", mem(twenty_private));
    println!("| Resident size of one supervisor, shared libraries included | {} |", mem(one));

    drop(held);
    let _ = std::fs::remove_dir_all(&config);
}
