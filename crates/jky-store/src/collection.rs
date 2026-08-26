//! A JSON array on disk, treated as a collection of records.
//!
//! Notes, todos, events and reminders all need the same six operations, so
//! they share one implementation that is tested once. Four hand-written
//! copies would be four places for the atomic-write logic to drift.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::model::Identified;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("could not read {path}: {source}")]
    Read { path: String, source: std::io::Error },

    #[error("could not write {path}: {source}")]
    Write { path: String, source: std::io::Error },

    /// Deliberately an error and not an empty collection.
    ///
    /// Silently replacing unreadable data with `[]` is how a person loses
    /// everything they saved and is told nothing about it. A corrupt file is
    /// still on disk and can still be recovered by hand; an overwritten one
    /// cannot.
    #[error("{path} is not valid JSON: {message}")]
    Corrupt { path: String, message: String },
}

pub struct Collection<T> {
    path: PathBuf,
    _marker: std::marker::PhantomData<T>,
}

impl<T> Collection<T>
where
    T: Serialize + DeserializeOwned + Identified,
{
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf(), _marker: std::marker::PhantomData }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every record, in the order it was saved.
    ///
    /// A missing file is an empty collection: a first run is not a failure.
    pub fn list(&self) -> Result<Vec<T>, StoreError> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => {
                return Err(StoreError::Read { path: self.display(), source });
            }
        };

        serde_json::from_str(&raw)
            .map_err(|e| StoreError::Corrupt { path: self.display(), message: e.to_string() })
    }

    /// Insert a record, or replace the one that already has its id.
    ///
    /// One operation rather than separate create and update, so the frontend
    /// can send a whole record without first asking whether it exists.
    pub fn save(&self, record: T) -> Result<Vec<T>, StoreError> {
        let mut all = self.list()?;
        match all.iter().position(|r| r.id() == record.id()) {
            Some(i) => all[i] = record,
            None => all.push(record),
        }
        self.write(&all)?;
        Ok(all)
    }

    /// Remove the record with this id. Removing what is not there is not an
    /// error: the caller asked for it to be gone, and it is gone.
    pub fn remove(&self, id: &str) -> Result<Vec<T>, StoreError> {
        let mut all = self.list()?;
        all.retain(|r| r.id() != id);
        self.write(&all)?;
        Ok(all)
    }

    /// Write the whole collection.
    ///
    /// Through a temporary file in the same directory, renamed into place, so
    /// a crash or a power cut leaves the previous contents rather than a
    /// half-written file. Same directory because rename is only atomic within
    /// a filesystem.
    fn write(&self, all: &[T]) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|source| StoreError::Write { path: self.display(), source })?;
        }

        let json = serde_json::to_string_pretty(all).map_err(|e| StoreError::Write {
            path: self.display(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, e),
        })?;

        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, json)
            .map_err(|source| StoreError::Write { path: self.display(), source })?;
        std::fs::rename(&tmp, &self.path)
            .map_err(|source| StoreError::Write { path: self.display(), source })
    }

    fn display(&self) -> String {
        self.path.display().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Note, Todo};

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            body: String::new(),
            created_at: "2026-08-27T00:00:00Z".to_string(),
            updated_at: "2026-08-27T00:00:00Z".to_string(),
        }
    }

    fn temp() -> (tempfile::TempDir, Collection<Note>) {
        let dir = tempfile::tempdir().unwrap();
        let c = Collection::new(dir.path().join("notes.json"));
        (dir, c)
    }

    #[test]
    fn a_missing_file_is_an_empty_collection() {
        // First run is not a failure.
        let (_d, c) = temp();
        assert_eq!(c.list().unwrap(), Vec::<Note>::new());
    }

    #[test]
    fn a_saved_record_comes_back() {
        let (_d, c) = temp();
        c.save(note("n1", "Plan")).unwrap();
        assert_eq!(c.list().unwrap(), vec![note("n1", "Plan")]);
    }

    #[test]
    fn records_keep_the_order_they_were_saved_in() {
        let (_d, c) = temp();
        c.save(note("n1", "one")).unwrap();
        c.save(note("n2", "two")).unwrap();
        c.save(note("n3", "three")).unwrap();

        let ids: Vec<_> = c.list().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["n1", "n2", "n3"]);
    }

    #[test]
    fn saving_a_known_id_replaces_rather_than_duplicates() {
        let (_d, c) = temp();
        c.save(note("n1", "before")).unwrap();
        c.save(note("n1", "after")).unwrap();

        let all = c.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "after");
    }

    #[test]
    fn replacing_a_record_leaves_it_where_it_was() {
        // Editing a note must not shuffle it to the bottom of the list.
        let (_d, c) = temp();
        c.save(note("n1", "one")).unwrap();
        c.save(note("n2", "two")).unwrap();
        c.save(note("n1", "edited")).unwrap();

        let ids: Vec<_> = c.list().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["n1", "n2"]);
    }

    #[test]
    fn remove_takes_exactly_one_record() {
        let (_d, c) = temp();
        c.save(note("n1", "one")).unwrap();
        c.save(note("n2", "two")).unwrap();
        c.remove("n1").unwrap();

        let ids: Vec<_> = c.list().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["n2"]);
    }

    #[test]
    fn removing_what_is_not_there_is_not_an_error() {
        let (_d, c) = temp();
        c.save(note("n1", "one")).unwrap();
        assert!(c.remove("nope").is_ok());
        assert_eq!(c.list().unwrap().len(), 1);
    }

    #[test]
    fn nothing_is_ever_dropped_for_age_or_count() {
        // The whole point of this subsystem: no cap, no expiry, no tidy-up.
        // A note written in March is not less yours in August.
        let (_d, c) = temp();
        for i in 0..500 {
            c.save(note(&format!("n{i}"), "keep")).unwrap();
        }
        assert_eq!(c.list().unwrap().len(), 500);
    }

    #[test]
    fn a_corrupt_file_is_reported_not_silently_emptied() {
        // Replacing unreadable data with [] loses everything and says nothing.
        // The bad file stays on disk where it can still be recovered by hand.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.json");
        std::fs::write(&path, "{ this is not an array").unwrap();

        let c: Collection<Note> = Collection::new(&path);
        assert!(matches!(c.list(), Err(StoreError::Corrupt { .. })));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ this is not an array");
    }

    #[test]
    fn a_write_leaves_no_temporary_file_behind() {
        let (dir, c) = temp();
        c.save(note("n1", "one")).unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }

    #[test]
    fn a_failed_write_leaves_the_previous_contents_intact() {
        // Blocking the temporary path is the only way to make a write fail on
        // demand, and it pins the mechanism at the same time: an
        // implementation that wrote straight to the destination would
        // truncate the file first and lose what was there before it
        // discovered it could not finish. That is the whole reason for the
        // rename.
        let (_dir, c) = temp();
        c.save(note("n1", "keep me")).unwrap();

        std::fs::create_dir(c.path().with_extension("tmp")).unwrap();

        assert!(c.save(note("n2", "cannot be written")).is_err());

        let all = c.list().unwrap();
        assert_eq!(all.len(), 1, "the earlier record was lost");
        assert_eq!(all[0].title, "keep me");
    }

    #[test]
    fn the_parent_directory_is_created_on_first_write() {
        // The app data directory may not exist before the first save.
        let dir = tempfile::tempdir().unwrap();
        let c: Collection<Note> = Collection::new(dir.path().join("deep/er/notes.json"));
        c.save(note("n1", "one")).unwrap();
        assert_eq!(c.list().unwrap().len(), 1);
    }

    #[test]
    fn the_file_is_readable_by_a_person() {
        // The store is the user's data. `cat notes.json` should be usable.
        let (_d, c) = temp();
        c.save(note("n1", "Plan")).unwrap();
        let raw = std::fs::read_to_string(c.path()).unwrap();
        assert!(raw.contains('\n'), "written as one line: {raw}");
    }

    #[test]
    fn collections_of_different_types_do_not_interfere() {
        let dir = tempfile::tempdir().unwrap();
        let notes: Collection<Note> = Collection::new(dir.path().join("notes.json"));
        let todos: Collection<Todo> = Collection::new(dir.path().join("todos.json"));

        notes.save(note("n1", "one")).unwrap();
        todos
            .save(Todo {
                id: "t1".into(),
                text: "do it".into(),
                done: false,
                created_at: "2026-08-27T00:00:00Z".into(),
            })
            .unwrap();

        assert_eq!(notes.list().unwrap().len(), 1);
        assert_eq!(todos.list().unwrap().len(), 1);
    }
}
