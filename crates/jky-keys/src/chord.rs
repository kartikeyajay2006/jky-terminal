//! One keystroke, written down.
//!
//! Chords are stored and compared in a canonical form, so `ctrl+shift+d`,
//! `Shift+Ctrl+D` and `CTRL+SHIFT+d` are one binding rather than three that
//! silently shadow each other in a config file nobody can debug.

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ChordError {
    #[error("a shortcut cannot be empty")]
    Empty,
    #[error("`{0}` is not a key this app can see")]
    UnknownKey(String),
    #[error("`{0}` is not a modifier")]
    UnknownModifier(String),
    #[error("`{0}` names a modifier twice")]
    RepeatedModifier(String),
    #[error(
        "`{0}` has no modifier. An unmodified key belongs to the shell, where every keystroke \
         means something"
    )]
    NoModifier(String),
    #[error(
        "`{0}` is how you interrupt a running command and how you end its input. Rebinding \
         either would take a working terminal away from you"
    )]
    Reserved(String),
}

/// One keystroke.
///
/// `ctrl` is one flag, not two. `Ctrl` on Windows and Linux and `Cmd` on
/// macOS are the same idea wearing different names, and every shortcut in
/// this app has always accepted either — so a keymap that stored them apart
/// would let someone bind a shortcut that works on one of their machines and
/// not the other. Written as `Ctrl`; `Cmd`, `Meta` and `Super` all parse to
/// it.
///
/// On the wire and on disk a chord is its text: `"Ctrl+Shift+D"` is what
/// someone editing the file by hand would write and what they expect to read
/// back. Parsing on the way in means a bad chord is refused when the file is
/// read rather than the first time the key is pressed.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Chord {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    /// Canonical: a single uppercase character, or a named key like `Tab`.
    pub key: Key,
}

/// A key name, canonicalised on the way in.
///
/// A newtype rather than a bare String so nothing can put `arrowleft` in a
/// keymap and wonder why the arrow does nothing.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Key(String);

impl Key {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Keys with names rather than characters, in the spelling the DOM uses.
///
/// The DOM's spelling is the one that matters: these are compared against
/// `KeyboardEvent.key` in the window, and a table that disagreed with it
/// would produce a keymap that reads correctly and never fires.
const NAMED: &[&str] = &[
    "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "F1", "F2", "F3", "F4", "F5", "F6",
    "F7", "F8", "F9", "F10", "F11", "F12",
];

/// Ctrl+C and Ctrl+D, which belong to the shell and cannot be taken.
///
/// Not a general list of shell keys — the app already claims Ctrl+K and
/// Ctrl+W, and pretending otherwise would be theatre. These two are the pair
/// that stop a terminal being a terminal: without interrupt a runaway command
/// cannot be stopped, and without end-of-input a shell cannot be left.
const RESERVED: &[(&str, bool)] = &[("C", false), ("D", false)];

fn canonical_key(raw: &str) -> Result<Key, ChordError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ChordError::Empty);
    }

    // A named key, matched without regard to case so a config file may say
    // `arrowleft`, and stored in the DOM's spelling so the window can compare
    // it directly.
    if let Some(found) = NAMED.iter().find(|n| n.eq_ignore_ascii_case(trimmed)) {
        return Ok(Key((*found).to_string()));
    }

    let mut chars = trimmed.chars();
    let first = chars.next().ok_or(ChordError::Empty)?;
    if chars.next().is_none() && (first.is_ascii_alphanumeric() || first.is_ascii_punctuation()) {
        return Ok(Key(first.to_ascii_uppercase().to_string()));
    }

    Err(ChordError::UnknownKey(trimmed.to_string()))
}

impl Chord {
    /// Read a chord, and refuse the ones that would break a terminal.
    pub fn parse(text: &str) -> Result<Self, ChordError> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(ChordError::Empty);
        }

        // `+` separates a chord, and is also a key somebody may want to bind.
        // A trailing one is the key: `Ctrl++` is the plus key, not a chord
        // that forgot its ending.
        let (mod_text, key_text): (&str, &str) = if let Some(head) = trimmed.strip_suffix('+') {
            (head.trim_end_matches('+'), "+")
        } else {
            match trimmed.rsplit_once('+') {
                Some((mods, key)) => (mods, key),
                None => ("", trimmed),
            }
        };

        let mut chord = Chord { ctrl: false, shift: false, alt: false, key: canonical_key(key_text)? };

        let parts: Vec<&str> = if mod_text.trim().is_empty() {
            Vec::new()
        } else {
            mod_text.split('+').map(str::trim).collect()
        };

        for part in parts {
            let slot = match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" | "cmd" | "command" | "meta" | "super" | "mod" => &mut chord.ctrl,
                "shift" => &mut chord.shift,
                "alt" | "option" | "opt" => &mut chord.alt,
                "" => return Err(ChordError::UnknownModifier(String::new())),
                other => return Err(ChordError::UnknownModifier(other.to_string())),
            };
            if *slot {
                return Err(ChordError::RepeatedModifier(trimmed.to_string()));
            }
            *slot = true;
        }

        // Every binding takes a modifier. This is the rule the whole keyboard
        // model rests on: it is what lets a terminal keep every unmodified
        // key, and a keymap that let someone bind `D` would break the shell
        // the first time they typed a word containing one.
        if !chord.ctrl && !chord.alt {
            return Err(ChordError::NoModifier(trimmed.to_string()));
        }

        if RESERVED
            .iter()
            .any(|(key, shift)| chord.ctrl && !chord.alt && chord.shift == *shift && chord.key.as_str() == *key)
        {
            return Err(ChordError::Reserved(chord.to_string()));
        }

        Ok(chord)
    }
}

impl fmt::Display for Chord {
    /// The canonical spelling: modifiers in a fixed order, then the key.
    ///
    /// Fixed order because this string is the identity of a binding — two
    /// spellings of one chord would let a keymap hold the same shortcut twice
    /// and disagree with itself about which action it runs.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.ctrl {
            f.write_str("Ctrl+")?;
        }
        if self.alt {
            f.write_str("Alt+")?;
        }
        if self.shift {
            f.write_str("Shift+")?;
        }
        write!(f, "{}", self.key)
    }
}

impl Serialize for Chord {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Chord {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        Chord::parse(&raw).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plain_chord() {
        let chord = Chord::parse("Ctrl+Shift+D").unwrap();
        assert!(chord.ctrl && chord.shift && !chord.alt);
        assert_eq!(chord.key.as_str(), "D");
    }

    #[test]
    fn one_chord_however_it_is_spelled() {
        // The whole point of canonicalising. Three spellings that produced
        // three bindings would shadow one another in a file nobody can debug.
        let forms = ["Ctrl+Shift+D", "shift+ctrl+d", "CTRL+SHIFT+D", " Cmd + Shift + d "];
        let first = Chord::parse(forms[0]).unwrap();
        for form in forms {
            assert_eq!(Chord::parse(form).unwrap(), first, "{form}");
        }
    }

    #[test]
    fn cmd_and_ctrl_are_the_same_modifier() {
        // Storing them apart would let someone bind a shortcut that works on
        // their laptop and not on their desktop.
        assert_eq!(Chord::parse("Cmd+T").unwrap(), Chord::parse("Ctrl+T").unwrap());
        assert_eq!(Chord::parse("Meta+T").unwrap(), Chord::parse("Ctrl+T").unwrap());
    }

    #[test]
    fn named_keys_come_back_in_the_spelling_the_window_uses() {
        // Compared against KeyboardEvent.key. A table that disagreed with the
        // DOM would read correctly and never fire.
        assert_eq!(Chord::parse("Ctrl+arrowleft").unwrap().key.as_str(), "ArrowLeft");
        assert_eq!(Chord::parse("Ctrl+TAB").unwrap().key.as_str(), "Tab");
        assert_eq!(Chord::parse("Ctrl+f5").unwrap().key.as_str(), "F5");
    }

    #[test]
    fn prints_back_what_it_read() {
        for text in ["Ctrl+Shift+D", "Ctrl+Alt+Shift+ArrowLeft", "Ctrl+Tab", "Alt+F4"] {
            assert_eq!(Chord::parse(text).unwrap().to_string(), text);
        }
    }

    #[test]
    fn refuses_a_key_with_no_modifier() {
        // The rule the keyboard model rests on. Binding a bare `D` would
        // break the shell the first time someone typed a word with one in it.
        assert!(matches!(Chord::parse("D"), Err(ChordError::NoModifier(_))));
        assert!(matches!(Chord::parse("Shift+D"), Err(ChordError::NoModifier(_))));
    }

    #[test]
    fn refuses_interrupt_and_end_of_input() {
        assert!(matches!(Chord::parse("Ctrl+C"), Err(ChordError::Reserved(_))));
        assert!(matches!(Chord::parse("Ctrl+D"), Err(ChordError::Reserved(_))));
        // Shifted, they are the app's own copy and split bindings, and have
        // never belonged to the shell.
        assert!(Chord::parse("Ctrl+Shift+C").is_ok());
        assert!(Chord::parse("Ctrl+Shift+D").is_ok());
    }

    #[test]
    fn refuses_nonsense() {
        assert_eq!(Chord::parse(""), Err(ChordError::Empty));
        assert!(matches!(Chord::parse("Hyper+K"), Err(ChordError::UnknownModifier(_))));
        assert!(matches!(Chord::parse("Ctrl+Wingdings"), Err(ChordError::UnknownKey(_))));
        assert!(matches!(Chord::parse("Ctrl+Ctrl+K"), Err(ChordError::RepeatedModifier(_))));
    }

    #[test]
    fn binds_punctuation_including_the_separator() {
        assert_eq!(Chord::parse("Ctrl++").unwrap().key.as_str(), "+");
        assert_eq!(Chord::parse("Ctrl+/").unwrap().key.as_str(), "/");
    }

    #[test]
    fn alt_alone_is_modifier_enough() {
        assert!(Chord::parse("Alt+F4").is_ok());
    }
}
