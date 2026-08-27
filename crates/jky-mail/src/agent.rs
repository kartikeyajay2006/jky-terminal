//! Registering a helper with the operating system, so alerts arrive with the
//! app closed.
//!
//! Every backend is per-user and needs no administrator rights: a systemd
//! user timer, a launchd LaunchAgent, a Task Scheduler entry under the
//! current account. Turning alerts off removes what was installed.
//!
//! None of it can do anything while the machine is off. Nothing running on
//! the machine can, and saying otherwise would be a lie the user only
//! discovers by missing something.

use std::path::{Path, PathBuf};

/// How often the helper wakes.
///
/// The shortest lead time offered is thirty minutes, so five is frequent
/// enough that an alert is never more than five minutes late, and rare enough
/// to be invisible.
pub const INTERVAL_MINUTES: u32 = 5;

/// The name the helper is registered under, on every platform.
pub const AGENT_ID: &str = "dev.jky.terminal.alerts";

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("could not write {path}: {message}")]
    Write { path: String, message: String },
    #[error("{0}")]
    Register(String),
}

/// A file the agent installation writes, and where.
#[derive(Debug, PartialEq, Eq)]
pub struct AgentFile {
    pub path: PathBuf,
    pub body: String,
    /// Whether it has to be executable.
    pub executable: bool,
}

// --- Linux ------------------------------------------------------------------

/// A systemd user timer and the service it starts.
///
/// User units, under the user's own config directory: no root, and they run
/// as the person who owns the events file.
#[cfg(any(target_os = "linux", test))]
pub fn linux_units(home: &Path, exe: &Path) -> Vec<AgentFile> {
    let dir = home.join(".config/systemd/user");
    vec![
        AgentFile {
            path: dir.join(format!("{AGENT_ID}.service")),
            body: format!(
                "[Unit]\n\
                 Description=JKY Terminal event alerts\n\
                 \n\
                 [Service]\n\
                 Type=oneshot\n\
                 ExecStart={exe} --send-alerts\n",
                exe = exe.display()
            ),
            executable: false,
        },
        AgentFile {
            path: dir.join(format!("{AGENT_ID}.timer")),
            body: format!(
                "[Unit]\n\
                 Description=Check JKY Terminal event alerts every {INTERVAL_MINUTES} minutes\n\
                 \n\
                 [Timer]\n\
                 OnBootSec=2min\n\
                 OnUnitActiveSec={INTERVAL_MINUTES}min\n\
                 # Runs the check on wake if the machine slept through one.\n\
                 Persistent=true\n\
                 \n\
                 [Install]\n\
                 WantedBy=timers.target\n"
            ),
            executable: false,
        },
    ]
}

// --- macOS ------------------------------------------------------------------

/// A launchd LaunchAgent, in the user's own LaunchAgents directory.
#[cfg(any(target_os = "macos", test))]
pub fn macos_plist(home: &Path, exe: &Path) -> AgentFile {
    AgentFile {
        path: home.join("Library/LaunchAgents").join(format!("{AGENT_ID}.plist")),
        body: format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{AGENT_ID}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
        <string>--send-alerts</string>
    </array>
    <key>StartInterval</key>
    <integer>{seconds}</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
            exe = exe.display(),
            seconds = INTERVAL_MINUTES * 60,
        ),
        executable: false,
    }
}

// --- Windows ----------------------------------------------------------------

/// The arguments that create the scheduled task.
///
/// `/sc minute /mo 5` under the current account, so it needs no elevation.
pub fn windows_create_args(exe: &Path) -> Vec<String> {
    vec![
        "/create".into(),
        "/tn".into(),
        AGENT_ID.into(),
        "/tr".into(),
        // Quoted, because Program Files has a space in it and the whole thing
        // is one argument to schtasks.
        format!("\"{}\" --send-alerts", exe.display()),
        "/sc".into(),
        "minute".into(),
        "/mo".into(),
        INTERVAL_MINUTES.to_string(),
        // Replace rather than fail if one is already there, so enabling twice
        // is not an error.
        "/f".into(),
    ]
}

pub fn windows_delete_args() -> Vec<String> {
    vec!["/delete".into(), "/tn".into(), AGENT_ID.into(), "/f".into()]
}

// --- installing and removing ------------------------------------------------

fn write(file: &AgentFile) -> Result<(), AgentError> {
    if let Some(dir) = file.path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AgentError::Write {
            path: file.path.display().to_string(),
            message: e.to_string(),
        })?;
    }
    std::fs::write(&file.path, &file.body).map_err(|e| AgentError::Write {
        path: file.path.display().to_string(),
        message: e.to_string(),
    })?;

    #[cfg(unix)]
    if file.executable {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file.path, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

/// Run a command and turn a non-zero exit into an error carrying its output.
///
/// The interesting failures here are all in stderr — a systemd unit that will
/// not load, a task name that is not allowed — and discarding it leaves the
/// user with "it did not work".
fn run(program: &str, args: &[&str]) -> Result<(), AgentError> {
    let out = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|e| AgentError::Register(format!("could not run {program}: {e}")))?;

    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let detail = if stderr.trim().is_empty() { stdout } else { stderr };
    Err(AgentError::Register(format!("{program} failed: {}", detail.trim())))
}

/// Register the helper so alerts arrive with the app closed.
#[cfg(target_os = "linux")]
pub fn install(home: &Path, exe: &Path) -> Result<(), AgentError> {
    for unit in linux_units(home, exe) {
        write(&unit)?;
    }
    // Reload first, or systemd starts the version it read at boot.
    run("systemctl", &["--user", "daemon-reload"])?;
    run("systemctl", &["--user", "enable", "--now", &format!("{AGENT_ID}.timer")])
}

#[cfg(target_os = "linux")]
pub fn uninstall(home: &Path) -> Result<(), AgentError> {
    // Disabling before removing the files; the other order leaves systemd
    // holding a unit it can no longer read.
    let _ = run("systemctl", &["--user", "disable", "--now", &format!("{AGENT_ID}.timer")]);
    let dir = home.join(".config/systemd/user");
    let _ = std::fs::remove_file(dir.join(format!("{AGENT_ID}.timer")));
    let _ = std::fs::remove_file(dir.join(format!("{AGENT_ID}.service")));
    let _ = run("systemctl", &["--user", "daemon-reload"]);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn install(home: &Path, exe: &Path) -> Result<(), AgentError> {
    let plist = macos_plist(home, exe);
    write(&plist)?;
    let path = plist.path.display().to_string();
    // Unload first: launchctl will not reload a label that is already there,
    // so enabling twice would otherwise silently keep the old command.
    let _ = run("launchctl", &["unload", &path]);
    run("launchctl", &["load", &path])
}

#[cfg(target_os = "macos")]
pub fn uninstall(home: &Path) -> Result<(), AgentError> {
    let path = home.join("Library/LaunchAgents").join(format!("{AGENT_ID}.plist"));
    let _ = run("launchctl", &["unload", &path.display().to_string()]);
    let _ = std::fs::remove_file(&path);
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn install(_home: &Path, exe: &Path) -> Result<(), AgentError> {
    let args = windows_create_args(exe);
    run("schtasks", &args.iter().map(String::as_str).collect::<Vec<_>>())
}

#[cfg(target_os = "windows")]
pub fn uninstall(_home: &Path) -> Result<(), AgentError> {
    let args = windows_delete_args();
    // A task that is not there is not a failure: the caller asked for it to
    // be gone, and it is.
    let _ = run("schtasks", &args.iter().map(String::as_str).collect::<Vec<_>>());
    Ok(())
}

/// Anything else. Compiles, and says plainly that it cannot do the job rather
/// than reporting success and delivering nothing.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn install(_home: &Path, _exe: &Path) -> Result<(), AgentError> {
    Err(AgentError::Register(
        "Background alerts are not supported on this platform yet. Alerts \
         still go out while JKY Terminal is open."
            .into(),
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn uninstall(_home: &Path) -> Result<(), AgentError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/someone")
    }

    fn exe() -> PathBuf {
        PathBuf::from("/opt/jky/jky-terminal")
    }

    #[test]
    fn the_interval_is_shorter_than_the_shortest_lead_time() {
        // The shortest alert offered is thirty minutes. A check less frequent
        // than that could miss it entirely.
        // A const block, so this is checked when the crate compiles rather
        // than when the suite runs.
        const { assert!(INTERVAL_MINUTES < 30) };
        const { assert!(INTERVAL_MINUTES >= 1) };
    }

    #[test]
    fn linux_units_go_under_the_users_own_config() {
        // A system unit would need root and would run as the wrong user, with
        // no access to the events file.
        //
        // Compared as paths, not as strings: these tests compile on every
        // platform, and on Windows a PathBuf joins with backslashes, so
        // looking for "/home/someone/.config" in the printed form fails on a
        // path that is perfectly correct.
        let expected = home().join(".config").join("systemd").join("user");
        for unit in linux_units(&home(), &exe()) {
            assert!(
                unit.path.starts_with(&expected),
                "{} is not under {}",
                unit.path.display(),
                expected.display()
            );
        }
    }

    #[test]
    fn the_linux_service_runs_the_headless_flag() {
        let units = linux_units(&home(), &exe());
        assert!(units[0].body.contains("--send-alerts"), "{}", units[0].body);
        assert!(units[0].body.contains("Type=oneshot"), "{}", units[0].body);
    }

    #[test]
    fn the_linux_timer_catches_up_after_the_machine_sleeps() {
        // Persistent=true is what makes a laptop closed over lunch run the
        // check on waking rather than silently skipping it.
        let units = linux_units(&home(), &exe());
        assert!(units[1].body.contains("Persistent=true"), "{}", units[1].body);
    }

    #[test]
    fn the_linux_timer_is_installed_into_timers_target() {
        // Without [Install] the timer cannot be enabled and never starts.
        let units = linux_units(&home(), &exe());
        assert!(units[1].body.contains("WantedBy=timers.target"), "{}", units[1].body);
    }

    #[test]
    fn the_macos_agent_goes_in_the_users_launch_agents() {
        let plist = macos_plist(&home(), &exe());
        let expected = home().join("Library").join("LaunchAgents");
        assert!(
            plist.path.starts_with(&expected),
            "{} is not under {}",
            plist.path.display(),
            expected.display()
        );
        assert_eq!(plist.path.extension().and_then(|e| e.to_str()), Some("plist"));
    }

    #[test]
    fn the_macos_agent_is_well_formed_enough_to_load() {
        let body = macos_plist(&home(), &exe()).body;
        assert!(body.starts_with("<?xml"), "{body}");
        assert!(body.contains("<key>Label</key>"), "{body}");
        assert!(body.contains(AGENT_ID), "{body}");
        assert!(body.contains("--send-alerts"), "{body}");
        assert!(body.trim().ends_with("</plist>"), "{body}");
    }

    #[test]
    fn the_macos_interval_is_in_seconds() {
        // StartInterval is seconds; passing minutes would check every five
        // seconds and hammer the mail server.
        let body = macos_plist(&home(), &exe()).body;
        assert!(body.contains(&format!("<integer>{}</integer>", INTERVAL_MINUTES * 60)), "{body}");
    }

    #[test]
    fn the_windows_task_quotes_a_path_with_spaces_in_it() {
        // Program Files has a space in it, and schtasks takes the command as
        // one argument.
        let args = windows_create_args(Path::new(r"C:\Program Files\JKY\jky-terminal.exe"));
        let run = args.iter().find(|a| a.contains("jky-terminal.exe")).unwrap();
        assert!(run.starts_with('"'), "{run}");
        assert!(run.contains(r#"" --send-alerts"#), "{run}");
    }

    #[test]
    fn the_windows_task_replaces_an_existing_one() {
        // Enabling twice should not be an error.
        assert!(windows_create_args(&exe()).contains(&"/f".to_string()));
    }

    #[test]
    fn the_windows_task_runs_on_the_same_interval() {
        let args = windows_create_args(&exe());
        let i = args.iter().position(|a| a == "/mo").unwrap();
        assert_eq!(args[i + 1], INTERVAL_MINUTES.to_string());
    }

    #[test]
    fn the_windows_task_is_removed_by_name_without_prompting() {
        let args = windows_delete_args();
        assert!(args.contains(&AGENT_ID.to_string()));
        assert!(args.contains(&"/f".to_string()), "would wait for an answer nobody sees");
    }

    #[test]
    fn every_platform_registers_under_the_same_name() {
        // So that turning alerts off finds what turning them on installed,
        // even across an upgrade.
        let named = |p: &std::path::Path| {
            p.file_name().map(|n| n.to_string_lossy().contains(AGENT_ID)).unwrap_or(false)
        };
        assert!(named(&linux_units(&home(), &exe())[0].path));
        assert!(named(&macos_plist(&home(), &exe()).path));
        assert!(windows_create_args(&exe()).contains(&AGENT_ID.to_string()));
    }
}
