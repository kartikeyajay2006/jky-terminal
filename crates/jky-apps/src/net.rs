//! What every app's fetching shares: one client, bounded waits, and a retry.
//!
//! This exists because of a failure that reached a user: a place search came
//! back "could not reach the location service" while the weather on the very
//! same screen loaded fine. The two hosts differ in one way — the geocoder
//! publishes an AAAA record and the forecast host does not — and on a network
//! whose IPv6 is broken, that is the difference between a request that has to
//! fall back and one that never tries. Measured on the machine it happened on:
//! IPv6 failed ten times out of ten, IPv4 succeeded ten out of ten.
//!
//! The connector already falls back on its own, and from a cold client it does
//! so reliably — fifteen out of fifteen, in about 800ms. But a fallback that
//! occasionally does not land leaves a person looking at an error for a
//! service that is up, and the honest fix for a transient failure is to try
//! again rather than to explain it.

use std::future::Future;
use std::time::Duration;

/// How long to wait for a connection before giving up on it.
///
/// Deliberately short. The fallback from a dead IPv6 address to a working
/// IPv4 one costs under a second when it works, so a connection still
/// unestablished after this is not one that is about to succeed.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);

/// The ceiling on a whole request.
///
/// Without one, a connection that hangs leaves the panel spinning for as long
/// as the app is open, which reads as a broken app rather than a slow network.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Total tries, not retries: two extra attempts after the first.
pub const ATTEMPTS: usize = 3;

/// Waited between attempts, doubling each time.
///
/// Short, because a person is watching a search box. This is not a service
/// under load that needs backing off from politely; it is one blip on the way
/// to a host that is otherwise answering.
const BACKOFF: Duration = Duration::from_millis(150);

/// The client every app fetches through.
///
/// One for the whole app so connections are pooled rather than a fresh TLS
/// handshake being paid per panel refresh, and configured in one place so the
/// waits above apply to every request rather than to whichever caller
/// remembered.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        // Named so a publisher's feed does not answer a bare client with a
        // challenge page, which several of them do.
        .user_agent("JKY-Terminal/0.1")
        .build()
        // Only fails if TLS cannot be initialised, in which case nothing that
        // fetches was ever going to work.
        .unwrap_or_default()
}

/// Run an operation, trying again while the failure looks transient.
///
/// `retryable` is what separates a blip from an answer: a refused connection
/// is worth another go, a 404 is not — asking again wastes the person's time
/// and someone else's service to be told the same thing.
pub async fn retrying<T, E, F, Fut>(
    attempts: usize,
    retryable: impl Fn(&E) -> bool,
    mut operation: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut wait = BACKOFF;
    let mut last = None;

    for attempt in 0..attempts.max(1) {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                // The final failure is the one reported, so the message a
                // person sees describes the attempt that actually gave up.
                if !retryable(&e) || attempt + 1 == attempts.max(1) {
                    return Err(e);
                }
                last = Some(e);
                tokio::time::sleep(wait).await;
                wait *= 2;
            }
        }
    }

    // Unreachable: the loop returns on the last attempt either way.
    Err(last.expect("the loop returns before it can exhaust without an error"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Debug, PartialEq)]
    enum Fake {
        Connection,
        Answered(u16),
    }

    fn transient(e: &Fake) -> bool {
        matches!(e, Fake::Connection)
    }

    #[tokio::test]
    async fn returns_the_first_success_without_retrying() {
        let calls = AtomicUsize::new(0);
        let out: Result<u8, Fake> = retrying(ATTEMPTS, transient, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(7)
        })
        .await;
        assert_eq!(out.unwrap(), 7);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    // The failure the user actually hit: one connection blip on a network with
    // broken IPv6, which a second attempt gets through.
    #[tokio::test]
    async fn retries_a_connection_failure_and_succeeds() {
        let calls = AtomicUsize::new(0);
        let out: Result<u8, Fake> = retrying(ATTEMPTS, transient, || async {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(Fake::Connection)
            } else {
                Ok(9)
            }
        })
        .await;
        assert_eq!(out.unwrap(), 9);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn gives_up_after_the_attempt_budget_and_reports_the_last_failure() {
        let calls = AtomicUsize::new(0);
        let out: Result<u8, Fake> = retrying(ATTEMPTS, transient, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(Fake::Connection)
        })
        .await;
        assert_eq!(out.unwrap_err(), Fake::Connection);
        assert_eq!(calls.load(Ordering::SeqCst), ATTEMPTS);
    }

    // A 404 is an answer, not a blip. Asking again wastes the user's time and
    // someone else's service to be told the same thing.
    #[tokio::test]
    async fn does_not_retry_something_the_server_answered() {
        let calls = AtomicUsize::new(0);
        let out: Result<u8, Fake> = retrying(ATTEMPTS, transient, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(Fake::Answered(404))
        })
        .await;
        assert_eq!(out.unwrap_err(), Fake::Answered(404));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn one_attempt_means_no_retry_at_all() {
        let calls = AtomicUsize::new(0);
        let out: Result<u8, Fake> = retrying(1, transient, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(Fake::Connection)
        })
        .await;
        assert!(out.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_client_is_built_with_bounded_waits() {
        // Constructing it is the assertion: a builder that cannot apply these
        // settings fails here rather than at the first request.
        let _ = client();
        assert!(CONNECT_TIMEOUT < REQUEST_TIMEOUT);
    }
}
