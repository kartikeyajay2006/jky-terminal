//! Starting a supervisor so that it is not a casualty of the window.
//!
//! A child is a child. On Unix it shares its parent's process group, so a
//! Ctrl+C aimed at whatever launched the window — `pnpm dev:desktop` in a
//! terminal, say — is delivered to it as well. On Windows it can share the
//! parent's job, and a job closed with kill-on-close takes it along. Neither
//! is something a shell meant to outlive the window can afford.

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
///
/// Its standard streams go nowhere: a supervisor talks through its socket,
/// and one holding the window's pipes open would keep them open after the
/// window had gone.
pub fn launch<I, S>(program: &Path, args: I) -> io::Result<u32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // A group of its own, so a signal meant for the window's group is not
    // meant for every shell the window ever opened.
    #[cfg(not(windows))]
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
        // A job that forbids breaking away refuses the whole spawn, with
        // access denied. Starting without it is still a shell — one that may
        // not survive that job, which is better than no shell at all.
        #[cfg(windows)]
        Err(e) if e.raw_os_error() == Some(5) => {
            use std::os::windows::process::CommandExt;
            command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
            command.spawn()?
        }
        Err(e) => return Err(e),
    };

    let pid = child.id();

    // Reaped on a thread of its own. A supervisor that ends while this window
    // is still open would otherwise sit in the process table as a zombie
    // until the window closed.
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_program_is_launched_and_its_pid_returned() {
        // This test binary, asked only to list its tests, exits at once on
        // every platform and needs nothing installed.
        let me = std::env::current_exe().expect("this test's own path");
        let pid = launch(&me, ["--list"]).expect("launch");
        assert!(pid > 0);
    }

    #[cfg(not(windows))]
    #[test]
    fn a_launched_process_leads_its_own_process_group() {
        let pid = launch(Path::new("/bin/sh"), ["-c", "sleep 5"]).expect("launch");

        let out = std::process::Command::new("ps")
            .args(["-o", "pgid=", "-p", &pid.to_string()])
            .output()
            .expect("ps");
        let pgid: u32 = String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .expect("a process group id");

        let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
        assert_eq!(pgid, pid, "it shares a group with whatever launched the window");
    }
}
