//! The catalogue of shell commands JKY Terminal installs.
//!
//! Defined once, here. The shell renders it, the Settings screen lists it, and
//! the launcher scripts are generated from it — so a command cannot exist in
//! one place and be undocumented in another.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct CommandSpec {
    /// Every spelling that works. The first is the canonical one.
    pub names: &'static [&'static str],
    /// How to type it, arguments included.
    pub usage: &'static str,
    /// One line, shown in the list.
    pub summary: &'static str,
    /// The part that answers "but why would I".
    pub detail: &'static str,
}

const COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        names: &["jky-terminal", "jkyterminal", "jkyTerminal"],
        usage: "jky-terminal",
        summary: "Print the JKY Terminal banner",
        detail: "Reprints the wordmark shown when a terminal opens, in the theme \
                 that terminal started with. Three spellings work because people \
                 type what they remember.",
    },
    CommandSpec {
        names: &["jky ask", "jky asks"],
        usage: "jky ask <question>",
        summary: "Ask the assistant without leaving the terminal",
        detail: "Sends the question to the Assistant panel and brings it into \
                 view. Everything after the word ask is the question, so quotes \
                 are not needed.",
    },
    CommandSpec {
        names: &["jky commands", "jky command"],
        usage: "jky commands",
        summary: "List every JKY command",
        detail: "Prints this list. The same list appears under Settings, \
                 Commands.",
    },
    CommandSpec {
        names: &["jky games", "jky game"],
        usage: "jky games [1-4]",
        summary: "List the games and their records, or open one",
        detail: "With no argument it prints all four games with the best \
                 score each has been beaten with. Give it 1, 2, 3 or 4 and \
                 that game opens in the window: 1 Dino Run, 2 Snake, 3 Tic \
                 Tac Toe, 4 Flappy Bird.",
    },
    CommandSpec {
        names: &["jky notes", "jky note"],
        usage: "jky notes [number]",
        summary: "List your notes, or read one",
        detail: "With no argument it prints every saved note, numbered from \
                 one. Give it a number and it prints that note in full. The \
                 numbers follow the list, so deleting one renumbers the rest.",
    },
    CommandSpec {
        names: &["jky reminders", "jky reminder"],
        usage: "jky reminders [number]",
        summary: "List your reminders, or read one",
        detail: "The daily checklist in the order of the day, ticked or not, \
                 numbered from one. Give it a number to see one on its own.",
    },
    CommandSpec {
        names: &["jky todos", "jky todo"],
        usage: "jky todos [number]",
        summary: "List your todos, or read one",
        detail: "Everything on the list, numbered from one, done and not done. \
                 Nothing is removed for being finished.",
    },
    CommandSpec {
        names: &["jky note new", "jky note add"],
        usage: "jky note new <title>",
        summary: "Create a note without leaving the shell",
        detail: "Everything after new is the title, so quotes are not needed. \
                 It appears in the Notes panel at once — there is no second way \
                 to write a note, this goes through the same store the panel \
                 does.",
    },
    CommandSpec {
        names: &["jky note write", "jky note append"],
        usage: "jky note write <n> <text>",
        summary: "Add a line to a note",
        detail: "Appended, never replaced: a command that silently discarded a \
                 note's body the moment you added a line to it would be a trap. \
                 The number is the one jky notes prints beside it.",
    },
    CommandSpec {
        names: &["jky note rename"],
        usage: "jky note rename <n> <title>",
        summary: "Give a note a new title",
        detail: "The body is untouched. Numbers follow the listing, so run jky \
                 notes first if anything has been deleted since.",
    },
    CommandSpec {
        names: &["jky note rm", "jky note delete"],
        usage: "jky note rm <n>",
        summary: "Delete a note",
        detail: "Immediate and not recoverable, unlike the Dashboard, which \
                 asks first. A shell is a place where people expect rm to mean \
                 rm.",
    },
    CommandSpec {
        names: &["jky todo add", "jky todo new"],
        usage: "jky todo add <text>",
        summary: "Add something to the list",
        detail: "Everything after add is the text. It arrives not done, and \
                 shows up in the notification tray like any other open todo.",
    },
    CommandSpec {
        names: &["jky todo done", "jky todo tick"],
        usage: "jky todo done <n>",
        summary: "Tick a todo off",
        detail: "Nothing is removed for being finished — a ticked todo stays on \
                 the list. jky todo undone puts it back.",
    },
    CommandSpec {
        names: &["jky todo undone", "jky todo untick"],
        usage: "jky todo undone <n>",
        summary: "Put a todo back on the list",
        detail: "The other half of done, for when something turns out not to \
                 have been finished after all.",
    },
    CommandSpec {
        names: &["jky todo rm", "jky todo delete"],
        usage: "jky todo rm <n>",
        summary: "Delete a todo",
        detail: "Immediate. Ticking one off with done is what you want if you \
                 only meant to finish it.",
    },
    CommandSpec {
        names: &["jky reminder add", "jky reminder new"],
        usage: "jky reminder add <HH:MM> <text>",
        summary: "Set a daily reminder",
        detail: "The time is a wall clock, because a reminder is a daily \
                 checklist rather than a date: 07:00 means seven in the morning \
                 wherever you are. Everything after it is the text.",
    },
    CommandSpec {
        names: &["jky reminder done", "jky reminder tick"],
        usage: "jky reminder done <n>",
        summary: "Tick a reminder off for today",
        detail: "Numbers follow the listing, which is in order of the day \
                 rather than the order they were added.",
    },
    CommandSpec {
        names: &["jky reminder rm", "jky reminder delete"],
        usage: "jky reminder rm <n>",
        summary: "Delete a reminder",
        detail: "Immediate, and it stops appearing tomorrow too.",
    },
    CommandSpec {
        names: &["jky theme"],
        usage: "jky theme <name>",
        summary: "Change the theme from the shell",
        detail: "One of cyberpunk, dracula, nord, solarized, light, gold or \
                 contrast. Applied at once and remembered, exactly as choosing \
                 it in Settings would be.",
    },
    CommandSpec {
        names: &["jky open", "jky go"],
        usage: "jky open <section>",
        summary: "Jump to a section",
        detail: "One of dashboard, terminal, assistant, games or settings. A \
                 second word opens a panel inside it, so jky open dashboard \
                 calendar goes straight there.",
    },
    CommandSpec {
        names: &["jky banner"],
        usage: "jky banner",
        summary: "Print the banner",
        detail: "The same output as jky-terminal, reachable through the jky \
                 command for consistency.",
    },
];

pub fn commands() -> &'static [CommandSpec] {
    COMMANDS
}

/// Parse `#rrggbb`, so the rendered list can pick up the live theme accent
/// the same way the banner does. Anything unparseable yields None and the
/// list prints plain rather than in an invented colour.
pub fn parse_accent(value: &str) -> Option<(u8, u8, u8)> {
    let hex = value.trim().strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((
        u8::from_str_radix(&hex[0..2], 16).ok()?,
        u8::from_str_radix(&hex[2..4], 16).ok()?,
        u8::from_str_radix(&hex[4..6], 16).ok()?,
    ))
}

const ESC: char = '\u{1b}';

fn fg(rgb: (u8, u8, u8)) -> String {
    format!("{ESC}[38;2;{};{};{}m", rgb.0, rgb.1, rgb.2)
}

/// Break text into lines no wider than `width`.
///
/// Help text that overruns the pane wraps mid-word and turns a list into
/// noise, which is the opposite of what a help screen is for. A single word
/// longer than the width is emitted whole rather than split — a broken
/// identifier is worse than one long line.
fn wrap(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
        } else if current.chars().count() + 1 + word.chars().count() <= width {
            current.push(' ');
            current.push_str(word);
        } else {
            lines.push(std::mem::take(&mut current));
            current.push_str(word);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/// Render the catalogue for a terminal.
///
/// Colours are passed in rather than hard-coded so the output matches the
/// theme the terminal was opened with, the same way the banner does. When no
/// colour is supplied it prints plain, which is correct when the output is
/// being piped somewhere rather than read.
pub fn render_commands(accent: Option<(u8, u8, u8)>, width: usize) -> String {
    let reset = format!("{ESC}[0m");
    let dim = format!("{ESC}[2m");
    let bold = format!("{ESC}[1m");
    let tint = accent.map(fg).unwrap_or_default();
    let plain = accent.is_none();

    let mut out = String::new();
    let pad = "  ";

    out.push_str("\r\n");
    out.push_str(&format!(
        "{pad}{}{}JKY commands{}\r\n",
        if plain { "" } else { &bold },
        tint,
        if plain { "" } else { &reset }
    ));

    let rule_width = width.saturating_sub(pad.len() * 2).clamp(1, 76);
    out.push_str(&format!(
        "{pad}{}{}{}\r\n\r\n",
        if plain { "" } else { &dim },
        "─".repeat(rule_width),
        if plain { "" } else { &reset }
    ));

    // Below this, usage and summary on one line no longer fit and would wrap
    // mid-word. Stacking them is uglier than the wide layout and far more
    // readable than a wrapped one.
    let stacked = COMMANDS
        .iter()
        .any(|c| pad.len() + c.usage.len() + 3 + c.summary.len() > width);

    for spec in COMMANDS {
        if stacked {
            let indent = format!("{pad}  ");
            let body_width = width.saturating_sub(indent.len());

            // The usage itself can outrun a narrow pane once a command takes
            // two arguments. Continuations are indented so a usage split over
            // two lines still reads as one command rather than as two.
            for (n, line) in wrap(spec.usage, width.saturating_sub(pad.len() + 2))
                .into_iter()
                .enumerate()
            {
                out.push_str(&format!(
                    "{pad}{}{}{line}{}\r\n",
                    if n == 0 { "" } else { "  " },
                    tint,
                    if plain { "" } else { &reset }
                ));
            }
            for line in wrap(spec.summary, body_width) {
                out.push_str(&format!(
                    "{indent}{}{line}{}\r\n",
                    if plain { "" } else { &dim },
                    if plain { "" } else { &reset }
                ));
            }
        } else {
            out.push_str(&format!(
                "{pad}{}{}{}   {}{}{}\r\n",
                tint,
                spec.usage,
                if plain { "" } else { &reset },
                if plain { "" } else { &dim },
                spec.summary,
                if plain { "" } else { &reset }
            ));
        }

        if spec.names.len() > 1 {
            let also = format!("also: {}", spec.names[1..].join(", "));
            for line in wrap(&also, width.saturating_sub(pad.len())) {
                out.push_str(&format!(
                    "{pad}{}{line}{}\r\n",
                    if plain { "" } else { &dim },
                    if plain { "" } else { &reset }
                ));
            }
        }
        out.push_str("\r\n");
    }

    out.push_str(&reset);
    out.push_str("\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip(s: &str) -> String {
        let mut out = String::new();
        let mut chars = s.chars();
        while let Some(c) = chars.next() {
            if c == ESC {
                for c in chars.by_ref() {
                    if c == 'm' {
                        break;
                    }
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    #[test]
    fn every_command_is_documented() {
        for spec in commands() {
            assert!(!spec.names.is_empty(), "a command with no name");
            assert!(!spec.usage.is_empty(), "{:?} has no usage", spec.names);
            assert!(!spec.summary.is_empty(), "{:?} has no summary", spec.names);
            assert!(!spec.detail.is_empty(), "{:?} has no detail", spec.names);
        }
    }

    #[test]
    fn the_catalogue_covers_the_commands_we_actually_install() {
        let all: Vec<&str> = commands().iter().flat_map(|c| c.names.iter().copied()).collect();
        for expected in [
            "jky-terminal",
            "jkyterminal",
            "jkyTerminal",
            "jky ask",
            "jky asks",
            "jky commands",
            "jky command",
        ] {
            assert!(all.contains(&expected), "undocumented command: {expected}");
        }
    }

    #[test]
    fn no_name_is_claimed_by_two_commands() {
        let mut names: Vec<&str> = commands().iter().flat_map(|c| c.names.iter().copied()).collect();
        let count = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), count, "two commands claim the same name");
    }

    #[test]
    fn the_rendered_list_names_every_command() {
        let text = strip(&render_commands(Some((0, 229, 255)), 80));
        for spec in commands() {
            assert!(text.contains(spec.usage), "missing from output: {}", spec.usage);
        }
    }

    #[test]
    fn the_rendered_list_shows_alternative_spellings() {
        let text = strip(&render_commands(Some((0, 229, 255)), 80));
        assert!(text.contains("jkyterminal"));
        assert!(text.contains("jky asks"));
    }

    #[test]
    fn colour_is_used_when_a_palette_is_given() {
        assert!(render_commands(Some((0, 229, 255)), 80).contains("[38;2;0;229;255m"));
    }

    #[test]
    fn no_escape_sequences_are_emitted_without_a_palette() {
        // Correct when the output is piped somewhere rather than read.
        let out = render_commands(None, 80);
        assert!(!out.contains("[38;2;"), "colour leaked into plain output");
    }

    #[test]
    fn no_line_exceeds_the_terminal_width() {
        // A line longer than the pane wraps mid-word and turns the list into
        // noise, which is the opposite of what a help screen is for.
        for width in [30usize, 40, 60, 80, 200] {
            for line in strip(&render_commands(Some((0, 229, 255)), width)).split("\r\n") {
                assert!(
                    line.chars().count() <= width,
                    "line of {} exceeds width {width}: {line:?}",
                    line.chars().count()
                );
            }
        }
    }

    #[test]
    fn an_accent_is_parsed_from_hex() {
        assert_eq!(parse_accent("#00e5ff"), Some((0, 229, 255)));
        assert_eq!(parse_accent("  #7C3AED "), Some((124, 58, 237)));
    }

    #[test]
    fn an_unparseable_accent_yields_none_rather_than_a_guess() {
        for bad in ["", "00e5ff", "#fff", "#gggggg", "rgba(0,0,0,1)"] {
            assert_eq!(parse_accent(bad), None, "{bad} should not parse");
        }
    }

    #[test]
    fn wrap_breaks_on_word_boundaries() {
        assert_eq!(wrap("one two three four", 9), vec!["one two", "three", "four"]);
    }

    #[test]
    fn wrap_keeps_a_word_longer_than_the_width_intact() {
        // A split identifier is worse than one long line.
        assert_eq!(wrap("supercalifragilistic", 5), vec!["supercalifragilistic"]);
    }

    #[test]
    fn a_narrow_terminal_stacks_the_summary_under_the_usage() {
        let narrow = strip(&render_commands(None, 40));
        let wide = strip(&render_commands(None, 100));
        assert!(
            narrow.lines().count() > wide.lines().count(),
            "the narrow layout should use more lines, not wrap"
        );
    }

    #[test]
    fn output_uses_crlf_because_a_pty_expects_carriage_returns() {
        let out = render_commands(None, 80);
        assert!(out.contains("\r\n"));
        assert!(!out.contains("\n\n\n"), "excessive blank lines");
    }
}
