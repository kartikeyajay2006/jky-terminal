//! One handle over the four collections.

use std::path::{Path, PathBuf};

use crate::collection::Collection;
use crate::model::{Event, Note, Reminder, Todo};

/// The dashboard's data, on disk.
///
/// Four files rather than one. A file that fails to write, or is corrupted by
/// something outside this app, then costs the user that one collection
/// instead of everything they have ever saved.
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        Self { dir: dir.as_ref().to_path_buf() }
    }

    pub fn notes(&self) -> Collection<Note> {
        Collection::new(self.dir.join("notes.json"))
    }

    pub fn todos(&self) -> Collection<Todo> {
        Collection::new(self.dir.join("todos.json"))
    }

    pub fn events(&self) -> Collection<Event> {
        Collection::new(self.dir.join("events.json"))
    }

    pub fn reminders(&self) -> Collection<Reminder> {
        Collection::new(self.dir.join("reminders.json"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::EventColour;

    #[test]
    fn each_collection_gets_its_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());

        let paths = [
            store.notes().path().to_path_buf(),
            store.todos().path().to_path_buf(),
            store.events().path().to_path_buf(),
            store.reminders().path().to_path_buf(),
        ];

        let unique: std::collections::HashSet<_> = paths.iter().collect();
        assert_eq!(unique.len(), 4, "two collections share a file: {paths:?}");
    }

    #[test]
    fn losing_one_collection_does_not_lose_the_others() {
        // The reason there are four files and not one.
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());

        store
            .events()
            .save(Event {
                id: "e1".into(),
                title: "Team meeting".into(),
                starts_at: "2026-08-27T10:00:00Z".into(),
                colour: EventColour::Rose,
                alert_minutes_before: Some(30),
            })
            .unwrap();
        store
            .todos()
            .save(Todo {
                id: "t1".into(),
                text: "ship it".into(),
                done: false,
                created_at: "2026-08-27T00:00:00Z".into(),
            })
            .unwrap();

        std::fs::write(store.notes().path(), "corrupted").unwrap();

        assert!(store.notes().list().is_err());
        assert_eq!(store.events().list().unwrap().len(), 1);
        assert_eq!(store.todos().list().unwrap().len(), 1);
    }

    #[test]
    fn an_event_round_trips_with_its_colour_and_alert() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let event = Event {
            id: "e1".into(),
            title: "Project review".into(),
            starts_at: "2026-08-29T09:00:00Z".into(),
            colour: EventColour::Violet,
            alert_minutes_before: Some(60),
        };

        store.events().save(event.clone()).unwrap();
        assert_eq!(store.events().list().unwrap(), vec![event]);
    }

    #[test]
    fn an_event_saved_without_a_colour_still_loads() {
        // Files written by an older build, or edited by hand, must not break
        // the dashboard.
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        std::fs::write(
            store.events().path(),
            r#"[{"id":"e1","title":"Old","starts_at":"2026-08-29T09:00:00Z"}]"#,
        )
        .unwrap();

        let all = store.events().list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].colour, EventColour::default());
        assert_eq!(all[0].alert_minutes_before, None);
    }

    #[test]
    fn colours_serialise_as_plain_lower_case_names() {
        // These names cross into TypeScript and into a file the user can
        // read; "Rose" or a tag object would be an awkward thing to find.
        let json = serde_json::to_string(&EventColour::Rose).unwrap();
        assert_eq!(json, r#""rose""#);
    }

    #[test]
    fn every_colour_is_listed_in_all() {
        // ALL drives the colour picker; a colour missing from it would exist
        // in the data model and be unreachable in the UI.
        for colour in EventColour::ALL {
            let json = serde_json::to_string(&colour).unwrap();
            let back: EventColour = serde_json::from_str(&json).unwrap();
            assert_eq!(back, colour);
        }
        assert_eq!(EventColour::ALL.len(), 6);
    }
}
