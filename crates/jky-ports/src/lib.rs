//! What is listening on this machine.
//!
//! "What is on port 3000, and how do I stop it" is the question a terminal
//! gets asked most often and answers worst. `lsof -i -P -n | grep LISTEN` is
//! the incantation people keep in a note somewhere; `ss -tulpn` is the other
//! one; neither exists on Windows, and the columns differ between the BSD and
//! GNU versions of the first. So the socket table is read directly rather
//! than by running somebody's netstat and parsing the shape of its output.
//!
//! Two things this reports that a raw socket list does not:
//!
//! - **One row per port, not one per address family.** A server bound to both
//!   stacks appears twice in the kernel's table — `0.0.0.0:3000` and
//!   `[::]:3000` — which is true and is not what anybody asked. They are the
//!   same server on the same port and they collapse into one row.
//! - **Whether it is reachable from outside this machine.** A dev server on
//!   `127.0.0.1` is private; the same server on `0.0.0.0` is offering itself
//!   to every other device on the network, which on a café's wifi is a
//!   different thing entirely. The distinction costs nothing to compute and
//!   is invisible in every tool that prints a bind address and moves on.
//!
//! The arranging is kept apart from the reading, the same way `jky-system`
//! keeps them apart and for the same reason: the sort and the merge are the
//! parts worth testing, and they can be tested against a table written here
//! instead of against whatever this computer happens to be running.

use std::collections::BTreeMap;
use std::net::IpAddr;

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PortsError {
    #[error("the socket table could not be read: {0}")]
    Read(String),
}

/// Which protocol a port was claimed with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Tcp,
    Udp,
}

impl Protocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Protocol::Tcp => "tcp",
            Protocol::Udp => "udp",
        }
    }
}

/// How far a listener can be reached from.
///
/// The one piece of judgement in this file, and the reason it is here rather
/// than in the window: it is a fact about the bind address, and a fact
/// belongs next to the thing it is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    /// Bound to loopback. Nothing outside this machine can connect.
    Local,
    /// Bound to a real interface, or to every interface. Other machines can.
    Network,
}

/// One row of the kernel's table, before anything is merged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Socket {
    pub port: u16,
    pub protocol: Protocol,
    pub addr: IpAddr,
    /// Absent when the socket belongs to a process this user cannot see.
    pub pid: Option<u32>,
}

/// What a process id belongs to. Supplied by the caller.
///
/// This crate deliberately does not resolve names itself. The app already
/// keeps a process sampler alive for the status readout, and walking every
/// process a second time — on a timer, to label a dozen ports — would be
/// paying twice for an answer it already has.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Owner {
    pub name: String,
    /// The full command, for telling four `node` servers apart.
    pub command: String,
}

/// One thing listening, as the panel shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Listener {
    pub port: u16,
    pub protocol: Protocol,
    pub reach: Reach,
    /// Absent when the owning process belongs to another user.
    pub pid: Option<u32>,
    /// Empty when the pid is unknown or names nothing this user can see.
    pub process: String,
    pub command: String,
    /// Every address this port is bound on, for the row's detail line.
    pub addresses: Vec<String>,
}

/// How the list is ordered before it is cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortSort {
    /// Ascending. The order you think in when you are looking for 3000.
    Port,
    Process,
    /// What can be reached from the network, first.
    Reach,
}

/// The most rows a list will carry.
///
/// A machine with more listeners than this has something wrong with it, and
/// a list that long is scrolled past rather than read.
pub const MAX_PORTS: usize = 300;

/// Whether an address is only reachable from this machine.
///
/// The unspecified addresses — `0.0.0.0` and `::` — mean "every interface",
/// which is the opposite of loopback however much they look like a default.
pub fn is_local(addr: &IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

/// Merge, label, filter, sort and cut.
///
/// The merge is by port, protocol and owner rather than by port alone: two
/// different processes on the same port number over different protocols is
/// unusual but legal, and folding them together would name the wrong one as
/// the thing to stop.
pub fn arrange(
    sockets: Vec<Socket>,
    owners: &BTreeMap<u32, Owner>,
    sort: PortSort,
    needle: &str,
    limit: usize,
) -> Vec<Listener> {
    // Keyed in a BTreeMap so the merge is deterministic without a sort —
    // two runs against the same table produce the same rows in the same
    // order, which is what makes this testable at all.
    let mut merged: BTreeMap<(u16, Protocol, Option<u32>), Listener> = BTreeMap::new();

    for socket in sockets {
        let key = (socket.port, socket.protocol, socket.pid);
        let owner = socket.pid.and_then(|pid| owners.get(&pid)).cloned().unwrap_or_default();

        let entry = merged.entry(key).or_insert_with(|| Listener {
            port: socket.port,
            protocol: socket.protocol,
            // Raised to Network by any address that is not loopback, below.
            reach: Reach::Local,
            pid: socket.pid,
            process: owner.name,
            command: owner.command,
            addresses: Vec::new(),
        });

        if !is_local(&socket.addr) {
            entry.reach = Reach::Network;
        }

        let shown = socket.addr.to_string();
        if !entry.addresses.contains(&shown) {
            entry.addresses.push(shown);
        }
    }

    let mut rows: Vec<Listener> = merged.into_values().collect();
    for row in &mut rows {
        row.addresses.sort();
    }

    let needle = needle.trim().to_lowercase();
    if !needle.is_empty() {
        rows.retain(|row| {
            // The port matches on its own digits rather than as a substring
            // of them: searching 80 should not hand back 8080, which is the
            // one port you were trying to tell it apart from.
            row.port.to_string() == needle
                || row.process.to_lowercase().contains(&needle)
                || row.command.to_lowercase().contains(&needle)
                || row.pid.is_some_and(|pid| pid.to_string() == needle)
                || row.protocol.as_str() == needle
        });
    }

    match sort {
        PortSort::Port => rows.sort_by_key(|r| (r.port, r.protocol)),
        PortSort::Process => rows.sort_by(|a, b| {
            a.process
                .to_lowercase()
                .cmp(&b.process.to_lowercase())
                .then(a.port.cmp(&b.port))
        }),
        // Reachable first, then by port, so the rows worth looking at are the
        // ones you do not have to scroll to.
        PortSort::Reach => rows.sort_by_key(|r| (r.reach == Reach::Local, r.port)),
    }

    rows.truncate(limit);
    rows
}

/// Read the kernel's socket table.
///
/// Listening sockets only. An established connection is a different question
/// from "what is holding this port", and a table with every open socket in it
/// is the wall of text this panel exists to replace.
///
/// UDP has no listen state — a bound UDP socket is the closest thing there
/// is, so all of them are reported.
///
/// On Linux and macOS a process belonging to another user reports no pid.
/// That is the kernel declining to say rather than an error, so the row is
/// kept with an empty owner: knowing *something* holds port 80 is useful even
/// when this user is not allowed to know what.
pub fn sockets() -> Result<Vec<Socket>, PortsError> {
    use netstat2::{AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};

    let info = netstat2::get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP | ProtocolFlags::UDP,
    )
    .map_err(|e| PortsError::Read(e.to_string()))?;

    Ok(info
        .into_iter()
        .filter_map(|entry| {
            let pid = entry.associated_pids.first().copied();
            match entry.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) if tcp.state == TcpState::Listen => Some(Socket {
                    port: tcp.local_port,
                    protocol: Protocol::Tcp,
                    addr: tcp.local_addr,
                    pid,
                }),
                ProtocolSocketInfo::Tcp(_) => None,
                ProtocolSocketInfo::Udp(udp) => Some(Socket {
                    port: udp.local_port,
                    protocol: Protocol::Udp,
                    addr: udp.local_addr,
                    pid,
                }),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sock(port: u16, addr: &str, pid: Option<u32>) -> Socket {
        Socket {
            port,
            protocol: Protocol::Tcp,
            addr: addr.parse().expect("address"),
            pid,
        }
    }

    fn owners(pairs: &[(u32, &str, &str)]) -> BTreeMap<u32, Owner> {
        pairs
            .iter()
            .map(|(pid, name, cmd)| {
                (
                    *pid,
                    Owner {
                        name: (*name).to_string(),
                        command: (*cmd).to_string(),
                    },
                )
            })
            .collect()
    }

    fn all(sockets: Vec<Socket>, owners: &BTreeMap<u32, Owner>) -> Vec<Listener> {
        arrange(sockets, owners, PortSort::Port, "", MAX_PORTS)
    }

    // The whole reason this is not a socket list.
    #[test]
    fn one_server_on_both_stacks_is_one_row() {
        let rows = all(
            vec![
                sock(3000, "0.0.0.0", Some(42)),
                sock(3000, "::", Some(42)),
            ],
            &owners(&[(42, "node", "node server.js")]),
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].port, 3000);
        assert_eq!(rows[0].addresses, vec!["0.0.0.0", "::"]);
    }

    #[test]
    fn two_processes_on_one_port_stay_apart() {
        let rows = all(
            vec![sock(8080, "0.0.0.0", Some(1)), sock(8080, "127.0.0.1", Some(2))],
            &owners(&[(1, "caddy", "caddy run"), (2, "vite", "vite dev")]),
        );
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn the_same_protocol_on_one_port_does_not_hide_the_other() {
        let udp = Socket {
            protocol: Protocol::Udp,
            ..sock(53, "127.0.0.1", Some(7))
        };
        let rows = all(vec![sock(53, "127.0.0.1", Some(7)), udp], &owners(&[]));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].protocol, Protocol::Tcp);
        assert_eq!(rows[1].protocol, Protocol::Udp);
    }

    // The distinction the panel exists to make visible.
    #[test]
    fn loopback_is_private_and_everything_else_is_not() {
        let rows = all(
            vec![
                sock(3000, "127.0.0.1", Some(1)),
                sock(4000, "0.0.0.0", Some(2)),
                sock(5000, "192.168.1.7", Some(3)),
                sock(6000, "::1", Some(4)),
            ],
            &owners(&[]),
        );

        assert_eq!(rows[0].reach, Reach::Local, "127.0.0.1");
        // Unspecified means every interface, however much it looks like none.
        assert_eq!(rows[1].reach, Reach::Network, "0.0.0.0");
        assert_eq!(rows[2].reach, Reach::Network, "a real interface");
        assert_eq!(rows[3].reach, Reach::Local, "::1");
    }

    #[test]
    fn a_port_on_loopback_and_a_real_interface_counts_as_reachable() {
        // Bound twice, once privately and once not. The row has to report the
        // worse of the two: it *is* reachable, whatever else is also true.
        let rows = all(
            vec![sock(3000, "127.0.0.1", Some(1)), sock(3000, "192.168.1.7", Some(1))],
            &owners(&[]),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reach, Reach::Network);
    }

    #[test]
    fn a_socket_this_user_cannot_see_still_says_the_port_is_taken() {
        let rows = all(vec![sock(80, "0.0.0.0", None)], &owners(&[]));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, None);
        assert_eq!(rows[0].process, "");
    }

    #[test]
    fn a_pid_nobody_can_name_leaves_the_row_rather_than_removing_it() {
        let rows = all(vec![sock(9000, "0.0.0.0", Some(999))], &owners(&[]));
        assert_eq!(rows[0].pid, Some(999));
        assert_eq!(rows[0].process, "");
    }

    #[test]
    fn the_owner_is_named_from_what_the_caller_knew() {
        let rows = all(
            vec![sock(5173, "127.0.0.1", Some(42))],
            &owners(&[(42, "node", "node vite dev")]),
        );
        assert_eq!(rows[0].process, "node");
        assert_eq!(rows[0].command, "node vite dev");
    }

    // The one that makes the search worth having.
    #[test]
    fn searching_a_port_does_not_match_a_longer_one() {
        let table = vec![sock(80, "0.0.0.0", Some(1)), sock(8080, "0.0.0.0", Some(2))];
        let found = arrange(table, &owners(&[]), PortSort::Port, "80", MAX_PORTS);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].port, 80);
    }

    #[test]
    fn searching_finds_a_process_by_name_or_by_what_it_is_running() {
        let table = vec![sock(3000, "0.0.0.0", Some(1)), sock(5432, "127.0.0.1", Some(2))];
        let known = owners(&[(1, "node", "node server.js"), (2, "postgres", "postgres -D /var")]);

        assert_eq!(
            arrange(table.clone(), &known, PortSort::Port, "node", MAX_PORTS).len(),
            1
        );
        // Four `node` processes are told apart only by what they are running.
        assert_eq!(
            arrange(table.clone(), &known, PortSort::Port, "server.js", MAX_PORTS)[0].port,
            3000
        );
        assert!(arrange(table, &known, PortSort::Port, "nothing-here", MAX_PORTS).is_empty());
    }

    #[test]
    fn searching_finds_a_process_by_its_pid() {
        let table = vec![sock(3000, "0.0.0.0", Some(4242))];
        assert_eq!(
            arrange(table, &owners(&[]), PortSort::Port, "4242", MAX_PORTS).len(),
            1
        );
    }

    #[test]
    fn ports_sort_in_the_order_you_think_in() {
        let rows = all(
            vec![
                sock(8080, "0.0.0.0", Some(1)),
                sock(22, "0.0.0.0", Some(2)),
                sock(3000, "0.0.0.0", Some(3)),
            ],
            &owners(&[]),
        );
        let ports: Vec<u16> = rows.iter().map(|r| r.port).collect();
        assert_eq!(ports, vec![22, 3000, 8080]);
    }

    #[test]
    fn sorting_by_process_is_by_name_then_port() {
        let rows = arrange(
            vec![
                sock(9000, "0.0.0.0", Some(1)),
                sock(3000, "0.0.0.0", Some(1)),
                sock(5432, "0.0.0.0", Some(2)),
            ],
            &owners(&[(1, "node", ""), (2, "postgres", "")]),
            PortSort::Process,
            "",
            MAX_PORTS,
        );
        let seen: Vec<(String, u16)> = rows.iter().map(|r| (r.process.clone(), r.port)).collect();
        assert_eq!(
            seen,
            vec![
                ("node".into(), 3000),
                ("node".into(), 9000),
                ("postgres".into(), 5432)
            ]
        );
    }

    #[test]
    fn sorting_by_reach_puts_what_the_network_can_see_first() {
        let rows = arrange(
            vec![
                sock(3000, "127.0.0.1", Some(1)),
                sock(9000, "0.0.0.0", Some(2)),
                sock(4000, "::1", Some(3)),
            ],
            &owners(&[]),
            PortSort::Reach,
            "",
            MAX_PORTS,
        );
        assert_eq!(rows[0].port, 9000);
        assert_eq!(rows[0].reach, Reach::Network);
    }

    #[test]
    fn a_machine_with_too_many_listeners_is_cut_after_sorting() {
        let many: Vec<Socket> = (1..=50)
            .map(|n| sock(1000 + n, "0.0.0.0", Some(n as u32)))
            .collect();
        let rows = arrange(many, &owners(&[]), PortSort::Port, "", 10);
        assert_eq!(rows.len(), 10);
        // Cut *after* sorting: the lowest ports, not the first ten read.
        assert_eq!(rows[0].port, 1001);
    }

    #[test]
    fn nothing_listening_is_an_empty_list_rather_than_an_error() {
        assert!(all(Vec::new(), &owners(&[])).is_empty());
    }

    // Reading the real table must not panic or hang on any supported OS. What
    // is on this machine is not something a test can assert.
    #[test]
    fn the_real_socket_table_can_be_read() {
        let found = sockets().expect("the socket table is readable");
        for socket in &found {
            assert!(socket.port > 0, "a listener on port 0 is not listening");
        }
    }
}
