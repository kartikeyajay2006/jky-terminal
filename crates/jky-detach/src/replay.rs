//! What happened while nobody was watching.
//!
//! A shell that outlives its window keeps printing, and a window that comes
//! back to it has missed however much. Reattaching to a blank screen would
//! make the feature almost pointless — the reason to leave a build running is
//! to come back and see how it went.
//!
//! So the supervisor keeps the tail of the output and hands it over on
//! reattach. The tail rather than all of it: a `cargo build` of a large
//! workspace prints megabytes, an overnight log prints gigabytes, and a
//! supervisor that remembered everything would be a memory leak with a
//! justification.
//!
//! Kept apart from the socket so the awkward parts — a single write larger
//! than the whole buffer, a boundary landing mid-character — are testable
//! without two processes.

/// How much of the missed output is kept.
///
/// A screen is a few kilobytes. This is enough to hold the end of a long
/// build and the error that stopped it, and small enough that a hundred
/// detached sessions are still megabytes rather than gigabytes.
pub const REPLAY_BYTES: usize = 256 * 1024;

/// A bounded tail of everything written.
#[derive(Debug)]
pub struct Replay {
    kept: Vec<u8>,
    limit: usize,
    /// Whether anything has been dropped, so the window can say so.
    lost: bool,
}

impl Default for Replay {
    fn default() -> Self {
        Self::new(REPLAY_BYTES)
    }
}

impl Replay {
    pub fn new(limit: usize) -> Self {
        Self { kept: Vec::new(), limit: limit.max(1), lost: false }
    }

    /// Add what the shell just printed.
    pub fn push(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }

        // A single write at least as large as the whole buffer: keep its
        // tail and nothing else, rather than growing to fit it and trimming
        // after.
        if bytes.len() >= self.limit {
            // Something is only lost if this write was itself too big, or if
            // it displaced something already held. A write of exactly the
            // limit into an empty buffer fits perfectly, and calling that
            // truncated would have the window apologise for nothing.
            self.lost = self.lost || bytes.len() > self.limit || !self.kept.is_empty();
            self.kept.clear();
            self.kept.extend_from_slice(&bytes[bytes.len() - self.limit..]);
            return;
        }

        self.kept.extend_from_slice(bytes);
        if self.kept.len() > self.limit {
            let over = self.kept.len() - self.limit;
            self.kept.drain(..over);
            self.lost = true;
        }
    }

    /// What is held, untrimmed. For tests: `take` also trims to a line
    /// boundary, which hides whether the buffer itself is right.
    #[cfg(test)]
    fn kept_for_test(&self) -> &[u8] {
        &self.kept
    }

    /// Whether anything was dropped to stay within the limit.
    pub fn truncated(&self) -> bool {
        self.lost
    }

    pub fn is_empty(&self) -> bool {
        self.kept.is_empty()
    }

    /// What to send a window that has just reattached.
    ///
    /// Trimmed forward to the first whole character when the buffer has
    /// overflowed. A tail cut at an arbitrary byte can begin in the middle of
    /// a multi-byte character or, worse, in the middle of an escape sequence —
    /// and a terminal handed half an escape sequence draws whatever the rest
    /// of it happens to say.
    pub fn take(&self) -> Vec<u8> {
        if !self.lost {
            return self.kept.clone();
        }

        let start = self
            .kept
            .iter()
            .position(|b| *b == b'\n')
            .map(|at| at + 1)
            .unwrap_or(0);
        self.kept[start..].to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_back_what_it_was_given() {
        let mut replay = Replay::new(64);
        replay.push(b"hello ");
        replay.push(b"world");
        assert_eq!(replay.take(), b"hello world");
        assert!(!replay.truncated());
    }

    #[test]
    fn keeps_the_end_rather_than_the_beginning() {
        // The end is what you came back to see. An overnight build that
        // remembered its first kilobyte would remember the wrong kilobyte.
        let mut replay = Replay::new(8);
        replay.push(b"aaaaaaaaaa");
        replay.push(b"12345678");
        // The `a`s are gone entirely and the newest eight bytes remain.
        assert_eq!(replay.kept_for_test(), b"12345678");
    }

    #[test]
    fn a_single_write_bigger_than_the_buffer_keeps_its_tail() {
        // `cat` of a large file arrives as writes far larger than this.
        let mut replay = Replay::new(4);
        replay.push(b"0123456789");
        assert_eq!(replay.take(), b"6789");
        assert!(replay.truncated());
    }

    #[test]
    fn says_when_it_has_dropped_something() {
        let mut replay = Replay::new(4);
        assert!(!replay.truncated());
        replay.push(b"abcd");
        assert!(!replay.truncated(), "exactly full is not truncated");
        replay.push(b"e");
        assert!(replay.truncated());
    }

    #[test]
    fn a_trimmed_tail_starts_at_a_line_rather_than_mid_sequence() {
        // Cut at an arbitrary byte, a tail can begin inside an escape
        // sequence — and a terminal handed half a sequence draws whatever
        // the remainder happens to spell.
        let mut replay = Replay::new(16);
        replay.push(b"xxxxxxx\x1b[31mred\nplain text here");
        let out = replay.take();
        assert!(!out.contains(&0x1b), "an escape was cut in half: {out:?}");
        assert!(out.starts_with(b"plain"), "{out:?}");
    }

    #[test]
    fn an_untrimmed_tail_is_handed_over_whole() {
        // Nothing was lost, so nothing is trimmed — including a first line
        // that has no newline before it.
        let mut replay = Replay::new(64);
        replay.push(b"no newline at all");
        assert_eq!(replay.take(), b"no newline at all");
    }

    #[test]
    fn a_tail_with_no_line_break_at_all_is_kept_rather_than_dropped() {
        // Trimming forward to a newline that does not exist would throw the
        // whole buffer away, which is worse than a possible half sequence.
        let mut replay = Replay::new(4);
        replay.push(b"aaaaaaaa");
        assert_eq!(replay.take(), b"aaaa");
    }

    #[test]
    fn nothing_written_is_nothing_to_replay() {
        let replay = Replay::new(16);
        assert!(replay.is_empty());
        assert_eq!(replay.take(), b"");
    }

    #[test]
    fn an_empty_write_changes_nothing() {
        let mut replay = Replay::new(4);
        replay.push(b"ab");
        replay.push(b"");
        assert_eq!(replay.take(), b"ab");
        assert!(!replay.truncated());
    }

    #[test]
    fn a_limit_of_nothing_is_treated_as_a_limit_of_something() {
        // Zero would make the tail arithmetic slice an empty range for ever,
        // so the floor is one byte — useless, but honest and not a panic.
        let mut replay = Replay::new(0);
        replay.push(b"abc");
        assert_eq!(replay.kept_for_test(), b"c");
        assert!(replay.truncated());
    }
}
