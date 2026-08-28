//! The one-time code that proves an address is really reachable.
//!
//! Deliberately small: generating a code and checking one against what was
//! last sent has no network in it and is fully tested here. Actually
//! emailing the code is `send::send_otp`; holding it between the two IPC
//! calls is the caller's job, because that state belongs to one running app,
//! not to this crate.

/// A code that was sent, waiting to be matched.
///
/// Held in memory only — by the caller, never by this crate — and never
/// written to disk. It is a proof of a few minutes' possession of an inbox,
/// not a secret worth persisting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtpState {
    pub address: String,
    pub code: String,
    /// Seconds since the epoch.
    pub expires_at: i64,
}

/// How long a sent code stays valid.
pub const OTP_TTL_SECS: i64 = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtpOutcome {
    Verified,
    /// The address, or code, or both, do not match what was sent. A typo is
    /// a normal outcome here, not a failure.
    Mismatch,
    Expired,
    /// Nothing was sent to check against — verify was called first.
    NoneSent,
}

/// A six-digit numeric code.
///
/// Not cryptographic key material — it is a short-lived possession proof
/// mailed to an address the user already controls — but it still comes from
/// the operating system's random source rather than anything guessable from
/// the process's own state.
pub fn generate_code() -> String {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).expect("the operating system's random source is available");
    let n = u32::from_le_bytes(buf) % 1_000_000;
    format!("{n:06}")
}

/// Check a typed code against what was last sent.
///
/// Takes `now` rather than reading the clock, so expiry is testable without
/// waiting ten minutes.
pub fn check(otp: Option<&OtpState>, address: &str, code: &str, now: i64) -> OtpOutcome {
    let Some(otp) = otp else {
        return OtpOutcome::NoneSent;
    };
    if now > otp.expires_at {
        return OtpOutcome::Expired;
    }
    if otp.address != address.trim() || otp.code != code.trim() {
        return OtpOutcome::Mismatch;
    }
    OtpOutcome::Verified
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_generated_code_is_six_digits() {
        let code = generate_code();
        assert_eq!(code.len(), 6, "{code}");
        assert!(code.chars().all(|c| c.is_ascii_digit()), "{code}");
    }

    #[test]
    fn generated_codes_are_not_all_the_same() {
        // Not a rigorous randomness test — a guard against a constant that
        // would make every user's code "000000".
        let codes: std::collections::HashSet<_> = (0..20).map(|_| generate_code()).collect();
        assert!(codes.len() > 1, "20 codes and every one identical");
    }

    fn otp() -> OtpState {
        OtpState {
            address: "someone@gmail.com".into(),
            code: "123456".into(),
            expires_at: 1000,
        }
    }

    #[test]
    fn no_code_was_ever_sent() {
        assert_eq!(check(None, "someone@gmail.com", "123456", 500), OtpOutcome::NoneSent);
    }

    #[test]
    fn the_right_code_at_the_right_address_verifies() {
        assert_eq!(
            check(Some(&otp()), "someone@gmail.com", "123456", 500),
            OtpOutcome::Verified
        );
    }

    #[test]
    fn a_wrong_code_is_a_mismatch_not_an_error() {
        // A mistyped code is normal, not a crash — the UI must be able to
        // say "try again" rather than treat this as a broken configuration.
        assert_eq!(
            check(Some(&otp()), "someone@gmail.com", "000000", 500),
            OtpOutcome::Mismatch
        );
    }

    #[test]
    fn a_code_sent_to_a_different_address_does_not_verify_this_one() {
        // Guards against a code sent before an address edit being accepted
        // for whatever the address field holds now.
        assert_eq!(
            check(Some(&otp()), "other@gmail.com", "123456", 500),
            OtpOutcome::Mismatch
        );
    }

    #[test]
    fn an_expired_code_is_reported_as_expired_not_a_mismatch() {
        // The user needs to know to ask for a new one, not to keep retyping
        // the one they were sent.
        assert_eq!(
            check(Some(&otp()), "someone@gmail.com", "123456", 1001),
            OtpOutcome::Expired
        );
    }

    #[test]
    fn a_code_at_the_exact_expiry_instant_still_works() {
        assert_eq!(
            check(Some(&otp()), "someone@gmail.com", "123456", 1000),
            OtpOutcome::Verified
        );
    }

    #[test]
    fn comparison_trims_whitespace_from_what_was_typed() {
        assert_eq!(
            check(Some(&otp()), "someone@gmail.com", " 123456\n", 500),
            OtpOutcome::Verified
        );
    }

    #[test]
    fn the_ttl_is_ten_minutes() {
        assert_eq!(OTP_TTL_SECS, 600);
    }
}
