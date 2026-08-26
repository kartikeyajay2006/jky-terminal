//! The dashboard's collections, over IPC.
//!
//! Three commands per collection. `save` covers both create and update: the
//! frontend sends a whole record and an id the store has not seen is an
//! insert, so the renderer never has to ask "does this exist yet".
//!
//! Every mutation returns the whole collection. The frontend then cannot
//! drift out of step with what is on disk, and a save followed by a stale
//! render is not a state we have to reason about.

use jky_store::{Collection, Event, Identified, Note, Reminder, Todo};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

// --- validation, unit-testable without Tauri --------------------------------

/// What a record must satisfy before it reaches the disk.
///
/// The renderer is not trusted to have checked. It is the same process
/// boundary the vault commands sit on, and a blank-titled note or an event at
/// "tomorrow-ish" is a bug the user has to clean up by hand later.
pub(crate) fn check_note(note: &Note) -> Result<Note, String> {
    let title = note.title.trim();
    Ok(Note {
        id: require_id(&note.id)?,
        // A note with no name still has to be findable in a list, so it gets
        // one rather than being refused mid-thought.
        title: if title.is_empty() { "Untitled".to_string() } else { title.to_string() },
        body: note.body.clone(),
        created_at: note.created_at.clone(),
        updated_at: note.updated_at.clone(),
    })
}

pub(crate) fn check_todo(todo: &Todo) -> Result<Todo, String> {
    let text = todo.text.trim();
    if text.is_empty() {
        return Err("a todo needs some text".to_string());
    }
    Ok(Todo {
        id: require_id(&todo.id)?,
        text: text.to_string(),
        done: todo.done,
        created_at: todo.created_at.clone(),
    })
}

pub(crate) fn check_event(event: &Event) -> Result<Event, String> {
    let title = event.title.trim();
    if title.is_empty() {
        return Err("an event needs a title".to_string());
    }
    if !is_rfc3339_utc(&event.starts_at) {
        return Err(format!(
            "'{}' is not a UTC timestamp like 2026-08-27T09:00:00Z",
            event.starts_at
        ));
    }
    Ok(Event {
        id: require_id(&event.id)?,
        title: title.to_string(),
        starts_at: event.starts_at.clone(),
        colour: event.colour,
        alert_minutes_before: event.alert_minutes_before,
    })
}

pub(crate) fn check_reminder(reminder: &Reminder) -> Result<Reminder, String> {
    let text = reminder.text.trim();
    if text.is_empty() {
        return Err("a reminder needs some text".to_string());
    }
    if !is_hh_mm(&reminder.at) {
        return Err(format!("'{}' is not a time like 07:00", reminder.at));
    }
    Ok(Reminder {
        id: require_id(&reminder.id)?,
        text: text.to_string(),
        at: reminder.at.clone(),
        done: reminder.done,
    })
}

fn require_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("a record needs an id".to_string());
    }
    Ok(id.to_string())
}

/// `2026-08-27T09:00:00Z`, and nothing looser.
///
/// Checked by shape rather than by a date crate: the point is to reject a
/// local time or a free-text date before it reaches the file, not to
/// re-implement a calendar.
fn is_rfc3339_utc(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20 {
        return false;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    let marks: [(usize, u8); 6] =
        [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':'), (19, b'Z')];

    digits.iter().all(|&i| b[i].is_ascii_digit()) && marks.iter().all(|&(i, c)| b[i] == c)
}

/// `07:00`, on a 24-hour clock.
fn is_hh_mm(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return false;
    }
    if !(b[0].is_ascii_digit() && b[1].is_ascii_digit() && b[3].is_ascii_digit() && b[4].is_ascii_digit())
    {
        return false;
    }
    let hh = value[0..2].parse::<u32>().unwrap_or(99);
    let mm = value[3..5].parse::<u32>().unwrap_or(99);
    hh < 24 && mm < 60
}

// --- IPC surface ------------------------------------------------------------

// Written out one by one, deliberately.
//
// A macro would fold these into three declarations, and the security test
// that pins the IPC surface reads this file as source: it would see `$list`
// and `$save` and be blind to the twelve commands actually exposed. A guard
// that cannot see what it is guarding is not a guard, so the repetition here
// buys something real. The bodies delegate to the generic helpers above it,
// so there is no logic to keep in step.

fn list_of<T>(c: Collection<T>) -> Result<Vec<T>, String>
where
    T: Serialize + DeserializeOwned + Identified,
{
    c.list().map_err(|e| e.to_string())
}

fn save_into<T>(c: Collection<T>, record: T) -> Result<Vec<T>, String>
where
    T: Serialize + DeserializeOwned + Identified,
{
    c.save(record).map_err(|e| e.to_string())
}

fn delete_from<T>(c: Collection<T>, id: &str) -> Result<Vec<T>, String>
where
    T: Serialize + DeserializeOwned + Identified,
{
    c.remove(id).map_err(|e| e.to_string())
}

// --- notes ------------------------------------------------------------------

#[tauri::command]
pub fn store_list_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    list_of(state.store.notes())
}

#[tauri::command]
pub fn store_save_note(state: State<'_, AppState>, record: Note) -> Result<Vec<Note>, String> {
    save_into(state.store.notes(), check_note(&record)?)
}

#[tauri::command]
pub fn store_delete_note(state: State<'_, AppState>, id: String) -> Result<Vec<Note>, String> {
    delete_from(state.store.notes(), &id)
}

// --- todos ------------------------------------------------------------------

#[tauri::command]
pub fn store_list_todos(state: State<'_, AppState>) -> Result<Vec<Todo>, String> {
    list_of(state.store.todos())
}

#[tauri::command]
pub fn store_save_todo(state: State<'_, AppState>, record: Todo) -> Result<Vec<Todo>, String> {
    save_into(state.store.todos(), check_todo(&record)?)
}

#[tauri::command]
pub fn store_delete_todo(state: State<'_, AppState>, id: String) -> Result<Vec<Todo>, String> {
    delete_from(state.store.todos(), &id)
}

// --- events -----------------------------------------------------------------

#[tauri::command]
pub fn store_list_events(state: State<'_, AppState>) -> Result<Vec<Event>, String> {
    list_of(state.store.events())
}

#[tauri::command]
pub fn store_save_event(state: State<'_, AppState>, record: Event) -> Result<Vec<Event>, String> {
    save_into(state.store.events(), check_event(&record)?)
}

#[tauri::command]
pub fn store_delete_event(state: State<'_, AppState>, id: String) -> Result<Vec<Event>, String> {
    delete_from(state.store.events(), &id)
}

// --- reminders --------------------------------------------------------------

#[tauri::command]
pub fn store_list_reminders(state: State<'_, AppState>) -> Result<Vec<Reminder>, String> {
    list_of(state.store.reminders())
}

#[tauri::command]
pub fn store_save_reminder(
    state: State<'_, AppState>,
    record: Reminder,
) -> Result<Vec<Reminder>, String> {
    save_into(state.store.reminders(), check_reminder(&record)?)
}

#[tauri::command]
pub fn store_delete_reminder(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<Reminder>, String> {
    delete_from(state.store.reminders(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jky_store::EventColour;

    fn note(title: &str) -> Note {
        Note {
            id: "n1".into(),
            title: title.into(),
            body: "body".into(),
            created_at: "2026-08-27T00:00:00Z".into(),
            updated_at: "2026-08-27T00:00:00Z".into(),
        }
    }

    fn event(title: &str, starts_at: &str) -> Event {
        Event {
            id: "e1".into(),
            title: title.into(),
            starts_at: starts_at.into(),
            colour: EventColour::Rose,
            alert_minutes_before: Some(30),
        }
    }

    fn reminder(text: &str, at: &str) -> Reminder {
        Reminder { id: "r1".into(), text: text.into(), at: at.into(), done: false }
    }

    #[test]
    fn a_note_with_no_title_is_named_rather_than_refused() {
        // Refusing mid-thought would lose what the person was writing.
        assert_eq!(check_note(&note("   ")).unwrap().title, "Untitled");
    }

    #[test]
    fn a_title_is_trimmed() {
        assert_eq!(check_note(&note("  Plan  ")).unwrap().title, "Plan");
    }

    #[test]
    fn a_record_without_an_id_is_refused() {
        let mut n = note("Plan");
        n.id = "  ".into();
        assert!(check_note(&n).is_err());
    }

    #[test]
    fn an_empty_todo_is_refused() {
        let t = Todo {
            id: "t1".into(),
            text: "  ".into(),
            done: false,
            created_at: "2026-08-27T00:00:00Z".into(),
        };
        assert!(check_todo(&t).is_err());
    }

    #[test]
    fn an_untitled_event_is_refused() {
        // Unlike a note, an untitled event in a calendar grid is a coloured
        // dot that means nothing.
        assert!(check_event(&event("  ", "2026-08-27T09:00:00Z")).is_err());
    }

    #[test]
    fn an_event_keeps_a_real_utc_timestamp() {
        let checked = check_event(&event("Review", "2026-08-27T09:00:00Z")).unwrap();
        assert_eq!(checked.starts_at, "2026-08-27T09:00:00Z");
    }

    #[test]
    fn an_event_time_that_is_not_utc_is_refused() {
        // A local time on disk makes a laptop that crosses a timezone start
        // lying about when things happen.
        for bad in [
            "2026-08-27T09:00:00",
            "2026-08-27 09:00:00Z",
            "2026-08-27T09:00:00+05:30",
            "tomorrow",
            "",
            "2026-8-27T09:00:00Z",
        ] {
            assert!(check_event(&event("Review", bad)).is_err(), "accepted '{bad}'");
        }
    }

    #[test]
    fn an_events_colour_and_alert_survive_validation() {
        let checked = check_event(&event("Review", "2026-08-27T09:00:00Z")).unwrap();
        assert_eq!(checked.colour, EventColour::Rose);
        assert_eq!(checked.alert_minutes_before, Some(30));
    }

    #[test]
    fn a_reminder_takes_a_wall_clock_time() {
        assert_eq!(check_reminder(&reminder("Exercise", "07:00")).unwrap().at, "07:00");
        assert!(check_reminder(&reminder("Sleep", "23:59")).is_ok());
        assert!(check_reminder(&reminder("Midnight", "00:00")).is_ok());
    }

    #[test]
    fn a_reminder_time_that_is_not_a_time_is_refused() {
        for bad in ["7:00", "07:60", "24:00", "morning", "07:00:00", ""] {
            assert!(check_reminder(&reminder("Exercise", bad)).is_err(), "accepted '{bad}'");
        }
    }

    #[test]
    fn an_empty_reminder_is_refused() {
        assert!(check_reminder(&reminder("   ", "07:00")).is_err());
    }
}
