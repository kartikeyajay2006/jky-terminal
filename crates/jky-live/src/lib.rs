//! Running one of a few known commands again, so a panel can stay current.
//!
//! A panel is a photograph: `df -h` parsed once and never again. Keeping one
//! live means running the command again, and that is the whole difficulty —
//! an IPC command that ran what it was told would be arbitrary execution
//! wearing a refresh button, which is the one thing this app's boundary
//! exists to prevent.
//!
//! So the window does not send a command. It sends the **id** of one of the
//! three below, and the argument list is a constant in this file. The same
//! arrangement `jky-remote` uses for hosts, and for the same reason: there is
//! no path from a string in the renderer to a process.
//!
//! Three, not thirty. Each one takes no argument and no working directory,
//! which is what makes it safe to repeat unattended — a command whose meaning
//! depends on where you are would quietly start answering about somewhere
//! else the moment you changed directory.

use std::process::Command;

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum LiveError {
    #[error("`{0}` is not something this app knows how to keep live")]
    Unknown(String),
    #[error("could not run {program}: {reason}")]
    Spawn { program: String, reason: String },
}

/// A command that can be run again on a timer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Source {
    /// What the window names. Never a command line.
    pub id: &'static str,
    pub program: &'static str,
    pub args: &'static [&'static str],
    /// How it is written when typed, for the panel to show.
    pub shown: &'static str,
}

/// Everything that may be repeated.
///
/// Every one reports the state of the machine, takes no argument, and reads
/// nothing belonging to anyone in particular. None of them writes.
pub const SOURCES: &[Source] = &[
    Source { id: "df", program: "df", args: &["-h"], shown: "df -h" },
    Source { id: "ps", program: "ps", args: &["aux"], shown: "ps aux" },
    Source { id: "docker-ps", program: "docker", args: &["ps"], shown: "docker ps" },
];

pub fn source(id: &str) -> Option<&'static Source> {
    SOURCES.iter().find(|s| s.id == id)
}

/// What a run produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Run {
    pub text: String,
    /// Zero means it worked. A panel that refreshed into an error should say
    /// so rather than showing the last good answer for ever.
    pub code: i32,
}

/// How much output is worth carrying back.
///
/// The same bound the recognisers already refuse past, so nothing is sent
/// that could not be parsed anyway.
pub const MAX_OUTPUT: usize = 512 * 1024;

/// Run one known source.
///
/// No shell. The program and its arguments are constants, handed to the OS as
/// a list, so there is nothing for a quote or a semicolon to mean.
pub fn run(source: &Source) -> Result<Run, LiveError> {
    let out = Command::new(source.program).args(source.args).output().map_err(|e| {
        LiveError::Spawn { program: source.program.to_string(), reason: e.to_string() }
    })?;

    // stderr when the command failed: `docker ps` with no daemon says why
    // there, and a panel that showed nothing would be a panel that looked
    // broken instead of one that explained itself.
    let raw = if out.status.success() { &out.stdout } else { &out.stderr };
    let mut text = String::from_utf8_lossy(raw).to_string();
    if text.len() > MAX_OUTPUT {
        text.truncate(MAX_OUTPUT);
    }

    Ok(Run { text, code: out.status.code().unwrap_or(-1) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_source_has_a_distinct_id() {
        let mut seen = std::collections::BTreeSet::new();
        for s in SOURCES {
            assert!(seen.insert(s.id), "{} twice", s.id);
            assert_eq!(source(s.id), Some(s));
        }
    }

    #[test]
    fn nothing_outside_the_list_is_reachable() {
        // The whole boundary: the window names an id, never a command.
        for made_up in ["rm", "df -h", "sh", "", "../df"] {
            assert!(source(made_up).is_none(), "{made_up}");
        }
    }

    #[test]
    fn no_source_takes_an_argument_from_anywhere() {
        // What makes them safe to repeat unattended: a command whose meaning
        // depends on where you are would quietly start answering about
        // somewhere else the moment you changed directory.
        for s in SOURCES {
            for arg in s.args {
                assert!(arg.starts_with('-') || arg.chars().all(char::is_alphanumeric), "{arg}");
                assert!(!arg.contains('/'), "{} takes a path", s.id);
            }
        }
    }

    #[test]
    fn what_is_shown_is_what_is_run() {
        // The panel says which command produced it, and it has to be true —
        // a panel refreshing with something other than what it claims is a
        // panel that lies.
        for s in SOURCES {
            let spelled = format!("{} {}", s.program, s.args.join(" "));
            assert_eq!(s.shown, spelled.trim());
        }
    }

    #[test]
    fn running_one_gives_back_its_output() {
        // `df` exists on every machine this runs on, including the runners.
        let found = run(source("df").expect("df is a source")).expect("df runs");
        assert_eq!(found.code, 0);
        assert!(found.text.contains('/'), "{}", found.text);
    }

    #[test]
    fn a_program_that_is_not_installed_says_so_rather_than_hanging() {
        let missing = Source {
            id: "nope",
            program: "definitely-not-a-real-program",
            args: &[],
            shown: "nope",
        };
        assert!(matches!(run(&missing), Err(LiveError::Spawn { .. })));
    }
}
