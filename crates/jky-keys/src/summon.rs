//! The shortcut that summons JKY from anywhere.
//!
//! Unlike the in-app keymap, this shortcut is taken from every other program
//! on the machine while JKY holds it, so it has rules of its own. It needs at
//! least one modifier, and a lone Ctrl or Shift is refused: `Ctrl+J` is a
//! newline in every terminal and `Shift+J` is a capital letter, and taking
//! either from the whole system would break something people use all day.
//!
//! People type shortcuts however they think of them — `cmd+j`, `ctrl alt
//! space`, `Ctrl-Option-J` — so many spellings are accepted and each becomes
//! one canonical form, `Ctrl+Alt+Shift+Super+Key` in that order. The
//! installers apply the same rules, and all three are tested against
//! `scripts/install/shortcuts.tsv`, so they cannot drift apart.

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SummonError {
    #[error("type a shortcut such as Super+J or Ctrl+Alt+J")]
    Empty,
    #[error("`{0}` is not a modifier — use Ctrl, Alt, Shift or Super")]
    UnknownModifier(String),
    #[error("{0} is listed twice")]
    Repeated(&'static str),
    #[error("a shortcut needs one key after its modifiers, such as J, 5, F12 or Space")]
    NoKey,
    #[error("a shortcut has one key, not several: `{0}`")]
    TwoKeys(String),
    #[error("`{0}` cannot be the key — use a letter, a digit, F1 to F24, or Space")]
    UnsupportedKey(String),
    #[error("a shortcut needs a modifier: Ctrl, Alt, Shift or Super")]
    NoModifier,
    #[error(
        "{0} on its own would take that key from every other app — add Alt, Shift or Super"
    )]
    TooCommon(&'static str),
}

/// The modifiers, in the order a canonical shortcut lists them.
const ORDER: [&str; 4] = ["Ctrl", "Alt", "Shift", "Super"];

fn modifier(word: &str) -> Option<&'static str> {
    match word {
        "ctrl" | "control" | "ctl" => Some("Ctrl"),
        "alt" | "option" | "opt" => Some("Alt"),
        "shift" => Some("Shift"),
        "super" | "win" | "windows" | "cmd" | "command" | "meta" => Some("Super"),
        _ => None,
    }
}

fn key(word: &str) -> Result<String, SummonError> {
    let lower = word.to_ascii_lowercase();
    if lower == "space" {
        return Ok("Space".into());
    }
    if word.len() == 1 && word.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Ok(word.to_ascii_uppercase());
    }
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&n) && lower == format!("f{n}") {
            return Ok(format!("F{n}"));
        }
    }
    Err(SummonError::UnsupportedKey(word.to_string()))
}

/// Read a shortcut as a person typed it, and return its canonical form.
pub fn normalize(input: &str) -> Result<String, SummonError> {
    let words: Vec<String> = input
        .split(|c: char| c == '+' || c == '-' || c.is_whitespace())
        .filter(|w| !w.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    if words.is_empty() {
        return Err(SummonError::Empty);
    }

    let mut held: Vec<&'static str> = Vec::new();
    let mut found: Option<String> = None;
    for (i, word) in words.iter().enumerate() {
        let last = i + 1 == words.len();
        if let Some(m) = modifier(word) {
            if held.contains(&m) {
                return Err(SummonError::Repeated(m));
            }
            held.push(m);
        } else if last {
            found = Some(key(word)?);
        } else if modifier_like(word) {
            return Err(SummonError::UnknownModifier(word.clone()));
        } else {
            return Err(SummonError::TwoKeys(words[i..].join("+")));
        }
    }
    let key = found.ok_or(SummonError::NoKey)?;
    if held.is_empty() {
        return Err(SummonError::NoModifier);
    }
    if held.len() == 1 && (held[0] == "Ctrl" || held[0] == "Shift") {
        return Err(SummonError::TooCommon(held[0]));
    }

    let mut parts: Vec<&str> = ORDER.iter().copied().filter(|m| held.contains(m)).collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

/// A word in modifier position that is not a key either — `hyper`, `fn`.
fn modifier_like(word: &str) -> bool {
    key(word).is_err()
}

/// Whether the person asked for no shortcut at all.
pub fn is_off(input: &str) -> bool {
    matches!(input.trim().to_ascii_lowercase().as_str(), "" | "none" | "off" | "skip")
}

/// The canonical form, as the global-shortcut library spells it.
///
/// `Super` is `Super` there too; only the key needs care: letters become
/// `KeyJ`, digits `Digit5`, the rest keep their names.
pub fn accelerator(canonical: &str) -> String {
    canonical
        .split('+')
        .map(|part| {
            if part.len() == 1 && part.chars().all(|c| c.is_ascii_uppercase()) {
                format!("Key{part}")
            } else if part.len() == 1 && part.chars().all(|c| c.is_ascii_digit()) {
                format!("Digit{part}")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../scripts/install/shortcuts.tsv");

    #[test]
    fn every_shared_case_reads_the_way_the_installers_read_it() {
        let mut checked = 0;
        for line in CASES.lines().filter(|l| !l.starts_with('#')) {
            let (input, expected) = line.split_once('\t').expect("input<TAB>expected");
            let got = normalize(input);
            if expected == "ERROR" {
                assert!(got.is_err(), "{input:?} should be refused, got {got:?}");
            } else {
                assert_eq!(got.as_deref(), Ok(expected), "{input:?}");
            }
            checked += 1;
        }
        assert!(checked >= 30, "only {checked} cases were read");
    }

    #[test]
    fn refusals_say_what_to_do_instead() {
        assert_eq!(normalize("ctrl+j").unwrap_err().to_string(), "Ctrl on its own would take that key from every other app — add Alt, Shift or Super");
        assert!(normalize("hyper+j").unwrap_err().to_string().contains("not a modifier"));
        assert!(normalize("ctrl+alt+tab").unwrap_err().to_string().contains("F1 to F24"));
    }

    #[test]
    fn off_has_several_spellings() {
        for off in ["", " none ", "OFF", "skip"] {
            assert!(is_off(off), "{off:?}");
        }
        assert!(!is_off("super+j"));
    }

    #[test]
    fn the_library_gets_its_own_key_names() {
        assert_eq!(accelerator("Super+J"), "Super+KeyJ");
        assert_eq!(accelerator("Ctrl+Alt+5"), "Ctrl+Alt+Digit5");
        assert_eq!(accelerator("Ctrl+Alt+Space"), "Ctrl+Alt+Space");
        assert_eq!(accelerator("Alt+F12"), "Alt+F12");
    }
}
