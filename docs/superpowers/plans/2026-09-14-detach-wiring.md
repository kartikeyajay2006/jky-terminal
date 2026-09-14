# JKY Terminal — Plan 5: Terminals That Outlive the Window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every local terminal runs under a supervisor, so closing the window leaves its shells running and reopening the app reattaches each pane to its shell, with what it missed.

**Architecture:** `jky-detach` already has the wire format, the replay, the socket and the supervisor loop, and the binary already runs as a supervisor under `--supervise`. This plan adds the window's half: a hang-up frame, a client that joins or starts a session, a registry of held sessions, and IPC that routes a pane's terminal through it. A terminal *unmounting* now only lets go of its shell; *closing* a pane or tab ends it; startup prunes sessions no pane claims.

**Tech Stack:** Rust (workspace, `interprocess` 2.4, `portable-pty`) · Tauri 2 · React 18 · Zustand 5 · Vitest

**Spec:** No separate spec. The design is argued in commits `4826561`…`f8b5d0d` (the `detach` series) and settled in **Design** below, including the two decisions the maintainer made on 2026-09-14.

## Global Constraints

- **Every shell survives the window**, like tmux. Closing a pane or tab ends its shell. (Maintainer decision, 2026-09-14.)
- **Built on the branch `feat/detach-wiring`**; merged to `main` only after CI is green on `ubuntu-latest`, `macos-latest` and `windows-latest`. Merge by fast-forward, locally, so every commit keeps its author and committer. (Maintainer decision, 2026-09-14.)
- **Commit attribution:** every commit is `kartikeyajay2006 <kartikeyajay2006@gmail.com>`, author and committer. No `Co-Authored-By`, no generated-with notice, in commits or in the PR.
- **The window can ask; only Rust can act.** Real logic in `crates/`; `apps/desktop/src-tauri/src/commands/` stays thin.
- **Every native capability goes through `apps/desktop/src/platform/`.**
- **The pinned IPC list** in `apps/desktop/src-tauri/tests/security.rs` changes only with a written justification per entry.
- **Cross-platform is a hard requirement.** Every OS-specific line is `#[cfg]`-gated and has a path on all three.
- **Remote (ssh) terminals are out of scope.** They stay children of the window and still make quitting ask.
- Verification: `pnpm run verify`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`.

---

## Design

**Session names are pane ids.** A pane id (`tab-N`, `pane-N`) is stable across restarts — it is already the scrollback key — and already passes `jky_detach::check`'s allow-list. The window sends it; Rust validates it; an id that fails validation gets an ordinary window-owned shell.

**Unmounting is not closing.** React unmounts a terminal for reasons that are not the user closing it: StrictMode's double mount in development, a spawn cancelled mid-flight. So the effect's teardown calls `pty.release(id)`, which *detaches* a held session and kills only a window-owned one. Ending a shell is explicit: `tabStore.closePane` / `closeTab` call `pty.end(paneId)`, beside the `scrollback.forget` they already make. At startup, `App` calls `pty.prune(allPaneKeys)` beside `scrollback.prune`.

**Joining is a handshake.** A supervisor answers a connection with a `Replay` frame, or drops it when another window holds the session. `join` reads that first frame on a thread with a 2-second limit: `Replay` → attached; anything else → busy; connect refused → absent. `open` loops: absent → start a supervisor once; busy → wait (usually this window, a moment ago, still leaving); give up after 10 s and fall back to a window-owned shell, because a terminal that will not open is worse than one that will not survive.

**Blocking work leaves the main thread.** Tauri runs a synchronous command on the main thread. `pty_spawn`, `pty_end` and `pty_prune` become `async` and do their socket work in `tauri::async_runtime::spawn_blocking`.

**Supervisors are started detached.** Unix: `process_group(0)`, so a Ctrl+C aimed at whatever launched the window is not delivered to every shell. Windows: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB`, retried without breakaway when the job forbids it. Stdio is null. The child is reaped on a thread so an ended supervisor is not a zombie.

**A session is private to its user.** Unix: the sessions directory is forced to `0700` on every listen. Windows: the pipe is created with the descriptor `D:P(A;;GA;;;OW)` — its owner, nobody else — instead of the default, which grants Everyone read access and so the replay.

**Reattaching draws the replay, not the saved scrollback.** `pty.spawn` returns `{ id, reattached, survives }`. A fresh shell gets the saved scrollback, the rule and the banner, as today. A rejoined one gets none of those — the replay arrives on attach.

**Quitting asks only about what quitting loses.** `runningCount` skips panes whose shell survives; the unsaved-files question is unchanged.

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/jky-detach/src/frame.rs` | + `Frame::Hangup` |
| `crates/jky-detach/src/supervise.rs` | + `Shell::kill`; honour `Hangup` |
| `crates/jky-detach/src/socket.rs` | private sessions dir (Unix), pipe descriptor (Windows) |
| `crates/jky-detach/src/launch.rs` (new) | start a process that outlives this one |
| `crates/jky-detach/src/client.rs` (new) | `join`, `open`, `end`, `prune`, `stream`, `Client` |
| `crates/jky-detach/src/held.rs` (new) | `Clients` — held sessions by window id |
| `crates/jky-detach/src/testing.rs` (new, `cfg(test)`) | the fake shell, shared by supervise and client tests |
| `apps/desktop/src-tauri/src/supervisor.rs` | `Pty::kill`, `supervise_args`, launchers on PATH |
| `apps/desktop/src-tauri/src/state.rs` | + `held: Arc<Clients>` |
| `apps/desktop/src-tauri/src/commands/pty.rs` | route through held sessions; `pty_release`, `pty_end`, `pty_prune` |
| `apps/desktop/src-tauri/src/main.rs` | register the renamed and new commands |
| `apps/desktop/src-tauri/tests/security.rs` | pinned list |
| `apps/desktop/src-tauri/tests/detached.rs` | process-level proofs |
| `apps/desktop/src/platform/{types,tauri,web}.ts` | `Spawned`, `release`, `end`, `prune` |
| `apps/desktop/src/features/terminal/useXterm.ts` | pane name, reattach ordering, release |
| `apps/desktop/src/features/terminal/activity.ts` | survivors; `runningCount` skips them |
| `apps/desktop/src/features/terminal/quitting.ts` | wording |
| `apps/desktop/src/app/tabStore.ts` | `pty.end` on close |
| `apps/desktop/src/App.tsx` | `pty.prune` at startup; survivors in the quit count |
| `docs/FEATURES.md`, `README.md` | what it does and why |

---

### Task 0: Branch

- [ ] **Step 1: Branch from the pushed `main`**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/detach-wiring
```

- [ ] **Step 2: Commit this plan**

```bash
git add docs/superpowers/plans/2026-09-14-detach-wiring.md
git commit -m "docs(plans): terminals that outlive the window"
```

---

### Task 1: A frame that ends the shell

**Files:**
- Modify: `crates/jky-detach/src/frame.rs`

**Interfaces:**
- Produces: `Frame::Hangup` (kind `0x03`, empty payload). Window → supervisor only.

- [ ] **Step 1: Write the failing test** (append inside `frame.rs`'s `mod tests`)

```rust
    #[test]
    fn a_hangup_crosses_the_wire_and_is_not_a_detach() {
        let mut wire = Vec::new();
        Frame::Hangup.write_to(&mut wire).expect("write");
        let back = Frame::read_from(&mut wire.as_slice()).expect("read");
        assert_eq!(back, Frame::Hangup);
        assert_ne!(back, Frame::Detach, "leaving and ending must not be confusable");
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p jky-detach a_hangup_crosses_the_wire`
Expected: compile error, `no variant named Hangup`.

- [ ] **Step 3: Implement**

Beside the other kinds:

```rust
const KIND_HANGUP: u8 = 0x03;
```

In `enum Frame`, after `Detach`:

```rust
    /// The window wants the shell ended, not left.
    ///
    /// What closing a pane means. A window going away — politely or by
    /// crashing — leaves the shell running; this is the one message that
    /// does not.
    Hangup,
```

In `kind()`: `Frame::Hangup => KIND_HANGUP,`
In `payload()`: `Frame::Detach | Frame::Hangup => Vec::new(),` (replacing the `Detach` arm)
In `read_from`'s match: `KIND_HANGUP => Ok(Frame::Hangup),`

- [ ] **Step 4: Run it and watch it pass**

Run: `cargo test -p jky-detach frame`
Expected: all frame tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-detach/src/frame.rs
git commit -m "feat(detach): a frame that ends the shell rather than leaving it"
```

---

### Task 2: A supervisor that ends its shell when told

**Files:**
- Create: `crates/jky-detach/src/testing.rs`
- Modify: `crates/jky-detach/src/lib.rs`, `crates/jky-detach/src/supervise.rs`
- Modify: `apps/desktop/src-tauri/src/supervisor.rs`
- Test: `apps/desktop/src-tauri/tests/detached.rs`

**Interfaces:**
- Consumes: `Frame::Hangup` (Task 1).
- Produces: `trait Shell { …; fn kill(&self) -> io::Result<()>; }`; `crate::testing::{Fake, Rig, fake, scratch, wait_for}` for later crate tests, with `Rig.killed: Arc<AtomicBool>`.

- [ ] **Step 1: Move the fake shell into `testing.rs`**

Cut `Fake`, `impl Shell for Fake`, `scratch`, `Rig`, `fake` and `wait_for` out of `supervise.rs`'s `mod tests` into a new `crates/jky-detach/src/testing.rs`, making each `pub(crate)`, and add the kill record:

```rust
//! A shell that is a pipe and a log, for tests that drive a supervisor exactly.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::Shell;

pub(crate) struct Fake {
    output: Mutex<Option<Box<dyn Read + Send>>>,
    typed: Arc<Mutex<Vec<u8>>>,
    sized: Arc<Mutex<Vec<(u16, u16)>>>,
    killed: Arc<AtomicBool>,
}

impl Shell for Fake {
    fn output(&self) -> io::Result<Box<dyn Read + Send>> {
        self.output.lock().unwrap().take().ok_or_else(|| io::Error::other("taken twice"))
    }
    fn input(&self, bytes: &[u8]) -> io::Result<()> {
        self.typed.lock().unwrap().extend_from_slice(bytes);
        Ok(())
    }
    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.sized.lock().unwrap().push((cols, rows));
        Ok(())
    }
    fn wait(&self) -> io::Result<i32> {
        // Never returns, so these tests exercise the output-ended path. The
        // process-exited path is proved against a real shell in the desktop
        // crate's `detached` test, the only place it can be: it needs a process.
        loop {
            std::thread::park();
        }
    }
    fn kill(&self) -> io::Result<()> {
        // Recorded, not acted on: a test ends the fake by dropping its writer,
        // which is what a killed shell's output does next.
        self.killed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub(crate) struct Rig {
    pub shell: Fake,
    /// Write here and the fake shell "prints" it. Dropping it ends the shell.
    pub writer: os_pipe::PipeWriter,
    pub typed: Arc<Mutex<Vec<u8>>>,
    pub sized: Arc<Mutex<Vec<(u16, u16)>>>,
    pub killed: Arc<AtomicBool>,
}

pub(crate) fn fake() -> Rig {
    let (reader, writer) = os_pipe::pipe().expect("a pipe");
    let typed = Arc::new(Mutex::new(Vec::new()));
    let sized = Arc::new(Mutex::new(Vec::new()));
    let killed = Arc::new(AtomicBool::new(false));
    Rig {
        shell: Fake {
            output: Mutex::new(Some(Box::new(reader))),
            typed: Arc::clone(&typed),
            sized: Arc::clone(&sized),
            killed: Arc::clone(&killed),
        },
        writer,
        typed,
        sized,
        killed,
    }
}

pub(crate) fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("jky-sup-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

pub(crate) fn wait_for(mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..200 {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}
```

In `lib.rs`: `#[cfg(test)] mod testing;`. In `supervise.rs`'s `mod tests`: `use crate::testing::*;` in place of the moved items. Existing tests that destructure `Rig { shell, mut writer, typed, .. }` keep compiling.

- [ ] **Step 2: Write the failing crate test** (in `supervise.rs`'s `mod tests`)

```rust
    #[test]
    fn a_hangup_ends_the_shell_rather_than_leaving_it() {
        let dir = scratch("hangup");
        let Rig { shell, writer, killed, .. } = fake();
        let at = dir.clone();
        std::thread::spawn(move || supervise(&at, "s", shell));
        assert!(wait_for(|| crate::sessions(&dir) == ["s"]), "the supervisor never listened");

        let window = attach(&dir, "s").expect("attach");
        let (mut reading, mut writing) = window.split();
        assert!(matches!(Frame::read_from(&mut reading), Ok(Frame::Replay(_))));
        Frame::Hangup.write_to(&mut writing).expect("hang up");

        assert!(wait_for(|| killed.load(Ordering::SeqCst)), "the shell was never told to end");
        drop(writer);
        assert!(wait_for(|| crate::sessions(&dir).is_empty()), "the session outlived its shell");
    }
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cargo test -p jky-detach a_hangup_ends_the_shell`
Expected: compile error — `kill` is not a member of trait `Shell`.

- [ ] **Step 4: Implement**

In `trait Shell`:

```rust
    /// End the shell. Asked for when a window closes a pane rather than
    /// leaving it. The exit is then noticed the ordinary way — by `wait` or
    /// by the output ending — so there is still exactly one way out.
    fn kill(&self) -> io::Result<()>;
```

In `serve_one`'s loop, before `Ok(Frame::Detach) => break,`:

```rust
            Ok(Frame::Hangup) => {
                let _ = shell.kill();
                break;
            }
```

In `apps/desktop/src-tauri/src/supervisor.rs`, `impl Shell for Pty`:

```rust
    fn kill(&self) -> std::io::Result<()> {
        self.0.kill().map_err(std::io::Error::other)
    }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cargo test -p jky-detach`
Expected: all pass.

- [ ] **Step 6: Write the failing process test** (append to `tests/detached.rs`)

```rust
#[test]
fn a_hangup_ends_a_real_shell_its_supervisor_and_its_record() {
    let config = scratch("hangup");
    let recorded = sessions_dir(&config);
    let Some(mut child) = start(&config, "gone") else { return };
    assert!(
        wait_for(|| sessions(&recorded) == vec!["gone".to_string()]),
        "the supervisor never recorded itself"
    );

    let window = attach(&recorded, "gone").expect("attach");
    let (_reading, mut writing) = window.split();
    Frame::Hangup.write_to(&mut writing).expect("hang up");

    assert!(wait_for(|| sessions(&recorded).is_empty()), "the shell outlived being closed");
    assert!(
        wait_for(|| matches!(child.0.try_wait(), Ok(Some(_)))),
        "the supervisor kept running with nothing to hold"
    );
    let _ = std::fs::remove_dir_all(&config);
}
```

- [ ] **Step 7: Run it** — before Step 4's desktop change it does not compile; after, it passes.

Run: `cargo build -p jky-terminal && cargo test -p jky-terminal --test detached`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add crates/jky-detach apps/desktop/src-tauri/src/supervisor.rs apps/desktop/src-tauri/tests/detached.rs
git commit -m "feat(detach): closing a pane is a thing a supervisor can be told"
```

---

### Task 3: A session only its own user can reach

**Files:**
- Modify: `crates/jky-detach/src/socket.rs`, `crates/jky-detach/Cargo.toml`

**Interfaces:**
- Produces: nothing new publicly. `listen` now secures what it creates.

- [ ] **Step 1: Write the failing tests** (in `socket.rs`'s `mod tests`)

```rust
    #[cfg(unix)]
    #[test]
    fn the_sessions_directory_admits_nobody_else_even_if_it_was_made_loosely() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("private");
        std::fs::create_dir_all(socket_dir(&dir)).unwrap();
        std::fs::set_permissions(socket_dir(&dir), std::fs::Permissions::from_mode(0o755)).unwrap();

        let (_at, _listener) = listen(&dir, "p").expect("listen");

        let mode = std::fs::metadata(socket_dir(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "another user could reach a live shell's socket");
    }

    #[cfg(windows)]
    #[test]
    fn the_pipe_descriptor_names_its_owner_and_nobody_else() {
        assert_eq!(PIPE_SECURITY, "D:P(A;;GA;;;OW)");
        assert!(pipe_security().is_ok(), "the descriptor did not parse");
    }
```

- [ ] **Step 2: Run and watch the Unix test fail**

Run: `cargo test -p jky-detach the_sessions_directory_admits_nobody_else`
Expected: FAIL, `left: 493, right: 448` (0o755 vs 0o700). The Windows test fails to compile on Windows CI until Step 3.

- [ ] **Step 3: Implement**

`Cargo.toml`:

```toml
[target.'cfg(windows)'.dependencies]
# The pipe's security descriptor is written as SDDL, which the OS reads as UTF-16.
widestring = "1"
```

`socket.rs`, above `listen`:

```rust
/// Create the sessions directory so that only this user can reach into it.
///
/// A socket streams a live shell, and on Unix who may connect is decided by
/// file permissions. The directory is the one to trust: nobody gets past a
/// directory they cannot search, whatever the socket file's own mode says, and
/// that mode is not honoured everywhere. Tightened on every listen, so a
/// directory made loosely — by an older build, or by hand — is corrected
/// rather than trusted.
#[cfg(unix)]
fn private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// On Windows the directory holds only markers, which name a session and grant
/// nothing; the pipe itself is what is secured.
#[cfg(windows)]
fn private_dir(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Who may open a session's pipe: its owner, and nobody else.
///
/// A named pipe created with no descriptor gets the default one, which lets
/// every account on the machine open it for reading — and a supervisor answers
/// any connection by sending the tail of the shell's output. So it is stated: a
/// protected DACL whose one entry grants the owner of the pipe everything.
/// `OW` rather than a SID looked up at runtime, because it means the owner of
/// this object whoever that is, with no token to query and nothing to convert.
#[cfg(windows)]
pub(crate) const PIPE_SECURITY: &str = "D:P(A;;GA;;;OW)";

#[cfg(windows)]
fn pipe_security() -> io::Result<interprocess::os::windows::security_descriptor::SecurityDescriptor> {
    let sddl = widestring::U16CString::from_str(PIPE_SECURITY)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
    interprocess::os::windows::security_descriptor::SecurityDescriptor::deserialize(&sddl)
}
```

In `listen`, replace both `std::fs::create_dir_all(socket_dir(runtime_dir))?;` with `private_dir(&socket_dir(runtime_dir))?;`, and replace the listener line with:

```rust
    let options = ListenerOptions::new().name(as_name(&at)?);
    #[cfg(windows)]
    let options = {
        use interprocess::os::windows::local_socket::ListenerOptionsExt;
        options.security_descriptor(pipe_security()?)
    };
    let listener = options.create_sync()?;
```

- [ ] **Step 4: Run and watch it pass**

Run: `cargo test -p jky-detach`
Expected: all pass. The existing Windows listen-and-attach tests are what prove the owner can still connect.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-detach Cargo.lock
git commit -m "fix(detach): a session is reachable by the person who started it and nobody else"
```

---

### Task 4: Starting a process that outlives this one

**Files:**
- Create: `crates/jky-detach/src/launch.rs`
- Modify: `crates/jky-detach/src/lib.rs`

**Interfaces:**
- Produces: `pub fn launch<I, S>(program: &Path, args: I) -> io::Result<u32> where I: IntoIterator<Item = S>, S: AsRef<OsStr>` — returns the pid.

- [ ] **Step 1: Write the failing tests** (`launch.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_program_is_launched_and_its_pid_returned() {
        // This test binary, asked only to list its tests, exits at once on
        // every platform with nothing to install.
        let me = std::env::current_exe().expect("this test's path");
        let pid = launch(&me, ["--list"]).expect("launch");
        assert!(pid > 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_launched_process_leads_its_own_process_group() {
        let pid = launch(Path::new("/bin/sh"), ["-c", "sleep 5"]).expect("launch");
        let out = std::process::Command::new("ps")
            .args(["-o", "pgid=", "-p", &pid.to_string()])
            .output()
            .expect("ps");
        let pgid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().expect("a pgid");
        let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
        assert_eq!(pgid, pid, "it shares a group with whatever launched the window");
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cargo test -p jky-detach launch`
Expected: compile error, `cannot find function launch`.

- [ ] **Step 3: Implement** (top of `launch.rs`)

```rust
//! Starting a supervisor so that it is not a casualty of the window.
//!
//! A child is a child: on Unix it shares its parent's process group, so a
//! Ctrl+C aimed at `pnpm dev:desktop` reaches it; on Windows it can share the
//! parent's job, and a job closed with kill-on-close takes it along. Neither is
//! what a shell meant to survive the window can afford.

use std::ffi::OsStr;
use std::io;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// Start `program` as a process that outlives this one, and return its pid.
pub fn launch<I, S>(program: &Path, args: I) -> io::Result<u32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    }

    let child = match command.spawn() {
        Ok(child) => child,
        // A job that forbids breaking away refuses the whole spawn. Starting
        // without it is still a shell — one that may not survive that job.
        #[cfg(windows)]
        Err(e) if e.raw_os_error() == Some(5) => {
            use std::os::windows::process::CommandExt;
            command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
            command.spawn()?
        }
        Err(e) => return Err(e),
    };

    let pid = child.id();
    // Reaped on a thread of its own: a supervisor that ends while this window is
    // open would otherwise sit in the process table until the window closed.
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
    Ok(pid)
}
```

`lib.rs`: `mod launch;` and `pub use launch::launch;`

- [ ] **Step 4: Run and watch them pass**

Run: `cargo test -p jky-detach launch`
Expected: 2 passed on Unix, 1 on Windows.

- [ ] **Step 5: Commit**

```bash
git add crates/jky-detach
git commit -m "feat(detach): start a supervisor that is not a casualty of the window"
```

---

### Task 5: The window's end of a session

**Files:**
- Create: `crates/jky-detach/src/client.rs`, `crates/jky-detach/src/held.rs`
- Modify: `crates/jky-detach/src/lib.rs`

**Interfaces:**
- Consumes: `attach`, `sessions`, `check`, `Frame` (existing); `Frame::Hangup` (Task 1); `testing` (Task 2).
- Produces:
  - `pub enum Joined { Attached { client: Client, replay: Vec<u8> }, Busy, Absent }`
  - `pub fn join(runtime_dir: &Path, session: &str) -> Joined`
  - `pub struct Opened { pub client: Client, pub replay: Vec<u8>, pub reattached: bool }`
  - `pub fn open(runtime_dir: &Path, session: &str, start: impl FnOnce() -> io::Result<()>, within: Duration) -> io::Result<Opened>`
  - `pub fn end(runtime_dir: &Path, session: &str)` and `pub fn prune(runtime_dir: &Path, keep: &[String])`
  - `pub fn stream(frames: RecvHalf, replay: Vec<u8>, deliver: impl FnMut(Vec<u8>) -> bool) -> Option<i32>`
  - `impl Client { input(&[u8]), resize(u16, u16), hangup(), detach() -> io::Result<()>; take_frames() -> Option<RecvHalf> }`
  - `pub struct Clients` with `new()`, `insert(&str, Opened) -> String` (ids `held-N`), `get(&str) -> Option<Arc<Held>>`, `by_session(&str) -> Option<(String, Arc<Held>)>`, `remove(&str) -> Option<Arc<Held>>`; `pub struct Held { pub session: String, pub client: Client }` with `take_replay() -> Vec<u8>`.

- [ ] **Step 1: Write the failing tests** (`client.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::supervise;
    use crate::testing::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const WITHIN: Duration = Duration::from_secs(5);

    /// A `start` that runs a supervisor on a thread, counting how often it is asked.
    fn starter(dir: &Path, name: &str, shell: Fake, count: Arc<AtomicUsize>) -> impl FnOnce() -> io::Result<()> {
        let dir = dir.to_path_buf();
        let name = name.to_string();
        move || {
            count.fetch_add(1, Ordering::SeqCst);
            std::thread::spawn(move || supervise(&dir, &name, shell));
            Ok(())
        }
    }

    fn never() -> io::Result<()> {
        panic!("a supervisor was started when one was already there")
    }

    #[test]
    fn joining_nothing_finds_nothing() {
        let dir = scratch("client-absent");
        assert!(matches!(join(&dir, "nobody"), Joined::Absent));
    }

    #[test]
    fn opening_starts_a_supervisor_once_and_says_the_shell_is_new() {
        let dir = scratch("client-fresh");
        let Rig { shell, .. } = fake();
        let count = Arc::new(AtomicUsize::new(0));
        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::clone(&count)), WITHIN).expect("open");
        assert!(!opened.reattached);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn reopening_after_detaching_rejoins_with_what_was_missed() {
        let dir = scratch("client-again");
        let Rig { shell, mut writer, .. } = fake();
        let count = Arc::new(AtomicUsize::new(0));
        let first = open(&dir, "s", starter(&dir, "s", shell, count), WITHIN).expect("open");
        first.client.detach().expect("detach");
        drop(first);

        writer.write_all(b"MISSED").unwrap();

        let second = open(&dir, "s", never, WITHIN).expect("reopen");
        assert!(second.reattached);
        let replay = String::from_utf8_lossy(&second.replay).into_owned();
        assert!(replay.contains("MISSED"), "what happened while away was lost: {replay:?}");
    }

    #[test]
    fn a_second_window_finds_the_session_busy() {
        let dir = scratch("client-busy");
        let Rig { shell, .. } = fake();
        let _held = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN).expect("open");
        assert!(matches!(join(&dir, "s"), Joined::Busy));
    }

    #[test]
    fn typing_and_resizing_reach_the_shell() {
        let dir = scratch("client-io");
        let Rig { shell, typed, sized, .. } = fake();
        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN).expect("open");
        opened.client.input(b"ls\r").unwrap();
        opened.client.resize(100, 30).unwrap();
        assert!(wait_for(|| typed.lock().unwrap().as_slice() == b"ls\r"));
        assert!(wait_for(|| sized.lock().unwrap().contains(&(100, 30))));
    }

    #[test]
    fn ending_a_session_nobody_holds_tells_its_shell() {
        let dir = scratch("client-end");
        let Rig { shell, writer, killed, .. } = fake();
        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN).expect("open");
        opened.client.detach().unwrap();
        drop(opened);

        end(&dir, "s");
        assert!(wait_for(|| killed.load(Ordering::SeqCst)));
        drop(writer);
        assert!(wait_for(|| crate::sessions(&dir).is_empty()));
    }

    #[test]
    fn pruning_ends_only_what_is_not_kept() {
        let dir = scratch("client-prune");
        let Rig { shell: kept_shell, killed: kept_killed, .. } = fake();
        let Rig { shell: gone_shell, killed: gone_killed, .. } = fake();
        let a = open(&dir, "kept", starter(&dir, "kept", kept_shell, Arc::new(AtomicUsize::new(0))), WITHIN).unwrap();
        let b = open(&dir, "gone", starter(&dir, "gone", gone_shell, Arc::new(AtomicUsize::new(0))), WITHIN).unwrap();
        a.client.detach().unwrap();
        b.client.detach().unwrap();
        drop((a, b));

        prune(&dir, &["kept".to_string()]);
        assert!(wait_for(|| gone_killed.load(Ordering::SeqCst)), "an unclaimed session survived");
        assert!(!kept_killed.load(Ordering::SeqCst), "a claimed session was ended");
    }

    #[test]
    fn the_stream_delivers_the_replay_first_and_stops_at_the_end() {
        let dir = scratch("client-stream");
        let Rig { shell, mut writer, .. } = fake();
        let opened = open(&dir, "s", starter(&dir, "s", shell, Arc::new(AtomicUsize::new(0))), WITHIN).unwrap();
        let frames = opened.client.take_frames().expect("frames");
        writer.write_all(b"LIVE").unwrap();
        drop(writer);

        let mut got = Vec::new();
        stream(frames, b"EARLIER".to_vec(), |chunk| {
            got.push(String::from_utf8_lossy(&chunk).into_owned());
            true
        });
        assert_eq!(got.first().map(String::as_str), Some("EARLIER"));
        assert!(got.concat().contains("LIVE"));
    }

    #[test]
    fn a_name_that_is_really_a_path_is_refused_before_anything_starts() {
        let dir = scratch("client-name");
        let result = open(&dir, "../escape", never, WITHIN);
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cargo test -p jky-detach client`
Expected: compile errors, `cannot find function open`.

- [ ] **Step 3: Implement `client.rs`** (above the tests)

```rust
//! A window's end of a detached session.
//!
//! A supervisor answers a connection with the replay, or drops it when another
//! window already holds the session. So joining is a handshake with three
//! answers, and opening is joining with a supervisor started when there is
//! none to join.

use std::io;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use interprocess::local_socket::traits::Stream as _;
use interprocess::local_socket::{RecvHalf, SendHalf};

use crate::{attach, check, sessions, Frame};

/// How long a supervisor has to answer before it counts as not answering.
const HANDSHAKE: Duration = Duration::from_secs(2);

/// How long ending a session waits for a window that is still letting go.
const LETTING_GO: Duration = Duration::from_secs(2);

/// What joining a session found.
pub enum Joined {
    /// Attached, with what was missed while nobody was.
    Attached { client: Client, replay: Vec<u8> },
    /// A supervisor is there and serving another window, or not answering.
    Busy,
    /// Nothing is there.
    Absent,
}

/// A session this window holds.
pub struct Client {
    sending: Mutex<SendHalf>,
    receiving: Mutex<Option<RecvHalf>>,
}

/// What opening a session produced.
pub struct Opened {
    pub client: Client,
    pub replay: Vec<u8>,
    /// Whether an existing shell was joined rather than a new one started.
    pub reattached: bool,
}

fn recover<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn join(runtime_dir: &Path, session: &str) -> Joined {
    let Ok(stream) = attach(runtime_dir, session) else { return Joined::Absent };
    let (mut receiving, sending) = stream.split();

    // On a thread, because a read blocks, and a supervisor that never answers
    // must not keep a terminal from opening. The half comes back with the
    // answer, so nothing is lost when the answer is in time.
    let (tell, told) = mpsc::channel();
    std::thread::spawn(move || {
        let first = Frame::read_from(&mut receiving);
        let _ = tell.send((first, receiving));
    });

    match told.recv_timeout(HANDSHAKE) {
        Ok((Ok(Frame::Replay(replay)), receiving)) => Joined::Attached {
            client: Client { sending: Mutex::new(sending), receiving: Mutex::new(Some(receiving)) },
            replay,
        },
        // Closed without a replay is a supervisor saying another window has it.
        _ => Joined::Busy,
    }
}

/// Join a session, starting its supervisor first if there is none.
///
/// `start` is how a supervisor comes to exist — in the app, this binary run
/// again with `--supervise`. A parameter, so it can be a thread in a test and a
/// process in the proof.
pub fn open(
    runtime_dir: &Path,
    session: &str,
    start: impl FnOnce() -> io::Result<()>,
    within: Duration,
) -> io::Result<Opened> {
    check(session).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;

    let mut start = Some(start);
    let mut reattached = true;
    let until = Instant::now() + within;
    loop {
        match join(runtime_dir, session) {
            Joined::Attached { client, replay } => return Ok(Opened { client, replay, reattached }),
            Joined::Absent => {
                if let Some(start) = start.take() {
                    start()?;
                    reattached = false;
                }
            }
            // Most often this same window, a moment ago, still letting go.
            // Worth a short wait rather than a second shell.
            Joined::Busy => {}
        }
        if Instant::now() >= until {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("session {session} did not answer"),
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// End a session's shell, if there is one.
///
/// Waits briefly for a window still letting go of it — closing a pane and its
/// terminal unmounting race, and either may reach Rust first.
pub fn end(runtime_dir: &Path, session: &str) {
    let until = Instant::now() + LETTING_GO;
    loop {
        match join(runtime_dir, session) {
            Joined::Attached { client, .. } => {
                let _ = client.hangup();
                return;
            }
            Joined::Absent => return,
            Joined::Busy if Instant::now() >= until => return,
            Joined::Busy => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

/// End every session no pane claims.
pub fn prune(runtime_dir: &Path, keep: &[String]) {
    for session in sessions(runtime_dir) {
        if !keep.contains(&session) {
            end(runtime_dir, &session);
        }
    }
}

/// Deliver a session's output: the replay, then the live stream until the shell ends.
///
/// Returns the exit code when the shell ended, `None` when the window stopped
/// listening or the connection dropped. `deliver` returns `false` to stop.
pub fn stream(mut frames: RecvHalf, replay: Vec<u8>, mut deliver: impl FnMut(Vec<u8>) -> bool) -> Option<i32> {
    if !replay.is_empty() && !deliver(replay) {
        return None;
    }
    loop {
        match Frame::read_from(&mut frames) {
            Ok(Frame::Data(bytes)) => {
                if !deliver(bytes) {
                    return None;
                }
            }
            Ok(Frame::Ended { code }) => return Some(code),
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

impl Client {
    pub fn input(&self, bytes: &[u8]) -> io::Result<()> {
        self.send(Frame::Data(bytes.to_vec()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.send(Frame::Resize { cols, rows })
    }

    /// End the shell. What closing a pane means.
    pub fn hangup(&self) -> io::Result<()> {
        self.send(Frame::Hangup)
    }

    /// Leave the shell running. What a terminal unmounting means.
    pub fn detach(&self) -> io::Result<()> {
        self.send(Frame::Detach)
    }

    /// The live stream, for exactly one reader.
    pub fn take_frames(&self) -> Option<RecvHalf> {
        recover(&self.receiving).take()
    }

    fn send(&self, frame: Frame) -> io::Result<()> {
        let mut sending = recover(&self.sending);
        frame.write_to(&mut *sending).map_err(|e| io::Error::other(e.to_string()))
    }
}
```

- [ ] **Step 4: Implement `held.rs`** with its test

```rust
//! Every session this window holds, by the id the window addresses it with.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::client::{Client, Opened};

pub struct Held {
    pub session: String,
    pub client: Client,
    replay: Mutex<Vec<u8>>,
}

impl Held {
    /// What was missed, once. Delivered when the window starts listening.
    pub fn take_replay(&self) -> Vec<u8> {
        std::mem::take(&mut *recover(&self.replay))
    }
}

/// Poisoned locks are recovered for the reason `PtyRegistry` gives: a panic
/// elsewhere says nothing about whether an entry here is still a session.
#[derive(Default)]
pub struct Clients {
    held: Mutex<HashMap<String, Arc<Held>>>,
    counter: Mutex<u64>,
}

fn recover<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Clients {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: &str, opened: Opened) -> String {
        let id = {
            let mut counter = recover(&self.counter);
            *counter += 1;
            format!("held-{counter}")
        };
        let held = Held {
            session: session.to_string(),
            client: opened.client,
            replay: Mutex::new(opened.replay),
        };
        recover(&self.held).insert(id.clone(), Arc::new(held));
        id
    }

    pub fn get(&self, id: &str) -> Option<Arc<Held>> {
        recover(&self.held).get(id).cloned()
    }

    pub fn by_session(&self, session: &str) -> Option<(String, Arc<Held>)> {
        recover(&self.held)
            .iter()
            .find(|(_, held)| held.session == session)
            .map(|(id, held)| (id.clone(), Arc::clone(held)))
    }

    pub fn remove(&self, id: &str) -> Option<Arc<Held>> {
        recover(&self.held).remove(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::open;
    use crate::supervise;
    use crate::testing::*;
    use std::time::Duration;

    #[test]
    fn a_held_session_is_found_by_id_and_by_name_and_gives_its_replay_once() {
        let dir = scratch("held");
        let Rig { shell, .. } = fake();
        let at = dir.clone();
        let opened = open(&dir, "pane-1", move || {
            std::thread::spawn(move || supervise(&at, "pane-1", shell));
            Ok(())
        }, Duration::from_secs(5))
        .expect("open");

        let clients = Clients::new();
        let id = clients.insert("pane-1", Opened { replay: b"BEFORE".to_vec(), ..opened });

        assert!(id.starts_with("held-"));
        assert_eq!(clients.by_session("pane-1").map(|(i, _)| i), Some(id.clone()));
        let held = clients.get(&id).expect("held");
        assert_eq!(held.take_replay(), b"BEFORE");
        assert!(held.take_replay().is_empty(), "the replay was handed out twice");
        assert!(clients.remove(&id).is_some());
        assert!(clients.get(&id).is_none());
    }
}
```

`lib.rs`:

```rust
mod client;
mod held;

pub use client::{end, join, open, prune, stream, Client, Joined, Opened};
pub use held::{Clients, Held};
```

- [ ] **Step 5: Run and watch them pass**

Run: `cargo test -p jky-detach && cargo clippy -p jky-detach --all-targets -- -D warnings`
Expected: all pass, no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/jky-detach
git commit -m "feat(detach): the window's end of a session — join, open, end and prune"
```

---

### Task 6: The binary, told everything a window-owned shell gets

**Files:**
- Modify: `apps/desktop/src-tauri/src/supervisor.rs`
- Test: `apps/desktop/src-tauri/tests/detached.rs`

**Interfaces:**
- Consumes: `jky_detach::{open, launch, Frame}` (Tasks 4–5).
- Produces: `pub fn supervise_args(session: &str, config_dir: &Path, cwd: &Path) -> Vec<OsString>`; `fn spawn_config(config_dir: &Path, cwd: Option<String>) -> SpawnConfig`.

- [ ] **Step 1: Write the failing unit tests** (`supervisor.rs` `mod tests`)

```rust
    #[test]
    fn a_supervisor_is_asked_for_by_name_directory_and_start() {
        let args = supervise_args("pane-2", Path::new("/cfg"), Path::new("/work"));
        let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["--supervise", "pane-2", "--config-dir", "/cfg", "--cwd", "/work"]);
        assert_eq!(requested(&[vec!["jky-terminal".to_string()], args.clone()].concat()).as_deref(), Some("pane-2"));
    }

    #[test]
    fn a_held_shell_has_the_jky_commands_when_the_window_installed_them() {
        let config = tempfile::tempdir().unwrap();
        assert_eq!(spawn_config(config.path(), None).path_prepend, None);

        std::fs::create_dir_all(jky_pty::launcher_dir(config.path())).unwrap();
        assert_eq!(
            spawn_config(config.path(), None).path_prepend,
            Some(jky_pty::launcher_dir(config.path()))
        );
    }
```

- [ ] **Step 2: Run and watch them fail**

Run: `cargo test -p jky-terminal --bin jky-terminal supervisor`
Expected: compile errors, `cannot find function supervise_args`.

- [ ] **Step 3: Implement**

```rust
/// The arguments that make this binary hold `session`, starting in `cwd`.
pub fn supervise_args(session: &str, config_dir: &Path, cwd: &Path) -> Vec<std::ffi::OsString> {
    vec![
        FLAG.into(),
        session.into(),
        CONFIG_FLAG.into(),
        config_dir.into(),
        "--cwd".into(),
        cwd.into(),
    ]
}

/// What a held shell is started with: everything a window-owned one gets.
///
/// The window installs the launchers and the shell hooks before it asks for a
/// supervisor, so both are there to point at. A launcher directory that is not
/// there means the shell goes without the `jky` commands, never without a shell.
fn spawn_config(config_dir: &Path, cwd: Option<String>) -> SpawnConfig {
    let launchers = jky_pty::launcher_dir(config_dir);
    SpawnConfig {
        shell: default_shell(),
        cwd: resolve_start_dir(cwd.as_deref(), home_dir()),
        cols: 80,
        rows: 24,
        path_prepend: launchers.is_dir().then_some(launchers),
        config_dir: Some(config_dir.to_path_buf()),
    }
}
```

and `run` becomes:

```rust
pub fn run(config_dir: &Path, session: &str, cwd: Option<String>) -> std::io::Result<()> {
    // The window resizes it the moment it attaches; 80x24 is only what the
    // shell sees before anybody is looking.
    let pty = PtySession::spawn(spawn_config(config_dir, cwd)).map_err(std::io::Error::other)?;
    supervise(&jky_detach_dir(config_dir), session, Pty(pty))
}
```

- [ ] **Step 4: Write the process proof** (append to `tests/detached.rs`)

```rust
/// A process this test launched, ended when the test ends however it ends.
struct Launched(u32);

impl Drop for Launched {
    fn drop(&mut self) {
        #[cfg(unix)]
        let _ = Command::new("kill").arg(self.0.to_string()).status();
        #[cfg(windows)]
        let _ = Command::new("taskkill").args(["/PID", &self.0.to_string(), "/F", "/T"]).status();
    }
}

#[test]
fn a_window_that_finds_nothing_starts_a_shell_it_can_leave_and_find_again() {
    let exe = binary();
    if !exe.exists() {
        eprintln!("no built binary at {exe:?}; skipping");
        return;
    }
    let config = scratch("open");
    let recorded = sessions_dir(&config);
    let mut launched = None;

    let args = [
        "--supervise".into(), "fresh".into(),
        "--config-dir".into(), config.clone().into_os_string(),
        "--cwd".into(), config.clone().into_os_string(),
    ];
    let first = jky_detach::open(&recorded, "fresh", || {
        launched = Some(Launched(jky_detach::launch(&exe, &args)?));
        Ok(())
    }, Duration::from_secs(30))
    .expect("open");
    assert!(!first.reattached);

    first.client.input(b"echo MARKER-HELD\r").unwrap();
    let frames = first.client.take_frames().unwrap();
    let seen = read_until(frames, "MARKER-HELD", Duration::from_secs(25));
    assert!(seen.contains("MARKER-HELD"), "the held shell never ran it:\n{seen}");
    first.client.detach().unwrap();
    drop(first);

    let again = jky_detach::open(&recorded, "fresh", || panic!("started a second shell"), Duration::from_secs(10))
        .expect("reopen");
    assert!(again.reattached, "leaving and coming back started over");

    again.client.hangup().unwrap();
    assert!(wait_for(|| sessions(&recorded).is_empty()), "closing it left it running");
    drop(launched);
    let _ = std::fs::remove_dir_all(&config);
}
```

(The `args` literal is `[std::ffi::OsString; 6]`; add `use std::ffi::OsString;` and write each element as `OsString::from(...)` if inference needs it.)

- [ ] **Step 5: Run and watch everything pass**

Run: `cargo build -p jky-terminal && cargo test -p jky-terminal`
Expected: all pass, including 4 in `detached`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/supervisor.rs apps/desktop/src-tauri/tests/detached.rs
git commit -m "feat(detach): a held shell starts with everything a window's shell gets"
```

---

### Task 7: IPC that routes a pane through its supervisor

**Files:**
- Modify: `apps/desktop/src-tauri/src/state.rs`, `apps/desktop/src-tauri/src/commands/pty.rs`, `apps/desktop/src-tauri/src/main.rs`
- Test: `apps/desktop/src-tauri/tests/security.rs`

**Interfaces:**
- Consumes: `jky_detach::{Clients, open, launch, end, prune, stream, check}`; `supervisor::{supervise_args, jky_detach_dir}`.
- Produces (IPC): `pty_spawn(cols, rows, banner, accent, cwd, pane) -> { id, reattached, survives }`; `pty_release(id)`; `pty_end(pane)`; `pty_prune(panes)`. `pty_kill` is removed.

- [ ] **Step 1: Write the failing test** — edit the pinned list in `security.rs`, replacing `"pty_kill".to_string(),` with:

```rust
        // Ends one pane's shell by name — what closing a pane means now that a
        // shell outlives its window. Grants nothing new: `pty_write` already
        // sends `exit` to any shell the window holds. The name is validated in
        // jky-detach against an allow-list before it becomes an address.
        "pty_end".to_string(),
        // Ends every held shell no pane claims, at startup, by the same list
        // that already prunes scrollback. Reaches only this user's own
        // sessions of this app, in a directory Rust chooses.
        "pty_prune".to_string(),
        // The window letting go of a terminal it unmounted: a held shell is
        // left running, a window-owned one is ended as `pty_kill` did.
        "pty_release".to_string(),
```

- [ ] **Step 2: Run and watch it fail**

Run: `cargo test -p jky-terminal --test security the_exposed_command_surface`
Expected: FAIL — `pty_end`, `pty_prune`, `pty_release` expected but not exposed; `pty_kill` exposed but not expected.

- [ ] **Step 3: Implement**

`state.rs`: add the field and its construction.

```rust
    /// Terminals whose shell is held by a supervisor and outlives the window.
    /// Beside `ptys` rather than in it: those are the window's own children,
    /// these are connections to processes that are not.
    pub held: Arc<jky_detach::Clients>,
```

```rust
            held: Arc::new(jky_detach::Clients::new()),
```

`commands/pty.rs`: add near the top

```rust
use std::sync::Arc;
use std::time::Duration;

/// How long a pane waits for its supervisor before settling for a shell of
/// the window's own. A terminal that will not open is worse than one that
/// will not survive.
const OPEN_WITHIN: Duration = Duration::from_secs(10);

#[derive(Serialize)]
pub struct Spawned {
    id: String,
    reattached: bool,
    survives: bool,
}
```

Change `pty_spawn`'s signature to

```rust
#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
    banner: String,
    accent: String,
    cwd: Option<String>,
    // Which pane this is, so its shell can be found again after a restart.
    pane: Option<String>,
) -> Result<Spawned, String> {
```

keep its body up to and including `let shell = default_shell();` / `integration_ok`, then:

```rust
    // Held by a supervisor when the pane has a name the socket layer accepts.
    // Asynchronous, and off the runtime's threads, because joining waits on a
    // socket and a synchronous command would wait on the main thread.
    if let Some(pane) = pane.filter(|p| jky_detach::check(p).is_ok()) {
        let dir = crate::supervisor::jky_detach_dir(&state.config_dir);
        let args = crate::supervisor::supervise_args(&pane, &state.config_dir, &cwd);
        let name = pane.clone();
        let opened = tauri::async_runtime::spawn_blocking(move || {
            let exe = std::env::current_exe()?;
            jky_detach::open(&dir, &name, || jky_detach::launch(&exe, &args).map(|_| ()), OPEN_WITHIN)
        })
        .await
        .map_err(|e| e.to_string())?;

        if let Ok(opened) = opened {
            let reattached = opened.reattached;
            let id = state.held.insert(&pane, opened);
            return Ok(Spawned { id, reattached, survives: true });
        }
        // Falls through: a shell of the window's own, which will not survive
        // the window but will open.
    }

    let session = PtySession::spawn(SpawnConfig {
        shell,
        cwd,
        cols,
        rows,
        path_prepend: launchers_ok.then_some(bin_dir),
        config_dir: integration_ok.then(|| state.config_dir.clone()),
    })
    .map_err(|e| e.to_string())?;

    Ok(Spawned { id: state.ptys.insert(session), reattached: false, survives: false })
}
```

(The `app: AppHandle` parameter and its `let _ = &app;` are removed from `pty_spawn`; it never used them.)

`pty_attach`, at the top of its body:

```rust
    if let Some(held) = state.held.get(&id) {
        let frames = held.client.take_frames().ok_or_else(|| format!("pty '{id}' is already streaming"))?;
        let replay = held.take_replay();
        let registry = Arc::clone(&state.held);
        let event = data_event(&id);
        std::thread::spawn(move || {
            let ended = jky_detach::stream(frames, replay, |bytes| {
                let chunk = String::from_utf8_lossy(&bytes).to_string();
                app.emit(&event, PtyChunk { id: id.clone(), chunk }).is_ok()
            });
            // An ended shell's id addresses nothing now.
            if ended.is_some() {
                registry.remove(&id);
            }
        });
        return Ok(());
    }
```

`pty_write` and `pty_resize`, at the top of each body:

```rust
    if let Some(held) = state.held.get(&id) {
        return held.client.input(data.as_bytes()).map_err(|e| e.to_string());
    }
```

```rust
    if let Some(held) = state.held.get(&id) {
        return held.client.resize(cols, rows).map_err(|e| e.to_string());
    }
```

Replace `pty_kill` with:

```rust
/// The window letting go of a terminal.
///
/// Not the same as closing it. A terminal unmounts for reasons that are not
/// the user closing it — a double mount in development, a spawn cancelled
/// mid-flight — so a held shell is only detached here and keeps running. A
/// shell of the window's own has nothing else that could reach it, so it ends.
#[tauri::command]
pub fn pty_release(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(held) = state.held.remove(&id) {
        let _ = held.client.detach();
        return Ok(());
    }
    state.ptys.remove(&id);
    Ok(()) // releasing an already-gone terminal is the desired end state
}

/// End a pane's shell: what closing the pane means.
#[tauri::command]
pub async fn pty_end(state: State<'_, AppState>, pane: String) -> Result<(), String> {
    if jky_detach::check(&pane).is_err() {
        return Ok(()); // no such session could exist
    }
    if let Some((id, held)) = state.held.by_session(&pane) {
        let _ = held.client.hangup();
        state.held.remove(&id);
        return Ok(());
    }
    let dir = crate::supervisor::jky_detach_dir(&state.config_dir);
    tauri::async_runtime::spawn_blocking(move || jky_detach::end(&dir, &pane))
        .await
        .map_err(|e| e.to_string())
}

/// End every held shell no pane claims. Called once, at startup.
#[tauri::command]
pub async fn pty_prune(state: State<'_, AppState>, panes: Vec<String>) -> Result<(), String> {
    let dir = crate::supervisor::jky_detach_dir(&state.config_dir);
    tauri::async_runtime::spawn_blocking(move || jky_detach::prune(&dir, &panes))
        .await
        .map_err(|e| e.to_string())
}
```

`main.rs` `generate_handler!`: replace `pty::pty_kill,` with `pty::pty_release, pty::pty_end, pty::pty_prune,`.

- [ ] **Step 4: Run and watch it pass**

Run: `cargo test -p jky-terminal && cargo clippy --workspace --all-targets -- -D warnings`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(pty): a pane's shell is held by a supervisor, and only closing it ends it"
```

---

### Task 8: The platform adapter speaks it

**Files:**
- Modify: `apps/desktop/src/platform/types.ts`, `apps/desktop/src/platform/tauri.ts`, `apps/desktop/src/platform/web.ts`
- Test: `apps/desktop/src/platform/web.test.ts`

**Interfaces:**
- Produces: `interface Spawned { id: string; reattached: boolean; survives: boolean }`; `PtyApi.spawn(cols, rows, banner, accent, cwd?, pane?) => Promise<Spawned>`; `PtyApi.release(id)`, `PtyApi.end(pane)`, `PtyApi.prune(panes)`. `PtyApi.kill` removed.

- [ ] **Step 1: Write the failing test** (`web.test.ts`)

```ts
describe("the web platform's terminals", () => {
  it("spawns a shell that is new and does not outlive the page", async () => {
    const spawned = await createWebPlatform().pty.spawn(80, 24, "", "", null, "pane-1");
    expect(spawned).toEqual({ id: expect.stringMatching(/^web-pty-/), reattached: false, survives: false });
  });

  it("lets go of, ends and prunes without complaint", async () => {
    const { pty } = createWebPlatform();
    const { id } = await pty.spawn(80, 24, "", "", null, "pane-1");
    await expect(pty.release(id)).resolves.toBeUndefined();
    await expect(pty.end("pane-1")).resolves.toBeUndefined();
    await expect(pty.prune(["pane-1"])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @jky/desktop exec vitest run src/platform/web.test.ts`
Expected: FAIL — `spawned` is a string; `pty.release is not a function`.

- [ ] **Step 3: Implement**

`types.ts`, above `PtyApi`:

```ts
/** What starting a terminal produced. */
export interface Spawned {
  /** Addresses this terminal in every other call. */
  id: string;
  /** An existing shell was found and joined, so its output is on its way. */
  reattached: boolean;
  /** The shell is held apart from the window and outlives it. */
  survives: boolean;
}
```

In `PtyApi`: `spawn(cols, rows, banner, accent, cwd?: string | null, pane?: string | null): Promise<Spawned>;` — and document `pane`: "Which pane this is, so its shell can be found again after a restart." Replace `kill(id: string): Promise<void>;` with:

```ts
  /**
   * The window letting go of a terminal it unmounted. A shell that outlives
   * the window keeps running; one that does not, ends.
   */
  release(id: string): Promise<void>;
  /** End a pane's shell — what closing the pane means. */
  end(pane: string): Promise<void>;
  /** End every held shell no pane in `panes` claims. */
  prune(panes: string[]): Promise<void>;
```

`tauri.ts`:

```ts
    async spawn(cols, rows, banner, accent, cwd, pane) {
      return invoke<Spawned>("pty_spawn", {
        cols, rows, banner, accent, cwd: cwd ?? null, pane: pane ?? null,
      });
    },
    async release(id) {
      await invoke<void>("pty_release", { id });
    },
    async end(pane) {
      await invoke<void>("pty_end", { pane });
    },
    async prune(panes) {
      await invoke<void>("pty_prune", { panes });
    },
```

(import `Spawned` with the other types; remove the old `kill`.)

`web.ts`:

```ts
    async spawn(_cols, _rows, _banner, _accent, _cwd, _pane) {
      // Deliberately silent. The prompt is emitted when a handler subscribes,
      // not here: spawn resolves before onData registers.
      //
      // Never reattached and never surviving: the preview has no processes,
      // so nothing it starts can outlive the page.
      return { id: `web-pty-${++ptyCounter}`, reattached: false, survives: false };
    },
    async release(id) {
      ptyHandlers.delete(id);
    },
    async end() {},
    async prune() {},
```

- [ ] **Step 4: Fix every caller the compiler names**

Run: `pnpm --filter @jky/desktop typecheck`
Expected: errors at `pty.kill(...)` calls in `features/terminal/useXterm.ts` and any test using `.kill`. Change each `pty.kill(` to `pty.release(`. `useXterm`'s spawn call is rewritten in Task 9 — for now take `.id` of the result so it compiles:

```ts
      const id = host
        ? await platform.remote.spawn(host, xterm.cols, xterm.rows)
        : (await platform.pty.spawn(xterm.cols, xterm.rows, banner, tokens.getPropertyValue("--accent"), dirOf(scrollbackKey))).id;
```

- [ ] **Step 5: Run and watch everything pass**

Run: `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(platform): terminals are released, ended and pruned, and say whether they survive"
```

---

### Task 9: A terminal that rejoins its shell

**Files:**
- Modify: `apps/desktop/src/features/terminal/useXterm.ts`, `apps/desktop/src/features/terminal/activity.ts`
- Test: `apps/desktop/src/features/terminal/Terminal.test.tsx`, `apps/desktop/src/features/terminal/activity.test.ts`

**Interfaces:**
- Consumes: `Spawned`, `pty.release` (Task 8).
- Produces: `useActivity` gains `survivors: Record<string, true>` and `held(pane: string, survives: boolean): void`; `runningCount(panes, survivors = {})`.

- [ ] **Step 1: Write the failing tests**

`Terminal.test.tsx`:

```ts
  it("names its pane when it asks for a shell, so the shell can be found again", async () => {
    const panes: Array<string | null | undefined> = [];
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      pty: {
        ...platform.pty,
        spawn: (cols, rows, banner, accent, cwd, pane) => {
          panes.push(pane);
          return platform.pty.spawn(cols, rows, banner, accent, cwd, pane);
        },
      },
    });

    render(<Terminal paneId="pane-7" />);
    await waitFor(() => expect(panes).toEqual(["pane-7"]));
  });

  it("draws neither old scrollback nor the banner over a shell it rejoined", async () => {
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      scrollback: { ...platform.scrollback, load: async () => "OLD-SESSION-TEXT" },
      pty: {
        ...platform.pty,
        spawn: async () => ({ id: "held-1", reattached: true, survives: true }),
      },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
    expect(writes.join("")).not.toContain("OLD-SESSION-TEXT");
    expect(writes.join("")).not.toContain("Infinite Possibilities.");
  });

  it("restores old scrollback above a shell that is new", async () => {
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      scrollback: { ...platform.scrollback, load: async () => "OLD-SESSION-TEXT" },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
    expect(writes.join("")).toContain("OLD-SESSION-TEXT");
    expect(writes.join("")).toContain("Infinite Possibilities.");
  });
```

`activity.test.ts`:

```ts
  it("does not count a command in a shell that outlives the window as lost by quitting", () => {
    const panes = { "pane-1": "running", "pane-2": "running", "pane-3": "idle" } as const;
    expect(runningCount(panes)).toBe(2);
    expect(runningCount(panes, { "pane-1": true })).toBe(1);
  });

  it("remembers which panes survive, and forgets with the pane", () => {
    useActivity.getState().held("pane-9", true);
    expect(useActivity.getState().survivors["pane-9"]).toBe(true);
    useActivity.getState().held("pane-9", false);
    expect(useActivity.getState().survivors["pane-9"]).toBeUndefined();
    useActivity.getState().held("pane-9", true);
    useActivity.getState().forget("pane-9");
    expect(useActivity.getState().survivors["pane-9"]).toBeUndefined();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @jky/desktop exec vitest run src/features/terminal/Terminal.test.tsx src/features/terminal/activity.test.ts`
Expected: FAIL — `panes` is `[undefined]`; rejoined terminal contains the old text; `held is not a function`.

- [ ] **Step 3: Implement `activity.ts`**

In `ActivityState`:

```ts
  /** Panes whose shell is held apart from the window, and so survives it. */
  survivors: Record<string, true>;
  /** Say whether a pane's shell survives the window. */
  held: (pane: string, survives: boolean) => void;
```

In the store: initial `survivors: {}`;

```ts
  held: (pane, survives) =>
    set((s) => {
      const { [pane]: _was, ...rest } = s.survivors;
      return { survivors: survives ? { ...rest, [pane]: true } : rest };
    }),
```

and `forget` also drops `pane` from `survivors` the same way.

`runningCount`:

```ts
/**
 * Commands that quitting would lose.
 *
 * A shell held by a supervisor keeps running when the window closes, so what
 * it is doing is not lost and is not worth asking about. What is left is a
 * remote session, or a local shell that could not be held.
 */
export function runningCount(
  panes: Record<string, Activity>,
  survivors: Record<string, true> = {},
): number {
  return Object.entries(panes).filter(([pane, state]) => state === "running" && !survivors[pane]).length;
}
```

- [ ] **Step 4: Implement `useXterm.ts`** — replace the body of the spawning IIFE from `if (scrollbackKey) {` through the `ptyRef.current = id;` line with:

```ts
      // Read before spawning, drawn after: whether the old output belongs on
      // screen depends on whether the shell is new. A rejoined shell sends
      // what it printed while nobody watched, and old scrollback above that
      // would show the same session twice.
      let previous = "";
      if (scrollbackKey) {
        try {
          previous = await platform.scrollback.load(scrollbackKey);
        } catch {
          // A terminal that will not open because its history could not be
          // read would be a poor trade for a convenience.
        }
      }
      if (cancelled) return;

      const spawned = host
        ? { id: await platform.remote.spawn(host, xterm.cols, xterm.rows), reattached: false, survives: false }
        : await platform.pty.spawn(
            xterm.cols,
            xterm.rows,
            banner,
            tokens.getPropertyValue("--accent"),
            // Where this pane was when it was last open. Rust checks the
            // directory still exists before honouring it.
            dirOf(scrollbackKey),
            // Which pane this is, so a shell that outlived the window can be
            // found again. Absent, the shell is the window's own.
            scrollbackKey ?? null,
          );
      const id = spawned.id;
      if (cancelled) {
        // Unmounted mid-spawn. Let go rather than end it: a held shell may be
        // exactly what the next mount of this pane is about to rejoin.
        void platform.pty.release(id);
        return;
      }

      if (scrollbackKey) useActivity.getState().held(scrollbackKey, spawned.survives);

      if (!spawned.reattached) {
        // Last session's output first, then a rule, then the banner — so the
        // scrollback reads as a history rather than as a terminal that
        // mysteriously already has text in it.
        if (previous) {
          xterm.write(previous.endsWith("\n") ? previous : `${previous}\r\n`);
          xterm.write(`\x1b[2m${"─".repeat(Math.max(8, xterm.cols - 2))}\x1b[0m\r\n`);
        }
        // Greet before the shell speaks. A remote terminal takes no banner:
        // it is a terminal on somebody else's computer.
        if (!host) xterm.write(banner);
      }
      ptyId = id;
      ptyRef.current = id;
```

Import `useActivity` from `./activity` if the file does not already. The teardown's `if (ptyId) void platform.pty.release(ptyId);` (renamed in Task 8) stays.

- [ ] **Step 5: Run and watch them pass**

Run: `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
Expected: all pass. The existing "greets with the JKY wordmark before the shell speaks" still passes: the banner is written before attach.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/terminal
git commit -m "feat(terminal): a pane rejoins its shell, and draws what it missed instead of what it had"
```

---

### Task 10: Closing ends, starting prunes, quitting asks less

**Files:**
- Modify: `apps/desktop/src/app/tabStore.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/features/terminal/quitting.ts`
- Test: `apps/desktop/src/app/tabStore.test.ts`, `apps/desktop/src/App.test.tsx`, `apps/desktop/src/features/terminal/quitting.test.ts`

**Interfaces:**
- Consumes: `pty.end`, `pty.prune` (Task 8); `runningCount(panes, survivors)` (Task 9).

- [ ] **Step 1: Write the failing tests**

`tabStore.test.ts` (use the file's existing reset in `beforeEach`; add the platform override):

```ts
describe("closing ends the shells in it", () => {
  const ended: string[] = [];
  beforeEach(() => {
    ended.length = 0;
    const base = createWebPlatform();
    __setPlatformForTests({ ...base, pty: { ...base.pty, end: async (pane) => void ended.push(pane) } });
  });
  afterEach(() => __setPlatformForTests(null));

  it("ends the shell of a closed pane, and only that one", () => {
    const tab = useTabs.getState().openTab("terminal", "Terminal");
    useTabs.getState().splitPane(tab, tab, "right");
    const [first, second] = allPaneKeys(useTabs.getState().tabs);
    useTabs.getState().closePane(tab, second);
    expect(ended).toEqual([second]);
    expect(ended).not.toContain(first);
  });

  it("ends the shell of every pane in a closed tab", () => {
    const tab = useTabs.getState().openTab("terminal", "Terminal");
    useTabs.getState().splitPane(tab, tab, "down");
    const panes = allPaneKeys(useTabs.getState().tabs.filter((t) => t.id === tab));
    useTabs.getState().closeTab(tab);
    expect(ended.sort()).toEqual([...panes].sort());
  });
});
```

`App.test.tsx`:

```ts
it("prunes held shells at startup by the same list the scrollback is pruned by", async () => {
  const pruned: string[][] = [];
  const scrolled: string[][] = [];
  const base = createWebPlatform();
  __setPlatformForTests({
    ...base,
    pty: { ...base.pty, prune: async (panes) => void pruned.push(panes) },
    scrollback: { ...base.scrollback, prune: async (keys) => void scrolled.push(keys) },
  });
  render(<App />);
  await waitFor(() => expect(pruned).toHaveLength(1));
  expect(pruned[0]).toEqual(scrolled[0]);
});
```

`quitting.test.ts`:

```ts
  it("does not claim that every shell dies with the window, because most do not", () => {
    expect(quitBody(0, 1)).not.toMatch(/^A shell is/);
    expect(quitBody(0, 1)).toContain("child of this window");
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @jky/desktop exec vitest run src/app/tabStore.test.ts src/App.test.tsx src/features/terminal/quitting.test.ts`
Expected: FAIL — `ended` is empty; `pruned` never called; body begins "A shell is".

- [ ] **Step 3: Implement**

`tabStore.ts` `closeTab` loop:

```ts
    for (const key of leaves(tabs[index].layout)) {
      void platform.scrollback.forget(key).catch(() => {});
      // Closing is the one thing that ends a shell now that shells outlive
      // the window. A terminal merely unmounting lets go of it instead.
      void platform.pty.end(key).catch(() => {});
      useActivity.getState().forget(key);
    }
```

`closePane`, beside its `scrollback.forget`:

```ts
    void getPlatform().pty.end(paneId).catch(() => {});
```

`App.tsx` startup prune effect, beside `scrollback.prune`:

```ts
    // Shells held for panes that no longer exist — closed while a crash kept
    // the hang-up from arriving — are ended by the same list.
    void getPlatform().pty.prune(keys).catch(() => {});
```

`App.tsx` quit count:

```ts
  /** Terminals mid-command that quitting would lose, read when asked. */
  const stillRunning = () => {
    const { panes, survivors } = useActivity.getState();
    return runningCount(panes, survivors);
  };
```

`quitting.ts` `quitBody`:

```ts
  const lost =
    running > 0
      ? "Those shells are each a child of this window, so anything still going in them stops when it closes."
      : "";
```

- [ ] **Step 4: Run and watch everything pass**

Run: `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(terminal): closing a pane ends its shell, and quitting stops asking about ones that survive"
```

---

### Task 11: Say what it does

**Files:**
- Modify: `docs/FEATURES.md`, `README.md`

- [ ] **Step 1: Add a FEATURES.md section after "Splits"**

```markdown
## Terminals outlive the window

Close the window in the middle of a build and the build keeps going. Open the
app again and each pane is back on the shell it had, showing what it printed
while nobody was looking.

A shell used to be a child of the window, and a child dies with its parent.
Now each pane's shell is held by a small supervisor — this same program, run
with `--supervise` — and the window is only ever a client of it. The window
closing is an ordinary disconnect.

**Closing a pane ends its shell.** Quitting does not, and a terminal merely
leaving the screen does not either. Those are different acts and the app
treats them differently.

**Quitting asks only about what it would lose**: unsaved files, and commands in
a remote session, which is still a child of the window.

**Nobody else can reach them.** On Unix the sockets live in a directory only
you can enter; on Windows each pipe admits its owner and no one else.

**Nothing is left behind by accident.** A supervisor ends when its shell does,
and on start the app ends any held shell no pane claims.
```

- [ ] **Step 2: README** — change the Terminal row to

```markdown
| ❯ | **Terminal** | A real pty. Split it any way. Close the window; the shells keep running. |
```

and update the test badge to the counts `pnpm -w test` and `cargo test --workspace` report (tests including skipped/ignored).

- [ ] **Step 3: Commit**

```bash
git add docs/FEATURES.md README.md
git commit -m "docs: terminals outlive the window"
```

---

### Task 12: Prove it on three platforms, then merge

- [ ] **Step 1: Full local verification**

```bash
pnpm run verify
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all pass. Say plainly that this is Linux only.

- [ ] **Step 2: Drive the real app** — `pnpm dev:desktop`; in a terminal run `sleep 120; echo DONE`; close the window; `pgrep -af -- '--supervise'` shows the supervisor; relaunch; the pane shows the running command and later `DONE`. Close the pane; the supervisor is gone.

- [ ] **Step 3: Push the branch and open a draft PR** — CI runs on `pull_request`, not on branch pushes.

```bash
git push -u origin feat/detach-wiring
gh pr create --draft --base main --title "Terminals that outlive the window" --body-file <body>
```

The body says what changed and why, and names the Linux-only local verification. No generated-with notice.

- [ ] **Step 4: Watch CI for the head commit, not the newest run**

```bash
gh run list --commit "$(git rev-parse HEAD)"
```

Fix failures with new commits on the branch; repeat until `Native (ubuntu-latest)`, `Native (macos-latest)` and `Native (windows-latest)` are all green.

- [ ] **Step 5: Merge by fast-forward**

```bash
git checkout main && git pull --ff-only
git merge --ff-only feat/detach-wiring
git push origin main
```

Then watch CI for `main`'s head commit the same way.
