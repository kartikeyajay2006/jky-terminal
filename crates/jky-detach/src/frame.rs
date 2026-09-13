//! What a window and a detached shell say to each other.
//!
//! A pty is a byte stream in both directions and almost nothing else, so this
//! is almost nothing else: a kind, a length, and the bytes. The only reason
//! it is framed at all is that two things are not bytes — a resize carries
//! two numbers, and a shell exiting carries a status — and interleaving those
//! with output on one stream needs a way to tell them apart.
//!
//! Deliberately not serde over the wire. The two ends of this socket are the
//! same binary at the same version for the life of a session, so there is no
//! schema to evolve, and a format that can allocate from a length it was
//! handed is a format that has to be careful. This one is careful in four
//! lines: a length above `MAX_PAYLOAD` is a corrupt stream and is refused
//! before anything is allocated.

use std::io::{self, Read, Write};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("the connection ended mid-frame")]
    Truncated,
    #[error("{0} is not a kind of message this speaks")]
    UnknownKind(u8),
    #[error("a frame claimed {0} bytes, which is more than any message can be")]
    TooLong(u32),
    #[error("a {kind} frame cannot be {len} bytes")]
    WrongSize { kind: &'static str, len: usize },
    #[error("{0}")]
    Io(String),
}

impl From<io::Error> for FrameError {
    fn from(e: io::Error) -> Self {
        // An end that closed is not an error worth a stack trace; it is the
        // ordinary way a session finishes.
        if e.kind() == io::ErrorKind::UnexpectedEof {
            FrameError::Truncated
        } else {
            FrameError::Io(e.to_string())
        }
    }
}

/// The largest a single message may be.
///
/// Output arrives in whatever chunks the pty produces, which are far smaller
/// than this; the cap exists so a corrupt or hostile length cannot ask for an
/// allocation the machine cannot make.
pub const MAX_PAYLOAD: u32 = 4 * 1024 * 1024;

const KIND_DATA: u8 = 0x00;
const KIND_RESIZE: u8 = 0x01;
const KIND_DETACH: u8 = 0x02;
const KIND_REPLAY: u8 = 0x10;
const KIND_ENDED: u8 = 0x11;

/// One message, in either direction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// Keystrokes going in, or output coming back.
    Data(Vec<u8>),
    /// The window resized. Only ever sent by the window.
    Resize { cols: u16, rows: u16 },
    /// The window is leaving and the shell should keep running.
    ///
    /// Distinct from the socket simply closing, which happens when a window
    /// crashes or the machine sleeps — those also leave the shell running, so
    /// the two are handled the same way. This exists to say it was meant.
    Detach,
    /// What happened while nobody was attached, sent once on reattaching.
    ///
    /// Separate from `Data` so the window can tell the catch-up from the live
    /// stream — it is drawn at once rather than typed out, and it is what
    /// makes reattaching show the build you left running rather than a blank
    /// screen with a prompt.
    Replay(Vec<u8>),
    /// The shell exited. Nothing follows this.
    Ended { code: i32 },
}

impl Frame {
    fn kind(&self) -> u8 {
        match self {
            Frame::Data(_) => KIND_DATA,
            Frame::Resize { .. } => KIND_RESIZE,
            Frame::Detach => KIND_DETACH,
            Frame::Replay(_) => KIND_REPLAY,
            Frame::Ended { .. } => KIND_ENDED,
        }
    }

    fn payload(&self) -> Vec<u8> {
        match self {
            Frame::Data(bytes) | Frame::Replay(bytes) => bytes.clone(),
            Frame::Resize { cols, rows } => {
                let mut out = Vec::with_capacity(4);
                out.extend_from_slice(&cols.to_be_bytes());
                out.extend_from_slice(&rows.to_be_bytes());
                out
            }
            Frame::Detach => Vec::new(),
            Frame::Ended { code } => code.to_be_bytes().to_vec(),
        }
    }

    /// Write this frame to a stream.
    pub fn write_to(&self, out: &mut impl Write) -> Result<(), FrameError> {
        let payload = self.payload();
        let len = u32::try_from(payload.len()).map_err(|_| FrameError::TooLong(u32::MAX))?;
        if len > MAX_PAYLOAD {
            return Err(FrameError::TooLong(len));
        }

        out.write_all(&[self.kind()])?;
        out.write_all(&len.to_be_bytes())?;
        out.write_all(&payload)?;
        // Flushed here rather than by the caller: a keystroke sitting in a
        // buffer is a keystroke that has not happened yet, and this stream
        // carries keystrokes.
        out.flush()?;
        Ok(())
    }

    /// Read one frame, blocking until it is whole.
    pub fn read_from(input: &mut impl Read) -> Result<Frame, FrameError> {
        let mut head = [0u8; 5];
        input.read_exact(&mut head)?;

        let kind = head[0];
        let len = u32::from_be_bytes([head[1], head[2], head[3], head[4]]);
        // Checked before allocating, which is the entire point of a cap.
        if len > MAX_PAYLOAD {
            return Err(FrameError::TooLong(len));
        }

        let mut payload = vec![0u8; len as usize];
        input.read_exact(&mut payload)?;

        match kind {
            KIND_DATA => Ok(Frame::Data(payload)),
            KIND_REPLAY => Ok(Frame::Replay(payload)),
            KIND_DETACH => Ok(Frame::Detach),
            KIND_RESIZE => {
                let size: [u8; 4] = payload
                    .as_slice()
                    .try_into()
                    .map_err(|_| FrameError::WrongSize { kind: "resize", len: payload.len() })?;
                Ok(Frame::Resize {
                    cols: u16::from_be_bytes([size[0], size[1]]),
                    rows: u16::from_be_bytes([size[2], size[3]]),
                })
            }
            KIND_ENDED => {
                let code: [u8; 4] = payload
                    .as_slice()
                    .try_into()
                    .map_err(|_| FrameError::WrongSize { kind: "ended", len: payload.len() })?;
                Ok(Frame::Ended { code: i32::from_be_bytes(code) })
            }
            other => Err(FrameError::UnknownKind(other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(frame: &Frame) -> Frame {
        let mut wire = Vec::new();
        frame.write_to(&mut wire).expect("write");
        Frame::read_from(&mut wire.as_slice()).expect("read")
    }

    #[test]
    fn every_kind_survives_the_wire() {
        for frame in [
            Frame::Data(b"ls -la\n".to_vec()),
            Frame::Resize { cols: 120, rows: 40 },
            Frame::Detach,
            Frame::Replay(b"previous output".to_vec()),
            Frame::Ended { code: 0 },
        ] {
            assert_eq!(round_trip(&frame), frame, "{frame:?}");
        }
    }

    #[test]
    fn a_shell_killed_by_a_signal_keeps_its_negative_status() {
        // Status is signed on purpose: a process killed by a signal reports a
        // negative code on Unix, and an unsigned field would turn that into a
        // very large success.
        assert_eq!(round_trip(&Frame::Ended { code: -9 }), Frame::Ended { code: -9 });
    }

    #[test]
    fn output_with_no_bytes_is_still_a_frame() {
        assert_eq!(round_trip(&Frame::Data(Vec::new())), Frame::Data(Vec::new()));
    }

    #[test]
    fn frames_do_not_run_into_one_another() {
        // The whole reason for a length: a reader must find the boundary
        // without looking at the bytes, which may be anything at all.
        let mut wire = Vec::new();
        Frame::Data(b"first".to_vec()).write_to(&mut wire).unwrap();
        Frame::Resize { cols: 80, rows: 24 }.write_to(&mut wire).unwrap();
        Frame::Data(b"second".to_vec()).write_to(&mut wire).unwrap();

        let mut read = wire.as_slice();
        assert_eq!(Frame::read_from(&mut read).unwrap(), Frame::Data(b"first".to_vec()));
        assert_eq!(Frame::read_from(&mut read).unwrap(), Frame::Resize { cols: 80, rows: 24 });
        assert_eq!(Frame::read_from(&mut read).unwrap(), Frame::Data(b"second".to_vec()));
    }

    #[test]
    fn payload_bytes_are_never_mistaken_for_a_header() {
        // Output containing the bytes a header is made of is ordinary output.
        let nasty = vec![0x00, 0x00, 0x00, 0x00, 0x10, 0x01, 0xff];
        assert_eq!(round_trip(&Frame::Data(nasty.clone())), Frame::Data(nasty));
    }

    // The cap is the whole defence: without it a corrupt length is an
    // allocation the machine is asked to make before anything is validated.
    #[test]
    fn a_length_larger_than_any_message_is_refused_before_allocating() {
        let mut wire = vec![KIND_DATA];
        wire.extend_from_slice(&u32::MAX.to_be_bytes());

        let err = Frame::read_from(&mut wire.as_slice()).expect_err("should refuse");
        assert!(matches!(err, FrameError::TooLong(_)), "{err:?}");
    }

    #[test]
    fn a_kind_from_a_future_version_is_named_rather_than_guessed_at() {
        let mut wire = vec![0x7f];
        wire.extend_from_slice(&0u32.to_be_bytes());
        assert!(matches!(
            Frame::read_from(&mut wire.as_slice()),
            Err(FrameError::UnknownKind(0x7f))
        ));
    }

    #[test]
    fn a_connection_that_ends_mid_frame_says_so() {
        // A supervisor killed mid-write, or a machine that slept. Ordinary,
        // and it must not look like a frame that happened to be short.
        let mut wire = Vec::new();
        Frame::Data(b"hello".to_vec()).write_to(&mut wire).unwrap();
        wire.truncate(wire.len() - 2);

        assert!(matches!(
            Frame::read_from(&mut wire.as_slice()),
            Err(FrameError::Truncated)
        ));
    }

    #[test]
    fn a_closed_connection_is_the_ordinary_end_rather_than_an_error() {
        assert!(matches!(
            Frame::read_from(&mut [].as_slice()),
            Err(FrameError::Truncated)
        ));
    }

    #[test]
    fn a_resize_that_is_not_two_numbers_is_refused() {
        let mut wire = vec![KIND_RESIZE];
        wire.extend_from_slice(&2u32.to_be_bytes());
        wire.extend_from_slice(&[0, 80]);

        assert!(matches!(
            Frame::read_from(&mut wire.as_slice()),
            Err(FrameError::WrongSize { kind: "resize", .. })
        ));
    }

    #[test]
    fn a_full_size_message_is_allowed_and_one_byte_more_is_not() {
        let biggest = Frame::Data(vec![7u8; MAX_PAYLOAD as usize]);
        let mut wire = Vec::new();
        biggest.write_to(&mut wire).expect("the cap is inclusive");

        let over = Frame::Data(vec![7u8; MAX_PAYLOAD as usize + 1]);
        assert!(matches!(over.write_to(&mut Vec::new()), Err(FrameError::TooLong(_))));
    }
}
