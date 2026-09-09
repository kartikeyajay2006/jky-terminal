use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::chord::{Chord, ChordError};

#[derive(Debug, thiserror::Error)]
pub enum KeymapError {
    #[error("`{0}` is not something this app can do")]
    UnknownAction(String),
    #[error("{0}")]
    Chord(#[from] ChordError),
    #[error("{chord} is already {action}")]
    Taken { chord: String, action: String },
    #[error("could not read the keymap: {0}")]
    Read(String),
    #[error("could not write the keymap: {0}")]
    Write(String),
    #[error("the keymap file is not valid JSON: {0}")]
    Parse(String),
}

/// One thing the app can be asked to do from the keyboard.
///
/// A fixed list rather than free strings. An action nobody implements is a
/// binding that silently does nothing, and the person who wrote it has no way
/// to tell that from a key that is not reaching the app at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    PaletteToggle,
    TabNew,
    TabClose,
    TabNext,
    TerminalFind,
    TerminalCopy,
    TerminalPaste,
    PaneSplitRight,
    PaneSplitDown,
    PaneClose,
    PaneFocusLeft,
    PaneFocusRight,
    PaneFocusUp,
    PaneFocusDown,
}

impl Action {
    /// The id used in the keymap file and over IPC.
    pub fn id(self) -> &'static str {
        match self {
            Action::PaletteToggle => "palette-toggle",
            Action::TabNew => "tab-new",
            Action::TabClose => "tab-close",
            Action::TabNext => "tab-next",
            Action::TerminalFind => "terminal-find",
            Action::TerminalCopy => "terminal-copy",
            Action::TerminalPaste => "terminal-paste",
            Action::PaneSplitRight => "pane-split-right",
            Action::PaneSplitDown => "pane-split-down",
            Action::PaneClose => "pane-close",
            Action::PaneFocusLeft => "pane-focus-left",
            Action::PaneFocusRight => "pane-focus-right",
            Action::PaneFocusUp => "pane-focus-up",
            Action::PaneFocusDown => "pane-focus-down",
        }
    }

    /// What the settings panel calls it.
    pub fn label(self) -> &'static str {
        match self {
            Action::PaletteToggle => "Command palette",
            Action::TabNew => "New terminal tab",
            Action::TabClose => "Close tab",
            Action::TabNext => "Next tab",
            Action::TerminalFind => "Find in terminal",
            Action::TerminalCopy => "Copy",
            Action::TerminalPaste => "Paste",
            Action::PaneSplitRight => "Split right",
            Action::PaneSplitDown => "Split down",
            Action::PaneClose => "Close pane",
            Action::PaneFocusLeft => "Focus pane left",
            Action::PaneFocusRight => "Focus pane right",
            Action::PaneFocusUp => "Focus pane up",
            Action::PaneFocusDown => "Focus pane down",
        }
    }

    /// Which part of the app it belongs to, for grouping in the panel.
    pub fn group(self) -> &'static str {
        match self {
            Action::PaletteToggle => "App",
            Action::TabNew | Action::TabClose | Action::TabNext => "Tabs",
            Action::TerminalFind | Action::TerminalCopy | Action::TerminalPaste => "Terminal",
            _ => "Panes",
        }
    }

    /// What it is bound to out of the box.
    pub fn default_chord(self) -> &'static str {
        match self {
            Action::PaletteToggle => "Ctrl+K",
            Action::TabNew => "Ctrl+T",
            Action::TabClose => "Ctrl+W",
            Action::TabNext => "Ctrl+Tab",
            Action::TerminalFind => "Ctrl+F",
            Action::TerminalCopy => "Ctrl+Shift+C",
            Action::TerminalPaste => "Ctrl+Shift+V",
            Action::PaneSplitRight => "Ctrl+Shift+D",
            Action::PaneSplitDown => "Ctrl+Shift+E",
            Action::PaneClose => "Ctrl+Shift+W",
            Action::PaneFocusLeft => "Ctrl+Shift+ArrowLeft",
            Action::PaneFocusRight => "Ctrl+Shift+ArrowRight",
            Action::PaneFocusUp => "Ctrl+Shift+ArrowUp",
            Action::PaneFocusDown => "Ctrl+Shift+ArrowDown",
        }
    }

    pub fn from_id(id: &str) -> Option<Action> {
        ACTIONS.iter().copied().find(|a| a.id() == id)
    }
}

/// Every action, in the order the settings panel lists them.
pub const ACTIONS: &[Action] = &[
    Action::PaletteToggle,
    Action::TabNew,
    Action::TabClose,
    Action::TabNext,
    Action::TerminalFind,
    Action::TerminalCopy,
    Action::TerminalPaste,
    Action::PaneSplitRight,
    Action::PaneSplitDown,
    Action::PaneClose,
    Action::PaneFocusLeft,
    Action::PaneFocusRight,
    Action::PaneFocusUp,
    Action::PaneFocusDown,
];

/// One row of the keymap, as the window receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Binding {
    pub action: String,
    pub label: String,
    pub group: String,
    /// The chord in force, canonical.
    pub chord: String,
    /// What it would be with no keymap file, so the panel can offer a reset.
    pub default_chord: String,
    /// Whether this row has been changed from the default.
    pub custom: bool,
}

/// Two actions on one chord.
///
/// Reported rather than resolved. A keymap can only arrive in this state by
/// being hand-edited, and quietly dropping one of the two would lose work
/// somebody did on purpose — so both are shown and the panel asks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    pub chord: String,
    pub actions: Vec<String>,
}

/// What is on disk: only the changes, never the whole table.
///
/// Storing the defaults too would freeze them — every default improved in a
/// later release would be overridden by a file written by an earlier one, for
/// every user who had ever opened the settings panel.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeymapFile {
    #[serde(default)]
    pub bindings: BTreeMap<String, Chord>,
}

pub struct Keymap {
    path: PathBuf,
}

impl Keymap {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    /// Read the overrides, treating a missing file as "no changes".
    pub fn load(&self) -> Result<KeymapFile, KeymapError> {
        match std::fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|e| KeymapError::Parse(e.to_string())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(KeymapFile::default()),
            Err(e) => Err(KeymapError::Read(e.to_string())),
        }
    }

    fn save(&self, file: &KeymapFile) -> Result<(), KeymapError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| KeymapError::Write(e.to_string()))?;
        }
        let text =
            serde_json::to_string_pretty(file).map_err(|e| KeymapError::Write(e.to_string()))?;
        std::fs::write(&self.path, text).map_err(|e| KeymapError::Write(e.to_string()))
    }

    /// The whole table: every action, with whatever is bound to it now.
    pub fn bindings(&self) -> Result<Vec<Binding>, KeymapError> {
        Ok(resolve(&self.load()?))
    }

    /// Any chord that two actions both answer to.
    pub fn conflicts(&self) -> Result<Vec<Conflict>, KeymapError> {
        Ok(conflicts(&resolve(&self.load()?)))
    }

    /// Point one action at a different chord.
    ///
    /// Refuses a chord another action already holds rather than taking it.
    /// Silently stealing it would leave the other action unreachable with
    /// nothing on screen having said so.
    pub fn bind(&self, action_id: &str, chord_text: &str) -> Result<Vec<Binding>, KeymapError> {
        let action =
            Action::from_id(action_id).ok_or_else(|| KeymapError::UnknownAction(action_id.into()))?;
        let chord = Chord::parse(chord_text)?;

        for existing in resolve(&self.load()?) {
            if existing.action != action.id() && existing.chord == chord.to_string() {
                return Err(KeymapError::Taken {
                    chord: chord.to_string(),
                    action: existing.label,
                });
            }
        }

        let mut file = self.load()?;
        // A binding equal to the default is an absence, not an entry. Writing
        // it down would pin this action to today's default for ever.
        if chord.to_string() == action.default_chord() {
            file.bindings.remove(action.id());
        } else {
            file.bindings.insert(action.id().to_string(), chord);
        }
        self.save(&file)?;
        Ok(resolve(&file))
    }

    /// Put one action back to its default.
    pub fn reset(&self, action_id: &str) -> Result<Vec<Binding>, KeymapError> {
        let action =
            Action::from_id(action_id).ok_or_else(|| KeymapError::UnknownAction(action_id.into()))?;
        let mut file = self.load()?;
        file.bindings.remove(action.id());
        self.save(&file)?;
        Ok(resolve(&file))
    }

    /// Put every action back to its default.
    pub fn reset_all(&self) -> Result<Vec<Binding>, KeymapError> {
        let file = KeymapFile::default();
        self.save(&file)?;
        Ok(resolve(&file))
    }
}

/// Lay the overrides over the defaults.
fn resolve(file: &KeymapFile) -> Vec<Binding> {
    ACTIONS
        .iter()
        .map(|action| {
            let custom = file.bindings.get(action.id());
            Binding {
                action: action.id().to_string(),
                label: action.label().to_string(),
                group: action.group().to_string(),
                chord: custom
                    .map(Chord::to_string)
                    .unwrap_or_else(|| action.default_chord().to_string()),
                default_chord: action.default_chord().to_string(),
                custom: custom.is_some(),
            }
        })
        .collect()
}

fn conflicts(bindings: &[Binding]) -> Vec<Conflict> {
    let mut by_chord: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for binding in bindings {
        by_chord.entry(&binding.chord).or_default().push(binding.label.clone());
    }
    by_chord
        .into_iter()
        .filter(|(_, actions)| actions.len() > 1)
        .map(|(chord, actions)| Conflict { chord: chord.to_string(), actions })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("jky-keys-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("keymap.json")
    }

    fn fresh() -> Keymap {
        let path = temp();
        let _ = std::fs::remove_file(&path);
        Keymap::new(path)
    }

    fn chord_for(bindings: &[Binding], action: Action) -> String {
        bindings.iter().find(|b| b.action == action.id()).unwrap().chord.clone()
    }

    #[test]
    fn every_action_has_a_default_that_parses() {
        // A default that does not parse is a shortcut that cannot fire, and
        // nothing would say so until somebody pressed it.
        for action in ACTIONS {
            let parsed = Chord::parse(action.default_chord())
                .unwrap_or_else(|e| panic!("{}: {e}", action.id()));
            assert_eq!(parsed.to_string(), action.default_chord(), "{}", action.id());
        }
    }

    #[test]
    fn no_two_actions_ship_on_the_same_chord() {
        assert_eq!(conflicts(&resolve(&KeymapFile::default())), vec![]);
    }

    #[test]
    fn every_action_id_is_distinct_and_round_trips() {
        let mut seen = std::collections::BTreeSet::new();
        for action in ACTIONS {
            assert!(seen.insert(action.id()), "{} twice", action.id());
            assert_eq!(Action::from_id(action.id()), Some(*action));
        }
    }

    #[test]
    fn a_missing_file_is_a_first_run_not_an_error() {
        let keys = fresh();
        assert_eq!(keys.load().unwrap(), KeymapFile::default());
        assert_eq!(keys.bindings().unwrap().len(), ACTIONS.len());
    }

    #[test]
    fn rebinding_survives_a_reload() {
        let keys = fresh();
        keys.bind(Action::PaneSplitRight.id(), "Ctrl+Alt+2").unwrap();
        assert_eq!(chord_for(&keys.bindings().unwrap(), Action::PaneSplitRight), "Ctrl+Alt+2");
    }

    #[test]
    fn refuses_a_chord_another_action_already_holds() {
        // Taking it silently would leave the other action unreachable, with
        // nothing on screen having said so.
        let keys = fresh();
        let err = keys.bind(Action::PaneSplitRight.id(), "Ctrl+T").unwrap_err();
        assert!(matches!(err, KeymapError::Taken { .. }), "{err}");
        assert_eq!(chord_for(&keys.bindings().unwrap(), Action::PaneSplitRight), "Ctrl+Shift+D");
    }

    #[test]
    fn rebinding_an_action_to_what_it_already_has_is_fine() {
        let keys = fresh();
        keys.bind(Action::TabNew.id(), "Ctrl+T").unwrap();
        assert!(!keys.bindings().unwrap().iter().any(|b| b.custom));
    }

    #[test]
    fn a_binding_equal_to_the_default_is_not_written_down() {
        // Writing it would pin the action to today's default for ever: a
        // better default in a later release would be overridden by a file
        // written by an earlier one.
        let keys = fresh();
        keys.bind(Action::TabNew.id(), "Ctrl+Alt+N").unwrap();
        keys.bind(Action::TabNew.id(), "Ctrl+T").unwrap();
        assert!(keys.load().unwrap().bindings.is_empty());
    }

    #[test]
    fn refuses_a_chord_that_would_break_the_shell() {
        let keys = fresh();
        assert!(keys.bind(Action::TabNew.id(), "Ctrl+C").is_err());
        assert!(keys.bind(Action::TabNew.id(), "N").is_err());
    }

    #[test]
    fn refuses_an_action_nobody_implements() {
        let keys = fresh();
        assert!(matches!(
            keys.bind("make-the-tea", "Ctrl+Alt+T"),
            Err(KeymapError::UnknownAction(_))
        ));
    }

    #[test]
    fn resets_one_action_and_leaves_the_rest() {
        let keys = fresh();
        keys.bind(Action::TabNew.id(), "Ctrl+Alt+N").unwrap();
        keys.bind(Action::TabClose.id(), "Ctrl+Alt+Q").unwrap();

        keys.reset(Action::TabNew.id()).unwrap();
        let bindings = keys.bindings().unwrap();
        assert_eq!(chord_for(&bindings, Action::TabNew), "Ctrl+T");
        assert_eq!(chord_for(&bindings, Action::TabClose), "Ctrl+Alt+Q");
    }

    #[test]
    fn resets_everything() {
        let keys = fresh();
        keys.bind(Action::TabNew.id(), "Ctrl+Alt+N").unwrap();
        keys.reset_all().unwrap();
        assert!(keys.bindings().unwrap().iter().all(|b| !b.custom));
    }

    #[test]
    fn reports_a_collision_a_hand_edited_file_created() {
        // Two actions on one chord cannot be reached through `bind`, but a
        // file somebody edited can hold it. Dropping one silently would lose
        // work done on purpose.
        let mut file = KeymapFile::default();
        file.bindings.insert(Action::TabNew.id().into(), Chord::parse("Ctrl+F").unwrap());

        let found = conflicts(&resolve(&file));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].chord, "Ctrl+F");
        assert_eq!(found[0].actions.len(), 2);
    }

    #[test]
    fn a_stored_chord_is_its_text() {
        // So the file can be read and edited by a person.
        let mut file = KeymapFile::default();
        file.bindings.insert(Action::TabNew.id().into(), Chord::parse("ctrl+alt+n").unwrap());
        let json = serde_json::to_string(&file).unwrap();
        assert!(json.contains("\"Ctrl+Alt+N\""), "{json}");
    }

    #[test]
    fn a_file_with_an_impossible_chord_is_refused_when_it_is_read() {
        // Rather than the first time the key is pressed.
        assert!(serde_json::from_str::<KeymapFile>(r#"{"bindings":{"tab-new":"Ctrl+Nonsense"}}"#).is_err());
        assert!(serde_json::from_str::<KeymapFile>(r#"{"bindings":{"tab-new":"N"}}"#).is_err());
    }
}
