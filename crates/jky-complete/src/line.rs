//! Reading a command line the way a shell would.
//!
//! Everything downstream depends on one question: which word is the cursor
//! in, and is it the command or an argument? Getting that wrong means
//! offering flags where a path belongs, so it is answered here, once, with
//! quoting and escapes handled — not by splitting on spaces at each call
//! site.

use serde::Serialize;

/// What kind of thing belongs where the cursor is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Slot {
    /// The first word: a program name.
    Command,
    /// A word beginning with `-`.
    Flag,
    /// Anything else.
    Argument,
}

/// A command line, split at the cursor.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// The program being run, when the cursor is past it.
    pub command: Option<String>,
    /// Complete words before the cursor, after the command.
    pub args: Vec<String>,
    /// The partial word the cursor sits in. Empty at a word boundary.
    pub word: String,
    /// Byte offset in the original line where `word` begins.
    ///
    /// The caller replaces from here rather than appending, which is what
    /// makes completing the middle of a typed word work at all.
    pub word_start: usize,
    /// Byte offset where this command began — after the last `|` or `&&`.
    ///
    /// A suggestion that is a whole command line replaces from here rather
    /// than from `word_start`, or `docker r` completed from history becomes
    /// `docker docker run …`.
    pub segment_start: usize,
    pub slot: Slot,
}

/// Characters that end one command and begin another.
///
/// A completion offered after `git status &&` must be a command, not another
/// git subcommand. Splitting on these is not a shell parser and is not meant
/// to be — it is the part of one that changes what the next word means.
const SEPARATORS: &[&str] = &["&&", "||", "|", ";"];

/// Cut a line down to the last command in it.
fn last_segment(line: &str) -> &str {
    let mut start = 0;
    let bytes = line.as_bytes();
    let mut quote: Option<u8> = None;
    let mut i = 0;

    while i < bytes.len() {
        let c = bytes[i];
        if c == b'\\' {
            i += 2;
            continue;
        }
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'\'' || c == b'"' => quote = Some(c),
            None => {
                for sep in SEPARATORS {
                    if line[i..].starts_with(sep) {
                        start = i + sep.len();
                        i += sep.len();
                        break;
                    }
                }
            }
        }
        i += 1;
    }

    &line[start.min(line.len())..]
}

/// Split a segment into words, respecting quotes and backslash escapes.
///
/// Returns each word with the byte offset it started at, so a completion can
/// replace exactly what was typed.
fn words(segment: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut start = 0;
    let mut open = false;
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (i, c) in segment.char_indices() {
        if escaped {
            current.push(c);
            escaped = false;
            continue;
        }
        if c == '\\' {
            if !open {
                open = true;
                start = i;
            }
            escaped = true;
            continue;
        }
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '\'' || c == '"' => {
                if !open {
                    open = true;
                    start = i;
                }
                quote = Some(c);
            }
            None if c.is_whitespace() => {
                if open {
                    out.push((start, std::mem::take(&mut current)));
                    open = false;
                }
            }
            None => {
                if !open {
                    open = true;
                    start = i;
                }
                current.push(c);
            }
        }
    }

    if open {
        out.push((start, current));
    } else {
        // A trailing space means the cursor is at a fresh, empty word.
        out.push((segment.len(), String::new()));
    }

    out
}

/// Read a line up to the cursor.
///
/// Only the text before the cursor matters. What comes after is not being
/// completed, and treating it as context would offer completions for a word
/// somebody already finished typing.
pub fn parse(line: &str, cursor: usize) -> Line {
    let cursor = cursor.min(line.len());
    let head = &line[..cursor];
    let segment = last_segment(head);
    let offset = head.len() - segment.len();

    let mut parts = words(segment);
    // `words` always returns at least the empty trailing word.
    let (word_start, word) = parts.pop().unwrap_or((0, String::new()));
    let complete: Vec<String> = parts.into_iter().map(|(_, w)| w).collect();

    let slot = if complete.is_empty() {
        Slot::Command
    } else if word.starts_with('-') {
        Slot::Flag
    } else {
        Slot::Argument
    };

    let (command, args) = match complete.split_first() {
        Some((first, rest)) => (Some(first.clone()), rest.to_vec()),
        None => (None, Vec::new()),
    };

    Line { command, args, word, word_start: offset + word_start, segment_start: offset, slot }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at_end(line: &str) -> Line {
        parse(line, line.len())
    }

    #[test]
    fn the_first_word_is_a_command() {
        let line = at_end("doc");
        assert_eq!(line.slot, Slot::Command);
        assert_eq!(line.word, "doc");
        assert_eq!(line.command, None);
        assert_eq!(line.word_start, 0);
    }

    #[test]
    fn a_word_after_the_command_is_an_argument() {
        let line = at_end("git che");
        assert_eq!(line.slot, Slot::Argument);
        assert_eq!(line.command.as_deref(), Some("git"));
        assert_eq!(line.word, "che");
        assert_eq!(line.word_start, 4);
    }

    #[test]
    fn a_word_beginning_with_a_dash_is_a_flag() {
        let line = at_end("ls --col");
        assert_eq!(line.slot, Slot::Flag);
        assert_eq!(line.word, "--col");
    }

    #[test]
    fn a_trailing_space_means_a_fresh_empty_word() {
        // Otherwise `git ` would keep completing `git`.
        let line = at_end("git ");
        assert_eq!(line.word, "");
        assert_eq!(line.slot, Slot::Argument);
        assert_eq!(line.word_start, 4);
    }

    #[test]
    fn earlier_arguments_are_kept_as_context() {
        // `git checkout <tab>` wants branches; `git remote <tab>` does not.
        let line = at_end("git checkout ma");
        assert_eq!(line.command.as_deref(), Some("git"));
        assert_eq!(line.args, ["checkout"]);
        assert_eq!(line.word, "ma");
    }

    #[test]
    fn only_what_is_before_the_cursor_is_read() {
        // Completing the middle of a word must not be confused by the rest:
        // the cursor is inside `checkout`, so that is the word being typed
        // and `main` is not context.
        let line = parse("git checkout main", 8);
        assert_eq!(line.command.as_deref(), Some("git"));
        assert_eq!(line.args, Vec::<String>::new());
        assert_eq!(line.word, "chec");
        assert_eq!(line.word_start, 4);
    }

    #[test]
    fn a_cursor_just_after_a_word_is_still_in_it() {
        // Tab pressed at the end of what you typed completes that word
        // rather than starting the next one.
        let line = parse("git checkout main", 12);
        assert_eq!(line.word, "checkout");
        assert_eq!(line.args, Vec::<String>::new());
    }

    #[test]
    fn a_pipe_starts_a_new_command() {
        // Otherwise `docker ps | gr` offers docker's arguments for `gr`.
        for line in ["docker ps | gr", "make && gr", "false || gr", "cd /tmp; gr"] {
            let parsed = at_end(line);
            assert_eq!(parsed.slot, Slot::Command, "{line}");
            assert_eq!(parsed.word, "gr", "{line}");
        }
    }

    #[test]
    fn the_offset_survives_a_pipe() {
        let line = at_end("docker ps | gr");
        assert_eq!(&"docker ps | gr"[line.word_start..], "gr");
    }

    #[test]
    fn the_segment_begins_after_the_last_separator() {
        // What a whole-line suggestion replaces from. Replacing from zero
        // would eat the command on the other side of the pipe.
        let text = "docker ps | grep ap";
        let line = at_end(text);
        assert_eq!(text[line.segment_start..].trim_start(), "grep ap");

        let plain = at_end("docker r");
        assert_eq!(plain.segment_start, 0);
    }

    #[test]
    fn a_separator_inside_quotes_is_not_a_separator() {
        let line = at_end("grep 'a|b' fi");
        assert_eq!(line.command.as_deref(), Some("grep"));
        assert_eq!(line.word, "fi");
    }

    #[test]
    fn quoted_words_keep_their_spaces() {
        let line = at_end("cat \"my file.txt\" mo");
        assert_eq!(line.args, ["my file.txt"]);
        assert_eq!(line.word, "mo");
    }

    #[test]
    fn an_escaped_space_does_not_end_a_word() {
        let line = at_end("cat my\\ fi");
        assert_eq!(line.word, "my fi");
        assert_eq!(&"cat my\\ fi"[line.word_start..], "my\\ fi");
    }

    #[test]
    fn a_partly_quoted_word_is_still_the_word_at_the_cursor() {
        let line = at_end("cat \"my fi");
        assert_eq!(line.word, "my fi");
        assert_eq!(line.slot, Slot::Argument);
    }

    #[test]
    fn an_empty_line_asks_for_a_command() {
        let line = at_end("");
        assert_eq!(line.slot, Slot::Command);
        assert_eq!(line.word, "");
        assert_eq!(line.command, None);
    }

    #[test]
    fn leading_space_does_not_make_the_command_an_argument() {
        let line = at_end("   doc");
        assert_eq!(line.slot, Slot::Command);
        assert_eq!(line.word, "doc");
    }

    #[test]
    fn a_cursor_past_the_end_is_clamped_rather_than_panicking() {
        let line = parse("ls", 99);
        assert_eq!(line.word, "ls");
    }
}
