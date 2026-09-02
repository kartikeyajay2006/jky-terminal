//! The developer tools that need a dependency.
//!
//! Six tools ship in the Apps section; three of them are here and three are
//! in TypeScript. The line is not arbitrary: JSON, JWT decoding and regular
//! expressions are native to the window and instant there, so a round trip
//! through IPC would buy nothing and cost a frame. Hashing, diffing and YAML
//! each need a parser or an algorithm somebody else wrote, and those belong
//! on this side — where the dependency is audited with the rest, and where a
//! large input is not being chewed on by the thread drawing the interface.
//!
//! Nothing here touches the network, the filesystem, or a credential. These
//! are functions of their arguments, which is what makes them testable
//! against answers computed by someone else.

use serde::Serialize;
use sha2::Digest;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("that is not valid YAML: {0}")]
    Yaml(String),
    #[error("that is not valid JSON: {0}")]
    Json(String),
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/// One input, every digest.
///
/// All four at once because computing them costs nothing next to the round
/// trip, and the question "which of these is the one I have" is answered by
/// seeing them together rather than by picking one and trying again.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Hashes {
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
    pub sha512: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hash the bytes of some text.
///
/// The bytes, not the characters: "é" is two bytes in UTF-8 and hashes to
/// something entirely unlike "e". That is the correct behaviour and worth
/// stating, because a hash tool that quietly normalised its input would
/// disagree with every other tool on earth.
///
/// MD5 and SHA-1 are here because files and older systems still use them, not
/// because they are safe. Neither should be used to prove anything.
pub fn hash_all(input: &str) -> Hashes {
    let bytes = input.as_bytes();
    Hashes {
        md5: hex(&md5::Md5::digest(bytes)),
        sha1: hex(&sha1::Sha1::digest(bytes)),
        sha256: hex(&sha2::Sha256::digest(bytes)),
        sha512: hex(&sha2::Sha512::digest(bytes)),
    }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/// One line of a diff.
///
/// Both line numbers, because after the first change the two sides stop
/// agreeing about what line anything is on — and going to look at the line a
/// diff names is the entire reason to read one. A line that exists on only
/// one side has `None` for the other, which is the truth rather than a zero.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiffLine {
    /// `same`, `added` or `removed`.
    pub kind: String,
    pub old: Option<usize>,
    pub new: Option<usize>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Diff {
    pub lines: Vec<DiffLine>,
    pub added: usize,
    pub removed: usize,
}

/// Compare two texts line by line.
///
/// Split into lines first, rather than handed over as raw text. `similar`
/// is right that `"one"` and `"one\n"` are different files — one ends with a
/// newline and the other does not — but this is a tool for comparing two
/// things someone pasted, and the newline is trimmed for display anyway. Left
/// alone it produces a removed row and an added row that read identically on
/// screen, which looks like a bug in the diff rather than a fact about the
/// input. A trailing-newline-only difference is deliberately not shown.
pub fn diff_lines(before: &str, after: &str) -> Diff {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    let diff = similar::TextDiff::from_slices(&old, &new);
    let mut lines = Vec::new();
    let (mut added, mut removed) = (0, 0);

    for change in diff.iter_all_changes() {
        let kind = match change.tag() {
            similar::ChangeTag::Equal => "same",
            similar::ChangeTag::Insert => {
                added += 1;
                "added"
            }
            similar::ChangeTag::Delete => {
                removed += 1;
                "removed"
            }
        };

        lines.push(DiffLine {
            kind: kind.to_string(),
            // One-based, because that is how every editor counts.
            old: change.old_index().map(|i| i + 1),
            new: change.new_index().map(|i| i + 1),
            text: (*change.value()).to_string(),
        });
    }

    Diff { lines, added, removed }
}

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

/// YAML in, JSON out.
///
/// Everything goes through the parser rather than being rewritten textually,
/// so what comes out is what the input *meant*. A YAML file that looks tidy
/// and parses to something surprising is exactly the file someone opens a
/// tool to understand.
pub fn yaml_to_json(text: &str) -> Result<String, ToolError> {
    let value: serde_json::Value =
        serde_norway::from_str(text).map_err(|e| ToolError::Yaml(e.to_string()))?;
    serde_json::to_string_pretty(&value).map_err(|e| ToolError::Json(e.to_string()))
}

/// JSON in, YAML out.
pub fn json_to_yaml(text: &str) -> Result<String, ToolError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ToolError::Json(e.to_string()))?;
    serde_norway::to_string(&value).map_err(|e| ToolError::Yaml(e.to_string()))
}

/// YAML in, the same YAML tidied.
///
/// A round trip through the parser, for the same reason: the output says what
/// the input meant, and any disagreement between the two is the thing worth
/// seeing.
pub fn format_yaml(text: &str) -> Result<String, ToolError> {
    let value: serde_json::Value =
        serde_norway::from_str(text).map_err(|e| ToolError::Yaml(e.to_string()))?;
    serde_norway::to_string(&value).map_err(|e| ToolError::Yaml(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- hashing ----

    /*
     * The published test vectors.
     *
     * A hash function that is subtly wrong still returns a plausible-looking
     * string, so the only way to know it is right is to check it against
     * answers computed by someone else.
     */
    #[test]
    fn hashes_the_empty_string_the_way_the_world_does() {
        let h = hash_all("");
        assert_eq!(h.md5, "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(h.sha1, "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            h.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hashes_abc_the_way_the_world_does() {
        let h = hash_all("abc");
        assert_eq!(h.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(h.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            h.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    // Hashing text means hashing its bytes, and the bytes of "é" are not the
    // bytes of "e".
    #[test]
    fn hashes_bytes_rather_than_characters() {
        assert_ne!(hash_all("é").sha256, hash_all("e").sha256);
        assert_eq!(hash_all("é").sha256.len(), 64);
    }

    #[test]
    fn writes_every_digest_as_lowercase_hex_of_the_right_length() {
        let h = hash_all("anything");
        for (name, digest, len) in [
            ("md5", &h.md5, 32),
            ("sha1", &h.sha1, 40),
            ("sha256", &h.sha256, 64),
            ("sha512", &h.sha512, 128),
        ] {
            assert_eq!(digest.len(), len, "{name} is the wrong length");
            assert!(
                digest.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
                "{name} is not lowercase hex: {digest}"
            );
        }
    }

    // ---- diffing ----

    #[test]
    fn finds_no_difference_between_a_file_and_itself() {
        let d = diff_lines("one\ntwo\n", "one\ntwo\n");
        assert_eq!(d.added, 0);
        assert_eq!(d.removed, 0);
        assert!(d.lines.iter().all(|l| l.kind == "same"));
    }

    #[test]
    fn finds_an_added_line() {
        let d = diff_lines("one\n", "one\ntwo\n");
        assert_eq!(d.added, 1);
        assert_eq!(d.removed, 0);
        let added: Vec<&DiffLine> = d.lines.iter().filter(|l| l.kind == "added").collect();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].text, "two");
    }

    #[test]
    fn finds_a_removed_line() {
        let d = diff_lines("one\ntwo\n", "one\n");
        assert_eq!(d.removed, 1);
        assert_eq!(d.added, 0);
    }

    /*
     * Line numbers on both sides.
     *
     * A diff without them is a list of strings. The whole reason to read one
     * is to go and look at the line it names, and after the first change the
     * two sides no longer agree about what line that is.
     */
    #[test]
    fn numbers_both_sides_independently() {
        let d = diff_lines("a\nb\nc\n", "a\nx\nb\nc\n");
        let inserted = d.lines.iter().find(|l| l.kind == "added").expect("an insert");
        assert_eq!(inserted.old, None, "an added line exists on one side only");
        assert_eq!(inserted.new, Some(2));

        let last = d.lines.iter().rfind(|l| l.kind == "same").expect("a common line");
        assert_eq!(last.old, Some(3));
        assert_eq!(last.new, Some(4));
    }

    #[test]
    fn compares_two_empty_files_without_complaint() {
        let d = diff_lines("", "");
        assert_eq!(d.added, 0);
        assert_eq!(d.removed, 0);
    }

    /*
     * A missing trailing newline is not a changed line.
     *
     * Compared as raw text, `"one"` and `"one\n"` differ — and since the
     * newline is trimmed for display, the result is a removed row and an
     * added row that read identically on screen. That looks like a broken
     * diff rather than a fact about the input, so lines are compared as
     * lines.
     */
    #[test]
    fn does_not_invent_a_change_from_a_missing_trailing_newline() {
        assert_eq!(diff_lines("one", "one").added, 0);
        assert_eq!(diff_lines("one", "one\n").lines.len(), 1);
        assert_eq!(diff_lines("one", "one\n").added, 0);
        assert_eq!(diff_lines("a\nb", "a\nb\n").removed, 0);
    }

    // The point of a diff is that unchanged text costs nothing to compare.
    #[test]
    fn handles_a_large_file_without_comparing_everything_to_everything() {
        let big: String = (0..5000).map(|i| format!("line {i}\n")).collect();
        let changed = big.replace("line 4999", "line changed");
        let d = diff_lines(&big, &changed);
        assert_eq!(d.added, 1);
        assert_eq!(d.removed, 1);
    }

    // ---- yaml ----

    #[test]
    fn turns_yaml_into_json() {
        let json = yaml_to_json("name: jky\nport: 8080\ntags:\n  - a\n  - b\n").expect("valid");
        assert!(json.contains("\"name\": \"jky\""), "got {json}");
        assert!(json.contains("\"port\": 8080"), "got {json}");
        assert!(json.contains("\"a\""));
    }

    #[test]
    fn turns_json_into_yaml() {
        let yaml = json_to_yaml(r#"{"name":"jky","tags":["a","b"]}"#).expect("valid");
        assert!(yaml.contains("name: jky"), "got {yaml}");
        assert!(yaml.contains("- a"), "got {yaml}");
    }

    /*
     * An error has to say where.
     *
     * "Invalid YAML" in a file of two hundred lines is not a message, it is a
     * search. The parser knows the line; the tool's job is to pass it on.
     */
    #[test]
    fn says_where_the_yaml_stopped_making_sense() {
        let err = yaml_to_json("a: [1, 2\n").expect_err("invalid");
        let text = err.to_string();
        assert!(text.contains("line"), "no line in: {text}");
    }

    /*
     * YAML accepts more than it looks like it should.
     *
     * `good: yes` followed by an indented line is not a mistake — it is a
     * multiline scalar, and the value is "yes bad indent here". This test
     * exists because the first version of the one above used it as an example
     * of invalid YAML and was wrong. A tool that called this an error would
     * be confidently wrong at exactly the moment someone came to it for an
     * answer.
     */
    #[test]
    fn accepts_the_indented_continuation_that_looks_like_a_mistake() {
        let json = yaml_to_json("good: yes\n  bad indent here\n").expect("valid YAML");
        assert!(json.contains("bad indent here"), "got {json}");
    }

    #[test]
    fn refuses_json_that_is_not_json() {
        assert!(json_to_yaml("{not json").is_err());
    }

    #[test]
    fn tidies_yaml_without_changing_what_it_says() {
        let messy = "b:    2\na:  1\n";
        let tidy = format_yaml(messy).expect("valid");
        // Round-tripped through the parser, so the result is what the input
        // meant rather than what it looked like.
        assert_eq!(yaml_to_json(&tidy).unwrap(), yaml_to_json(messy).unwrap());
        assert!(tidy.contains("a: 1"), "got {tidy}");
    }

    // An empty document is valid YAML, and saying otherwise would be wrong
    // about the commonest file anyone opens by accident.
    #[test]
    fn treats_an_empty_document_as_valid() {
        assert!(yaml_to_json("").is_ok());
        assert!(format_yaml("").is_ok());
    }

    // YAML is a superset of JSON, so this has to work.
    #[test]
    fn reads_json_as_the_yaml_it_also_is() {
        assert!(yaml_to_json(r#"{"a": 1}"#).is_ok());
    }
}
