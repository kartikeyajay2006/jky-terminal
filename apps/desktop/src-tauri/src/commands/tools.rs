//! The developer tools that live in Rust, over IPC.
//!
//! Thin wrappers, as everywhere in this directory. Every one of these is a
//! function of its arguments — no network, no filesystem, no credential — so
//! the only thing this layer adds is a bound on how much text the window may
//! hand over.
//!
//! That bound is not politeness. These commands take arbitrary text from the
//! renderer, and hashing or diffing a hundred megabytes of it would block a
//! worker thread for as long as it took. A megabyte is far more than anyone
//! pastes into a panel and far less than anyone can hurt the app with.

use jky_tools::{Diff, Hashes};

/// The most text any of these will accept, per argument.
const MAX_INPUT: usize = 1024 * 1024;

fn bounded(text: &str) -> Result<(), String> {
    if text.len() > MAX_INPUT {
        return Err("that is too much text for this tool — try a smaller piece".into());
    }
    Ok(())
}

#[tauri::command]
pub fn tools_hash(text: String) -> Result<Hashes, String> {
    bounded(&text)?;
    Ok(jky_tools::hash_all(&text))
}

#[tauri::command]
pub fn tools_diff(before: String, after: String) -> Result<Diff, String> {
    bounded(&before)?;
    bounded(&after)?;
    Ok(jky_tools::diff_lines(&before, &after))
}

#[tauri::command]
pub fn tools_yaml_to_json(text: String) -> Result<String, String> {
    bounded(&text)?;
    jky_tools::yaml_to_json(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tools_format_yaml(text: String) -> Result<String, String> {
    bounded(&text)?;
    jky_tools::format_yaml(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_more_text_than_anyone_would_paste() {
        let huge = "x".repeat(MAX_INPUT + 1);
        assert!(tools_hash(huge.clone()).is_err());
        assert!(tools_diff(huge.clone(), String::new()).is_err());
        assert!(tools_diff(String::new(), huge.clone()).is_err());
        assert!(tools_yaml_to_json(huge).is_err());
    }

    // The bound is a ceiling on abuse, not a limit anyone should meet.
    #[test]
    fn accepts_a_large_but_reasonable_paste() {
        assert!(tools_hash("y".repeat(MAX_INPUT).to_string()).is_ok());
    }

    #[test]
    fn refuses_the_second_argument_as_well_as_the_first() {
        // Checking only `before` would leave the larger of the two unbounded
        // exactly half the time.
        let huge = "x".repeat(MAX_INPUT + 1);
        assert!(tools_diff("small".to_string(), huge).is_err());
    }

    #[test]
    fn passes_a_parse_error_through_rather_than_swallowing_it() {
        let err = tools_yaml_to_json("a: [1, 2\n".to_string()).unwrap_err();
        assert!(err.contains("line"), "the position was lost: {err}");
    }
}
