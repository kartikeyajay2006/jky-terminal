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
        // Not asserted to be non-zero: a quiet machine is a real machine.
        let _ = first;
    }
}
