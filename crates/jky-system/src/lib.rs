//! What the machine is doing, for the status bar.
//!
//! Four numbers — processor, memory, disk, network — read here in Rust
//! because the window has no way to read them. That is the same boundary
//! everything else in this app crosses: `connect-src 'self'` and no ambient
//! authority in the renderer, so anything that touches the operating system
//! happens on this side and arrives as data.
//!
//! Reading the machine is done by `sysinfo`, which is the only part of this
//! that is genuinely platform-specific and the reason nothing here is: it
//! carries per-OS backends for Linux, macOS and Windows behind one API, and
//! this app supports all three.
//!
//! Everything that could be got wrong without a machine to test on — turning
//! two byte counters into a rate, deciding which of several mounted disks is
//! the one you meant, ignoring loopback — is a plain function with a test.
//! Only the reading itself needs hardware.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Disks, Networks, System};

/// One reading of the machine.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Status {
    /// Across all cores, 0–100.
    pub cpu_pct: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    /// The disk the user's own files are on, not necessarily the root one.
    pub disk_used: u64,
    pub disk_total: u64,
    /// Bytes per second since the previous sample, not since boot.
    pub net_rx_bps: u64,
    pub net_tx_bps: u64,
    /// How long the machine has been up, in seconds.
    pub uptime_s: u64,
}

/// A mounted filesystem, as much of one as choosing between them needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Mount {
    pub at: PathBuf,
    pub total: u64,
    pub available: u64,
}

impl Mount {
    /// What is used. Saturating, because a filesystem that reports more free
    /// space than it has — network mounts and some container overlays do —
    /// would otherwise wrap into an enormous number and draw a broken bar.
    pub fn used(&self) -> u64 {
        self.total.saturating_sub(self.available)
    }
}

/// Bytes over an interval, as bytes per second.
///
/// The interval is measured rather than assumed. The UI polls on a timer, but
/// a timer is a request: a sleeping window or a busy machine makes the real
/// gap longer, and dividing by the interval that was asked for reports
/// traffic that never happened.
pub fn rate(bytes: u64, elapsed: Duration) -> u64 {
    let seconds = elapsed.as_secs_f64();
    if seconds <= 0.0 {
        return 0;
    }
    (bytes as f64 / seconds) as u64
}

/// `used` as a percentage of `total`, clamped and never dividing by zero.
pub fn percent(used: u64, total: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    ((used as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32
}

/// The disk a path is on: the mount with the longest matching prefix.
///
/// Longest, not first. On a machine with `/`, `/home` and `/boot` mounted
/// separately, `/` is a prefix of every path and the wrong answer for almost
/// all of them — it would report the space on the system disk while the user
/// filled up a different one.
pub fn disk_for(mounts: &[Mount], path: &Path) -> Option<Mount> {
    mounts
        .iter()
        .filter(|m| path.starts_with(&m.at))
        .max_by_key(|m| m.at.as_os_str().len())
        .cloned()
}

/// Whether an interface is the machine talking to itself.
///
/// Excluded, because loopback carries every local service on the machine —
/// this app's own OAuth redirect among them — and counting it would report
/// network traffic that never touched a network.
pub fn is_loopback(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered == "lo" || lowered.starts_with("lo0") || lowered.contains("loopback")
}

/// Reads the machine, keeping what a rate needs between readings.
///
/// Stateful on purpose. Processor usage and network rates are both differences
/// between two moments, so something has to remember the previous one, and
/// that is here rather than in the command layer.
pub struct Sampler {
    system: System,
    disks: Disks,
    networks: Networks,
    /// When the last sample was taken, for turning byte counts into rates.
    last: Instant,
    home: PathBuf,
}

impl Sampler {
    pub fn new() -> Self {
        Self {
            system: System::new(),
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
            last: Instant::now(),
            // Where the user's files are. Falls back to root, which is always
            // mounted and is the honest answer when there is no home to find.
            home: std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/")),
        }
    }

    /// One reading.
    ///
    /// The first is not meaningful for processor or network — both are
    /// differences, and there is nothing yet to differ from — so a caller
    /// that shows the first reading shows zero. The status bar polls on a
    /// timer, so that lasts one interval.
    pub fn sample(&mut self) -> Status {
        self.system.refresh_memory();
        self.system.refresh_cpu_usage();
        self.disks.refresh(true);
        self.networks.refresh(true);

        let now = Instant::now();
        let elapsed = now.duration_since(self.last);
        self.last = now;

        let (rx, tx) = self
            .networks
            .list()
            .iter()
            .filter(|(name, _)| !is_loopback(name))
            .fold((0u64, 0u64), |(rx, tx), (_, data)| {
                (
                    rx.saturating_add(data.received()),
                    tx.saturating_add(data.transmitted()),
                )
            });

        let mounts: Vec<Mount> = self
            .disks
            .list()
            .iter()
            .map(|d| Mount {
                at: d.mount_point().to_path_buf(),
                total: d.total_space(),
                available: d.available_space(),
            })
            .collect();
        let disk = disk_for(&mounts, &self.home);

        Status {
            cpu_pct: self.system.global_cpu_usage().clamp(0.0, 100.0),
            mem_used: self.system.used_memory(),
            mem_total: self.system.total_memory(),
            disk_used: disk.as_ref().map(Mount::used).unwrap_or(0),
            disk_total: disk.as_ref().map(|d| d.total).unwrap_or(0),
            net_rx_bps: rate(rx, elapsed),
            net_tx_bps: rate(tx, elapsed),
            uptime_s: System::uptime(),
        }
    }
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, name: &str, cpu: f32, mem: u64, command: &str) -> Proc {
        Proc {
            pid,
            name: name.to_string(),
            cpu_pct: cpu,
            mem,
            started: 0,
            command: command.to_string(),
        }
    }

    fn sample_procs() -> Vec<Proc> {
        vec![
            proc(1, "systemd", 0.1, 9_000_000, "/sbin/init"),
            proc(42, "node", 12.0, 300_000_000, "node /home/me/server.js"),
            proc(43, "node", 3.0, 80_000_000, "node /home/me/build.js"),
            proc(99, "Firefox", 55.5, 2_000_000_000, "/usr/lib/firefox/firefox"),
        ]
    }

    // ---- arranging processes ----

    #[test]
    fn puts_the_busiest_first() {
        let out = arrange(sample_procs(), ProcSort::Cpu, "", 10);
        assert_eq!(out.first().unwrap().name, "Firefox");
        assert_eq!(out.last().unwrap().name, "systemd");
    }

    #[test]
    fn puts_the_largest_first_by_memory() {
        let out = arrange(sample_procs(), ProcSort::Memory, "", 10);
        assert_eq!(out.first().unwrap().pid, 99);
    }

    // Case-insensitive, or a list sorted by name puts every capitalised
    // program above every lowercase one and reads as unsorted.
    #[test]
    fn sorts_by_name_without_minding_capitals() {
        let names: Vec<String> = arrange(sample_procs(), ProcSort::Name, "", 10)
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, ["Firefox", "node", "node", "systemd"]);
    }

    /*
     * Searching the command, not only the name.
     *
     * Four processes called `node` are told apart by what they are running
     * and by nothing else, which is exactly when someone reaches for a
     * process list.
     */
    #[test]
    fn finds_a_process_by_what_it_is_running() {
        let out = arrange(sample_procs(), ProcSort::Cpu, "server.js", 10);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].pid, 42);
    }

    #[test]
    fn finds_a_process_by_name_whatever_the_capitals() {
        assert_eq!(arrange(sample_procs(), ProcSort::Cpu, "firefox", 10).len(), 1);
    }

    // The number is what you have when a crash log names one.
    #[test]
    fn finds_a_process_by_its_number() {
        let out = arrange(sample_procs(), ProcSort::Cpu, "42", 10);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].pid, 42);
    }

    #[test]
    fn finds_nothing_without_calling_it_an_error() {
        assert!(arrange(sample_procs(), ProcSort::Cpu, "nothing-here", 10).is_empty());
    }

    /*
     * Sorted before truncating, never after.
     *
     * A busy machine has thousands of processes. Cutting first would hand
     * back the first two hundred by process id — which is to say, whatever
     * booted earliest — and then sort those, so the busiest process on the
     * machine would simply not appear.
     */
    #[test]
    fn keeps_the_heaviest_rather_than_the_earliest() {
        let mut many: Vec<Proc> = (0..500)
            .map(|i| proc(i, "filler", 0.0, 0, ""))
            .collect();
        many.push(proc(9999, "the-busy-one", 90.0, 0, ""));

        let out = arrange(many, ProcSort::Cpu, "", 10);
        assert_eq!(out.len(), 10);
        assert_eq!(out[0].name, "the-busy-one");
    }

    #[test]
    fn survives_having_nothing_to_arrange() {
        assert!(arrange(Vec::new(), ProcSort::Cpu, "", 10).is_empty());
    }

    // ---- the real machine ----

    /*
     * Touches the real computer, so it asserts what is *possible* rather than
     * what is true — which is what catches a unit mix-up or a platform where
     * a reading silently comes back as nothing.
     */
    #[test]
    fn describes_a_real_machine() {
        let mut sampler = Sampler::new();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let m = sampler.machine();

        assert!(m.cores > 0, "a machine with no cores is running this");
        assert_eq!(m.per_core.len(), m.cores);
        for usage in &m.per_core {
            assert!((0.0..=100.0).contains(usage), "core at {usage}");
        }
        assert!(m.mem_total > 0);
        assert!(m.mem_used <= m.mem_total);
        assert!(m.swap_used <= m.swap_total);
        assert!(m.uptime_s > 0);
        assert!(!m.cpu_brand.is_empty());
    }

    #[test]
    fn lists_the_processes_this_machine_is_running() {
        let mut sampler = Sampler::new();
        let procs = sampler.processes();

        assert!(!procs.is_empty(), "no processes at all, on a machine running this test");
        // This one, at least, exists.
        let me = std::process::id();
        assert!(procs.iter().any(|p| p.pid == me), "the test process is not in its own list");
    }

    // A process that is not there cannot be signalled, and saying it was
    // would be a lie the caller repeats to the user.
    #[test]
    fn refuses_to_claim_it_ended_something_that_was_not_there() {
        let mut sampler = Sampler::new();
        assert!(!sampler.end(u32::MAX));
    }

    // ---- names ----

    #[test]
    fn accepts_the_shapes_a_hostname_comes_in() {
        for host in ["example.com", "localhost", "a-b.example.co.uk", "127.0.0.1", "my_host"] {
            assert!(valid_host(host), "refused {host}");
        }
    }

    /*
     * The only string from the window that reaches the system resolver.
     *
     * A hostname is letters, digits, dots and dashes. Everything refused here
     * is something else wearing the shape of one.
     */
    #[test]
    fn refuses_what_is_not_a_hostname() {
        for junk in ["", "   ", ".leading.dot", "-leading.dash", "has space.com",
                     "semi;colon", "slash/es", &"a".repeat(300)] {
            assert!(!valid_host(junk), "accepted {junk:?}");
        }
    }

    // localhost resolves on every machine that can run this at all.
    #[test]
    fn looks_up_a_name_the_machine_definitely_knows() {
        let found = resolve("localhost").expect("localhost resolves");
        assert_eq!(found.host, "localhost");
        assert!(
            found.addresses.iter().any(|a| a == "127.0.0.1" || a == "::1"),
            "got {:?}",
            found.addresses
        );
    }

    #[test]
    fn refuses_to_look_up_something_that_is_not_a_name() {
        assert!(resolve("not a hostname").is_err());
    }

    // ---- the environment ----

    /*
     * Guessed from the name, never from the value.
     *
     * A value cannot be examined for secrecy without reading it, and not
     * putting it on screen is the entire point.
     */
    #[test]
    fn spots_the_names_that_usually_hold_something_private() {
        for name in ["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "db_password", "MY_API_KEY", "KEY"] {
            assert!(looks_secret(name), "{name} was treated as ordinary");
        }
    }

    /*
     * `KEY` on its own catches far too much.
     *
     * KEYBOARD, KEYMAP and every XKB variable would be hidden behind a click
     * for no reason, which teaches people to click through the warning.
     */
    #[test]
    fn does_not_hide_everything_with_key_in_the_name() {
        for name in ["PATH", "HOME", "XKB_DEFAULT_LAYOUT", "KEYBOARD", "MONKEY", "KEYMAP"] {
            assert!(!looks_secret(name), "{name} was hidden for no reason");
        }
    }

    #[test]
    fn reads_this_process_s_environment_in_order() {
        let vars = environment();
        assert!(!vars.is_empty());

        let names: Vec<&str> = vars.iter().map(|v| v.name.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted, "the list is not in order");
    }

    use std::path::PathBuf;
    use std::time::Duration;

    fn mount(at: &str, total: u64, available: u64) -> Mount {
        Mount { at: PathBuf::from(at), total, available }
    }

    // A rate is bytes divided by the time they took, and the time they took is
    // whatever the poll interval happened to be — not the interval the UI
    // asked for. A window that was asleep, or a busy machine, makes those two
    // different, and dividing by the wrong one reports traffic that never
    // happened.
    #[test]
    fn turns_bytes_and_an_interval_into_a_rate() {
        assert_eq!(rate(1_048_576, Duration::from_secs(2)), 524_288);
        assert_eq!(rate(1000, Duration::from_millis(500)), 2000);
    }

    // Two samples in the same instant. Dividing by that is a crash or an
    // infinity, and neither belongs on a status bar.
    #[test]
    fn reports_nothing_rather_than_dividing_by_no_time_at_all() {
        assert_eq!(rate(5000, Duration::ZERO), 0);
    }

    #[test]
    fn reports_no_traffic_as_no_traffic() {
        assert_eq!(rate(0, Duration::from_secs(1)), 0);
    }

    // The disk worth showing is the one the user's files are on. On a machine
    // with /, /home and /boot mounted separately, / is a match for every path
    // and the wrong answer for nearly all of them.
    #[test]
    fn picks_the_disk_the_path_is_actually_on() {
        let mounts = [
            mount("/", 100, 50),
            mount("/home", 900, 300),
            mount("/boot", 10, 1),
        ];
        let picked = disk_for(&mounts, Path::new("/home/someone/notes")).expect("a disk");
        assert_eq!(picked.total, 900);
    }

    #[test]
    fn falls_back_to_the_root_when_nothing_else_matches() {
        let mounts = [mount("/", 100, 50), mount("/boot", 10, 1)];
        let picked = disk_for(&mounts, Path::new("/home/someone")).expect("a disk");
        assert_eq!(picked.total, 100);
    }

    // A machine with no disk sysinfo will admit to is rare and not impossible
    // — a container, a sandbox. Saying nothing beats showing 0 of 0.
    #[test]
    fn admits_when_there_is_no_disk_to_report() {
        assert!(disk_for(&[], Path::new("/home/someone")).is_none());
    }

    // A disk reporting more free than it has is nonsense the UI would render
    // as a negative bar.
    #[test]
    fn never_reports_more_used_than_the_disk_holds() {
        let mounts = [mount("/", 100, 400)];
        let picked = disk_for(&mounts, Path::new("/")).expect("a disk");
        assert_eq!(picked.used(), 0);
    }

    #[test]
    fn reports_what_a_disk_has_used() {
        let mounts = [mount("/", 1000, 250)];
        assert_eq!(disk_for(&mounts, Path::new("/")).unwrap().used(), 750);
    }

    // Loopback carries this app's own OAuth redirect and every local service
    // on the machine. Counting it would report traffic that never touched the
    // network.
    #[test]
    fn does_not_count_traffic_that_never_left_the_machine() {
        for name in ["lo", "lo0", "Loopback Pseudo-Interface 1"] {
            assert!(is_loopback(name), "{name} counted as a real interface");
        }
        for name in ["eth0", "wlan0", "en0", "Wi-Fi", "wlp3s0"] {
            assert!(!is_loopback(name), "{name} treated as loopback");
        }
    }

    #[test]
    fn a_percentage_is_a_percentage() {
        assert_eq!(percent(50, 200), 25.0);
        assert_eq!(percent(0, 0), 0.0, "nothing of nothing is not a crash");
        assert_eq!(percent(300, 200), 100.0, "and never over the top");
    }

    /*
     * The one test that touches the real machine.
     *
     * It cannot assert a number, because the numbers are whatever this
     * computer is doing. It can assert they are *possible* — which is what
     * catches a unit mix-up, an uninitialised field, or a platform where the
     * reading silently comes back as nothing at all.
     */
    #[test]
    fn a_real_sample_describes_a_real_machine() {
        let mut sampler = Sampler::new();
        let first = sampler.sample();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let status = sampler.sample();

        assert!((0.0..=100.0).contains(&status.cpu_pct), "cpu {}", status.cpu_pct);
        assert!(status.mem_total > 0, "a machine with no memory is running this");
        assert!(status.mem_used <= status.mem_total);
        assert!(status.disk_used <= status.disk_total);
        // Anything running this has been up for at least a moment.
        assert!(status.uptime_s > 0, "a machine that has been up no time is running this");
        // Not asserted to be non-zero: a quiet machine is a real machine.
        let _ = first;
    }
}

// ---------------------------------------------------------------------------
// What this machine is
// ---------------------------------------------------------------------------

/// The machine, as a page rather than a rail readout.
///
/// Everything here is a fact about the computer, gathered in one call: the
/// panel draws all of it at once, and six separate commands would fill it in
/// six jerks.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Machine {
    /// Absent where the OS will not say. Reported as unknown rather than
    /// guessed at — a wrong hostname is worse than none.
    pub host: Option<String>,
    pub os: Option<String>,
    pub kernel: Option<String>,
    pub cpu_brand: String,
    /// Logical cores, which is what the load is spread across.
    pub cores: usize,
    /// Per core, 0–100, in the order the OS lists them.
    pub per_core: Vec<f32>,
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    /// One, five and fifteen minutes. Zero on Windows, which has no such idea.
    pub load: [f64; 3],
    pub uptime_s: u64,
    pub disks: Vec<Volume>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Volume {
    pub mount: String,
    pub kind: String,
    pub total: u64,
    pub available: u64,
}

impl Sampler {
    /// Everything about the machine, in one reading.
    pub fn machine(&mut self) -> Machine {
        self.system.refresh_memory();
        self.system.refresh_cpu_usage();
        self.disks.refresh(true);

        let load = System::load_average();

        Machine {
            host: System::host_name(),
            os: System::long_os_version().or_else(System::name),
            kernel: System::kernel_version(),
            cpu_brand: self
                .system
                .cpus()
                .first()
                .map(|c| c.brand().trim().to_string())
                .filter(|b| !b.is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            cores: self.system.cpus().len(),
            per_core: self
                .system
                .cpus()
                .iter()
                .map(|c| c.cpu_usage().clamp(0.0, 100.0))
                .collect(),
            mem_used: self.system.used_memory(),
            mem_total: self.system.total_memory(),
            swap_used: self.system.used_swap(),
            swap_total: self.system.total_swap(),
            load: [load.one, load.five, load.fifteen],
            uptime_s: System::uptime(),
            disks: self
                .disks
                .list()
                .iter()
                .map(|d| Volume {
                    mount: d.mount_point().display().to_string(),
                    kind: format!("{:?}", d.file_system()),
                    total: d.total_space(),
                    available: d.available_space(),
                })
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// What it is running
// ---------------------------------------------------------------------------

/// One process, as much of one as a list needs.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    /// Across all cores, so a busy process on an 8-core machine can read 400.
    pub cpu_pct: f32,
    pub mem: u64,
    /// Seconds since the epoch. Absent where the OS will not say.
    pub started: u64,
    /// The full command, for telling four `node` processes apart.
    pub command: String,
}

/// The most processes a list will carry.
///
/// A busy machine has thousands, and a list that long is not read — it is
/// scrolled past. The panel sorts before truncating, so what arrives is the
/// heaviest rather than the first thousand by process id.
pub const MAX_PROCS: usize = 250;

/// How processes are ordered before the list is cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcSort {
    Cpu,
    Memory,
    Name,
}

/// Sort, filter and truncate — the part that has nothing to do with hardware.
///
/// Separated from the reading so it can be tested against a list made up
/// here, rather than against whatever this computer happens to be running.
pub fn arrange(mut procs: Vec<Proc>, sort: ProcSort, needle: &str, limit: usize) -> Vec<Proc> {
    let needle = needle.trim().to_lowercase();
    if !needle.is_empty() {
        // Matched against the command as well as the name, because four
        // processes called `node` are told apart only by what they are running.
        procs.retain(|p| {
            p.name.to_lowercase().contains(&needle)
                || p.command.to_lowercase().contains(&needle)
                || p.pid.to_string() == needle
        });
    }

    match sort {
        ProcSort::Cpu => procs.sort_by(|a, b| {
            b.cpu_pct
                .partial_cmp(&a.cpu_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        // Reversed by key rather than by comparator, which clippy is right
        // to prefer: the comparator form makes the direction a detail you have
        // to read the argument order to see.
        ProcSort::Memory => procs.sort_by_key(|p| std::cmp::Reverse(p.mem)),
        ProcSort::Name => procs.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.pid.cmp(&b.pid))
        }),
    }

    procs.truncate(limit);
    procs
}

impl Sampler {
    /// Every process this user can see.
    ///
    /// Read raw and arranged separately, so the sorting is testable without a
    /// machine and the reading is the only part that needs one.
    pub fn processes(&mut self) -> Vec<Proc> {
        self.system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        self.system
            .processes()
            .iter()
            .map(|(pid, p)| Proc {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().to_string(),
                cpu_pct: p.cpu_usage().max(0.0),
                mem: p.memory(),
                started: p.start_time(),
                command: p
                    .cmd()
                    .iter()
                    .map(|part| part.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" "),
            })
            .collect()
    }

    /// Ask a process to stop.
    ///
    /// Returns whether the signal was delivered, which is not the same as the
    /// process having gone — one that ignores a term signal is still there
    /// afterwards, and saying otherwise would be a lie the caller repeats.
    pub fn end(&mut self, pid: u32) -> bool {
        self.system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.system
            .process(sysinfo::Pid::from_u32(pid))
            .map(|p| p.kill())
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Names and ports
// ---------------------------------------------------------------------------

/// What the system resolver said about a name.
///
/// Addresses only, and deliberately so. This asks the operating system the
/// same question anything else on the machine asks it — which is the honest
/// answer to "where does this name point from here", and takes no DNS library
/// to do. It is not `dig`: there are no MX, TXT or NS records, because
/// getting those means speaking DNS directly and choosing which server to
/// believe, and a tool that showed some record types and quietly omitted the
/// rest would be worse than one that says which question it asked.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Lookup {
    pub host: String,
    pub addresses: Vec<String>,
    /// How long the resolver took. Often the interesting part.
    pub took_ms: u64,
}

/// A hostname, checked before it is handed to the resolver.
///
/// Letters, digits, dots and dashes. Anything else is not a hostname, and
/// this is the only string from the window that becomes an argument to the
/// system resolver.
pub fn valid_host(host: &str) -> bool {
    let host = host.trim();
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('.')
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// Ask the system resolver where a name points.
pub fn resolve(host: &str) -> Result<Lookup, String> {
    use std::net::ToSocketAddrs;

    let host = host.trim();
    if !valid_host(host) {
        return Err("that is not a hostname".to_string());
    }

    let started = Instant::now();
    // A port is required by the resolver's interface and is not part of the
    // question; 0 is the one that means "none of them".
    let found = (host, 0u16)
        .to_socket_addrs()
        .map_err(|e| format!("could not look that up: {e}"))?;

    let mut addresses: Vec<String> = found.map(|a| a.ip().to_string()).collect();
    addresses.sort();
    addresses.dedup();

    if addresses.is_empty() {
        return Err("that name resolved to nothing".to_string());
    }

    Ok(Lookup {
        host: host.to_string(),
        addresses,
        took_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

/// One variable, as this app has it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
    /// Whether the value is hidden by default. See `looks_secret`.
    pub secret: bool,
}

/// Whether a variable's name suggests it holds something private.
///
/// Names, not values: a value cannot be inspected for secrecy without reading
/// it, and the whole point is to avoid putting it on screen. This is a guess
/// and is treated as one — the value is hidden behind a click rather than
/// withheld, because it is the user's own environment and they may need it.
pub fn looks_secret(name: &str) -> bool {
    let n = name.to_ascii_uppercase();
    ["SECRET", "TOKEN", "PASSWORD", "PASSWD", "APIKEY", "API_KEY", "CREDENTIAL", "PRIVATE"]
        .iter()
        .any(|word| n.contains(word))
        // `KEY` on its own catches too much — KEYBOARD, KEYMAP, XKB_* — so it
        // only counts at the end of a name, where it means what it says.
        || n.ends_with("_KEY")
        || n == "KEY"
}

/// The environment a new terminal in this app would start with.
///
/// This process's environment, which is what a spawned shell inherits. Not
/// the environment of a shell that is already running: nothing outside a
/// process can change that, and a panel that offered to would be lying about
/// what it did.
pub fn environment() -> Vec<EnvVar> {
    let mut vars: Vec<EnvVar> = std::env::vars()
        .map(|(name, value)| EnvVar {
            secret: looks_secret(&name),
            name,
            value,
        })
        .collect();
    vars.sort_by(|a, b| a.name.cmp(&b.name));
    vars
}
