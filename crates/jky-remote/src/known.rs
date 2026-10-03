//! Whether this machine already knows a host's key, and its fingerprint.
//!
//! The first connection to a host is the one moment ssh cannot protect you:
//! it shows a fingerprint and asks whether to trust it, and the only way to
//! answer honestly is to compare it with one you got some other way. So the
//! host list says, before you connect, whether `known_hosts` already holds a
//! key for the machine — and if so, its fingerprint, for checking against
//! what the server's owner gives you.
//!
//! Nothing is reimplemented that OpenSSH already does. `ssh -G` works out
//! where a saved host really goes — `HostName`, `Port` and `HostKeyAlias`
//! from your config, and which `known_hosts` files apply — and
//! `ssh-keygen -F` finds the entries for it, hashed ones included. What is
//! computed here is only the fingerprint, which is a SHA-256 of the key: the
//! same `SHA256:…` that ssh prints.

use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine as _;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::argv::ssh_args;
use crate::host::Host;

/// One key `known_hosts` holds for a host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KnownKey {
    /// `ED25519`, `ECDSA`, `RSA` …
    pub kind: String,
    /// `SHA256:…`, exactly as ssh prints it.
    pub fingerprint: String,
    /// Marked `@revoked`: ssh will refuse this key.
    pub revoked: bool,
}

/// What this machine knows about a host's key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KeyStatus {
    /// The name `known_hosts` is searched for: `host`, `[host]:port`, or a
    /// `HostKeyAlias`.
    pub lookup: String,
    pub keys: Vec<KnownKey>,
}

/// Where `ssh -G` says a host goes.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Resolved {
    hostname: String,
    port: u16,
    alias: Option<String>,
    files: Vec<String>,
}

/// Read `ssh -G` output: one `keyword value…` per line, keywords lower-case.
pub(crate) fn resolved(text: &str) -> Resolved {
    let mut r = Resolved { port: 22, ..Default::default() };
    for line in text.lines() {
        let Some((keyword, value)) = line.split_once(' ') else { continue };
        match keyword {
            "hostname" => r.hostname = value.trim().to_string(),
            "port" => r.port = value.trim().parse().unwrap_or(22),
            "hostkeyalias" if value.trim() != "none" => r.alias = Some(value.trim().to_string()),
            "userknownhostsfile" | "globalknownhostsfile" => {
                r.files.extend(value.split_whitespace().map(str::to_string));
            }
            _ => {}
        }
    }
    r
}

/// The name a host's keys are filed under.
pub(crate) fn lookup_name(r: &Resolved) -> String {
    match &r.alias {
        Some(alias) => alias.clone(),
        None if r.port == 22 => r.hostname.clone(),
        None => format!("[{}]:{}", r.hostname, r.port),
    }
}

fn kind_of(key_type: &str) -> String {
    let t = key_type.trim_start_matches("sk-").trim_start_matches("ssh-");
    if t.starts_with("ecdsa") {
        "ECDSA".into()
    } else if t.starts_with("ed25519") {
        "ED25519".into()
    } else if t.starts_with("rsa") {
        "RSA".into()
    } else {
        t.split('@').next().unwrap_or(t).to_ascii_uppercase()
    }
}

/// The key on one `known_hosts` line, with its fingerprint.
///
/// `[@marker] hosts key-type base64 [comment]`. The hosts field may be
/// hashed; it does not matter here, because `ssh-keygen -F` already chose
/// the lines that belong to this host.
pub(crate) fn key_of(line: &str) -> Option<KnownKey> {
    let mut fields = line.split_whitespace();
    let mut first = fields.next()?;
    let mut revoked = false;
    if first.starts_with('@') {
        revoked = first == "@revoked";
        if first == "@cert-authority" {
            // A CA, not this host's own key. Not what a fingerprint check compares.
            return None;
        }
        first = fields.next()?;
    }
    let _hosts = first;
    let key_type = fields.next()?;
    let blob = base64::engine::general_purpose::STANDARD.decode(fields.next()?).ok()?;
    let digest = Sha256::digest(&blob);
    let fingerprint = format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
    );
    Some(KnownKey { kind: kind_of(key_type), fingerprint, revoked })
}

fn expand(file: &str, home: Option<&Path>) -> PathBuf {
    match (file.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(file),
    }
}

/// Ask OpenSSH what this machine knows about a saved host's key.
///
/// Runs `ssh -G` — which reads configuration and never connects — and
/// `ssh-keygen -F` against each `known_hosts` file that exists. Neither
/// touches the network.
pub fn key_status(host: &Host, home: Option<&Path>) -> Result<KeyStatus, String> {
    let mut args: Vec<String> = ssh_args(host).map_err(|e| e.to_string())?;
    // The same options a connection would use, so the answer is about the
    // same destination; `-t` asks for a terminal, which -G has no use for.
    args.retain(|a| a != "-t");
    let out = Command::new("ssh")
        .arg("-G")
        .args(&args)
        .output()
        .map_err(|e| format!("could not run ssh to look the host up: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ssh could not resolve this host: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let r = resolved(&String::from_utf8_lossy(&out.stdout));
    let lookup = lookup_name(&r);

    let mut keys: Vec<KnownKey> = Vec::new();
    for file in &r.files {
        let path = expand(file, home);
        if !path.is_file() {
            continue;
        }
        let Ok(found) = Command::new("ssh-keygen").arg("-F").arg(&lookup).arg("-f").arg(&path).output() else {
            continue;
        };
        for line in String::from_utf8_lossy(&found.stdout).lines() {
            if line.starts_with('#') {
                continue;
            }
            if let Some(key) = key_of(line) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
    }
    Ok(KeyStatus { lookup, keys })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A throwaway public key, made for this test with `ssh-keygen -t
    // ed25519`. `ssh-keygen -lf` printed the fingerprint asserted below.
    const LINE: &str = "prod.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATsWEV9nZ02Rw2I1apzZqocOmY1t26fYWPAWkfplBa1";
    const FINGERPRINT: &str = "SHA256:sjivcpnN4sgWw3J3ceIKnEQl6N4y8WeSnpbpf1qAeBY";

    #[test]
    fn a_fingerprint_is_the_one_ssh_prints() {
        let key = key_of(LINE).unwrap();
        assert_eq!(key.fingerprint, FINGERPRINT);
        assert_eq!(key.kind, "ED25519");
        assert!(!key.revoked);
    }

    #[test]
    fn a_hashed_entry_is_fingerprinted_the_same_way() {
        let hashed = "|1|vMSY7QtnUJ0TwwLPUAQhEJHyw3c=|R+daSeabb06XLAzdp7ijme62niI= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATsWEV9nZ02Rw2I1apzZqocOmY1t26fYWPAWkfplBa1";
        assert_eq!(key_of(hashed).unwrap().fingerprint, FINGERPRINT);
    }

    #[test]
    fn a_revoked_key_says_so_and_a_certificate_authority_is_not_a_host_key() {
        assert!(key_of(&format!("@revoked {LINE}")).unwrap().revoked);
        assert!(key_of(&format!("@cert-authority {LINE}")).is_none());
    }

    #[test]
    fn a_line_that_is_not_a_key_is_nothing() {
        assert!(key_of("").is_none());
        assert!(key_of("prod.example.com ssh-ed25519 not*base64").is_none());
    }

    #[test]
    fn ssh_g_output_says_where_a_host_really_goes() {
        let r = resolved(
            "user deploy\nhostname 203.0.113.10\nport 2222\n\
             userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2\n\
             globalknownhostsfile /etc/ssh/ssh_known_hosts\n",
        );
        assert_eq!(lookup_name(&r), "[203.0.113.10]:2222");
        assert_eq!(r.files, ["~/.ssh/known_hosts", "~/.ssh/known_hosts2", "/etc/ssh/ssh_known_hosts"]);
    }

    #[test]
    fn the_default_port_is_filed_under_the_bare_name_and_an_alias_wins() {
        assert_eq!(lookup_name(&resolved("hostname example.com\nport 22\n")), "example.com");
        assert_eq!(
            lookup_name(&resolved("hostname example.com\nport 2222\nhostkeyalias prod-key\n")),
            "prod-key"
        );
    }

    #[test]
    fn key_types_read_the_way_ssh_names_them() {
        assert_eq!(kind_of("ecdsa-sha2-nistp256"), "ECDSA");
        assert_eq!(kind_of("ssh-rsa"), "RSA");
        assert_eq!(kind_of("sk-ssh-ed25519@openssh.com"), "ED25519");
    }

    /// End to end against the real tools, where they exist: a known_hosts
    /// with this key, hashed, is found for the host and fingerprinted.
    #[test]
    fn the_real_tools_find_a_known_key() {
        let have = |tool: &str| Command::new(tool).arg("-V").output().is_ok();
        if !have("ssh") {
            eprintln!("no ssh on this machine; skipping");
            return;
        }
        let home = tempfile::TempDir::new().unwrap();
        let ssh = home.path().join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        let known = ssh.join("known_hosts");
        std::fs::write(&known, format!("{LINE}\n")).unwrap();

        let host = Host {
            id: "h".into(),
            label: String::new(),
            address: "prod.example.com".into(),
            user: String::new(),
            port: None,
            identity_file: None,
            jump: None,
            last_used: 0,
        };
        // The user known_hosts file is named explicitly, so the machine's
        // own ~/.ssh is never read by a test.
        let r = resolved(&format!("hostname prod.example.com\nport 22\nuserknownhostsfile {}\n", known.display()));
        assert_eq!(lookup_name(&r), "prod.example.com");
        let found = Command::new("ssh-keygen").arg("-F").arg("prod.example.com").arg("-f").arg(&known).output().unwrap();
        let keys: Vec<KnownKey> = String::from_utf8_lossy(&found.stdout)
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(key_of)
            .collect();
        assert_eq!(keys.len(), 1, "{}", String::from_utf8_lossy(&found.stdout));
        assert_eq!(keys[0].fingerprint, FINGERPRINT);

        // And the whole path runs without error for a host it does not know.
        let status = key_status(&host, Some(home.path())).expect("ssh -G resolves without connecting");
        assert_eq!(status.lookup, "prod.example.com");
    }
}
