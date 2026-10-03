//! The hosts already named in `~/.ssh/config`, offered for import.
//!
//! Importing copies a **name**, not a configuration. A host saved from here
//! has its alias as its address, and connecting runs the `ssh` this machine
//! already has — which reads `~/.ssh/config` itself and applies `HostName`,
//! `User`, `Port`, `ProxyJump` and everything else from the one place they
//! are kept. A copy would go stale the day the file changed; a name cannot.
//!
//! So this parser only has to answer "which concrete hosts are named here,
//! and what will they resolve to" well enough to show a list. It reads the
//! file the way ssh does — keywords in any case, `Key Value` or `Key=Value`,
//! comments, quoted values — and leaves out what cannot be imported: wildcard
//! and negated patterns, which name no single machine, and anything inside a
//! `Match` block, whose conditions only ssh can evaluate. It does not follow
//! `Include`; a host named only in an included file can still be added by
//! hand under its alias.

use serde::Serialize;

use crate::argv::validate;
use crate::host::Host;

/// One concrete host from the config, and what the file says about it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ConfigHost {
    /// The name after `Host` — what you would type after `ssh`.
    pub alias: String,
    /// `HostName`, when the alias is not the machine's real name.
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    /// `ProxyJump`: the machine it is reached through.
    pub jump: Option<String>,
}

/// Split one line into keyword and value, the way ssh does.
fn keyword_and_value(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let keyword = line[..split].to_ascii_lowercase();
    let rest = line[split..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    let rest = rest.trim();
    // A value in double quotes keeps its spaces; the quotes are not part of it.
    let value = rest.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(rest);
    Some((keyword, value.to_string()))
}

/// Whether a `Host` pattern names exactly one machine.
fn concrete(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.contains(['*', '?', '!'])
}

/// Every concrete host named in a config file's text, in file order.
pub fn parse(text: &str) -> Vec<ConfigHost> {
    let mut found: Vec<ConfigHost> = Vec::new();
    // Indexes into `found` that the current `Host` block applies to. Empty
    // inside a `Match` block, or a `Host` line naming only patterns.
    let mut current: Vec<usize> = Vec::new();

    for line in text.lines() {
        let Some((keyword, value)) = keyword_and_value(line) else { continue };
        match keyword.as_str() {
            "host" => {
                current.clear();
                for alias in value.split_whitespace().filter(|p| concrete(p)) {
                    // The first block naming a host wins, as it does in ssh:
                    // a later block only fills in what is still unset.
                    let at = match found.iter().position(|h| h.alias == alias) {
                        Some(at) => at,
                        None => {
                            found.push(ConfigHost { alias: alias.to_string(), ..Default::default() });
                            found.len() - 1
                        }
                    };
                    current.push(at);
                }
            }
            "match" => current.clear(),
            "hostname" | "user" | "port" | "proxyjump" => {
                for &at in &current {
                    let host = &mut found[at];
                    match keyword.as_str() {
                        "hostname" => {
                            host.hostname.get_or_insert_with(|| value.clone());
                        }
                        "user" => {
                            host.user.get_or_insert_with(|| value.clone());
                        }
                        "port" => {
                            if host.port.is_none() {
                                host.port = value.parse().ok().filter(|p| *p != 0);
                            }
                        }
                        _ => {
                            if value != "none" {
                                host.jump.get_or_insert_with(|| value.clone());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    found
}

/// The hosts worth offering: concrete, and safe to save under their alias.
///
/// An alias that would not pass the same check a hand-typed address does is
/// left out rather than offered and refused — the list is what can actually
/// be imported.
pub fn importable(text: &str) -> Vec<ConfigHost> {
    parse(text)
        .into_iter()
        .filter(|h| validate(&Host { address: h.alias.clone(), ..as_host_template() }).is_ok())
        .collect()
}

fn as_host_template() -> Host {
    Host {
        id: String::new(),
        label: String::new(),
        address: String::new(),
        user: String::new(),
        port: None,
        identity_file: None,
        jump: None,
        last_used: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = r#"
# Personal machines
Host prod
    HostName 203.0.113.10
    User deploy
    Port 2222
    ProxyJump bastion

Host bastion
  hostname bastion.example.com
  user=ops

Host web1 web2
    User www

Host *.internal !secret
    User nobody

Host *
    ServerAliveInterval 30
    User everyone

Match host prod exec "true"
    User hijacked

Host "quoted"
    HostName "spaced name"
"#;

    fn get<'a>(hosts: &'a [ConfigHost], alias: &str) -> &'a ConfigHost {
        hosts.iter().find(|h| h.alias == alias).unwrap_or_else(|| panic!("{alias} missing: {hosts:?}"))
    }

    #[test]
    fn named_hosts_are_listed_with_what_the_file_says_about_them() {
        let hosts = parse(CONFIG);
        let prod = get(&hosts, "prod");
        assert_eq!(prod.hostname.as_deref(), Some("203.0.113.10"));
        assert_eq!(prod.user.as_deref(), Some("deploy"));
        assert_eq!(prod.port, Some(2222));
        assert_eq!(prod.jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn keywords_are_read_in_any_case_and_with_an_equals_sign() {
        let bastion = parse(CONFIG).into_iter().find(|h| h.alias == "bastion").unwrap();
        assert_eq!(bastion.hostname.as_deref(), Some("bastion.example.com"));
        assert_eq!(bastion.user.as_deref(), Some("ops"));
    }

    #[test]
    fn one_line_can_name_several_hosts() {
        let hosts = parse(CONFIG);
        assert_eq!(get(&hosts, "web1").user.as_deref(), Some("www"));
        assert_eq!(get(&hosts, "web2").user.as_deref(), Some("www"));
    }

    #[test]
    fn patterns_name_no_single_machine_and_are_left_out() {
        let aliases: Vec<String> = parse(CONFIG).into_iter().map(|h| h.alias).collect();
        assert!(!aliases.iter().any(|a| a.contains('*') || a.contains('!')), "{aliases:?}");
        assert!(!aliases.contains(&"secret".to_string()), "a negated pattern is not a host");
    }

    #[test]
    fn the_first_value_wins_and_a_match_block_changes_nothing() {
        // `Host *` comes later, so it fills nothing already set; `Match` is
        // ssh's to evaluate, never ours.
        let prod = parse(CONFIG).into_iter().find(|h| h.alias == "prod").unwrap();
        assert_eq!(prod.user.as_deref(), Some("deploy"));
    }

    #[test]
    fn quoted_values_lose_their_quotes() {
        let hosts = parse(CONFIG);
        assert_eq!(get(&hosts, "quoted").hostname.as_deref(), Some("spaced name"));
    }

    #[test]
    fn only_hosts_that_could_be_saved_are_offered() {
        let text = "Host good\nHost -oProxyCommand=evil\nHost has/slash\n";
        let aliases: Vec<String> = importable(text).into_iter().map(|h| h.alias).collect();
        assert_eq!(aliases, ["good"]);
    }

    #[test]
    fn an_empty_or_comment_only_file_offers_nothing() {
        assert!(parse("").is_empty());
        assert!(parse("# nothing\n\n   # here\n").is_empty());
    }
}
