//! Writing the app's files so that a crash, a power cut or an older copy of
//! the app can never leave one half-written or silently downgraded.
//!
//! Two things live here, because every store needs both and five of them had
//! grown their own copy of the first while three had none at all.
//!
//! **[`atomic_write`]** writes through a temporary file in the same directory,
//! flushes it to the disk, and renames it over the original. A reader sees the
//! old contents or the new ones, never a mixture.
//!
//! **[`read_document`] / [`write_document`]** give every JSON document a
//! schema number and a path forward. See [`Schema`].

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::Value;

/// The key every versioned document carries at its top level.
pub const SCHEMA_KEY: &str = "schema";

static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, thiserror::Error)]
pub enum PersistError {
    #[error("could not read {path}: {source}")]
    Read { path: String, source: std::io::Error },
    #[error("could not write {path}: {source}")]
    Write { path: String, source: std::io::Error },
    #[error("{path} is not valid JSON: {message}")]
    Parse { path: String, message: String },
    #[error(
        "{path} was written by a newer JKY Terminal (schema {found}; this one understands up to \
         {supported}). It has been left untouched — update JKY Terminal to use it."
    )]
    Newer { path: String, found: u64, supported: u64 },
    #[error("{path} could not be upgraded from schema {from}: {message}")]
    Migrate { path: String, from: u64, message: String },
}

/// Replace `path` with `bytes`, all at once.
///
/// The temporary file is created with `create_new`, so two writers can never
/// share one, and it is flushed with `sync_all` before the rename so the new
/// contents are on the disk before anything points at them. On Unix the
/// directory is flushed afterwards too, which is what makes the rename itself
/// survive a power cut. A failure at any step removes the temporary file and
/// leaves the original exactly as it was.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    std::fs::create_dir_all(parent)?;
    let stem = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    // `create_new` refuses a name that exists, so a collision with another
    // writer — another thread, another process — is a retry, never a share.
    for _ in 0..64 {
        let temp = parent.join(format!(
            ".{stem}-{}-{}.tmp",
            std::process::id(),
            WRITE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        let written = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if let Err(error) = written.and_then(|_| rename_over(&temp, path)) {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        sync_dir(parent);
        return Ok(());
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "could not reserve a temporary file"))
}

/// Rename `from` over `to`, replacing it.
///
/// On Windows a rename onto a file that another process has open for a
/// moment — an antivirus scan, an indexer, a second writer — fails with
/// "access denied" rather than waiting. A few short retries ride that out;
/// anything still failing after them is a real error.
fn rename_over(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    for _ in 0..10 {
        match std::fs::rename(from, to) {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            other => return other,
        }
    }
    std::fs::rename(from, to)
}

/// Flush a directory's entries, so a rename into it survives a power cut.
///
/// Best effort, and Unix only: Windows has no way to open a directory for
/// flushing through the standard library, and NTFS journals the rename itself.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// One step forward: a schema-`n` document in, a schema-`n + 1` document out.
pub type Migration = fn(Value) -> Result<Value, String>;

/// What one kind of document looks like over time.
///
/// `current` is the schema this build writes. `migrations[n]` turns a
/// schema-`n` document into a schema-`n + 1` one, so a document from any
/// earlier build is walked forward one step at a time. Schema 0 means a file
/// from before documents carried a number at all, whatever its shape.
///
/// A document whose schema is **newer** than `current` is refused, for reading
/// and therefore for writing. An older build that read it would drop every
/// field it did not know about on its next save — which is precisely the
/// silent data loss a schema number exists to prevent.
pub struct Schema {
    pub current: u64,
    pub migrations: &'static [Migration],
}

/// Read a versioned JSON document, upgraded to `schema.current`.
///
/// `Ok(None)` when the file does not exist — a first run is not an error. The
/// returned value is always a JSON object, without the schema key.
pub fn read_document(path: &Path, schema: &Schema) -> Result<Option<Value>, PersistError> {
    assert_eq!(
        schema.migrations.len() as u64,
        schema.current,
        "a schema needs exactly one migration per schema step"
    );
    let shown = path.display().to_string();
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(PersistError::Read { path: shown, source }),
    };
    let mut value: Value = serde_json::from_str(&raw)
        .map_err(|e| PersistError::Parse { path: shown.clone(), message: e.to_string() })?;

    let found = match value.as_object_mut().and_then(|o| o.remove(SCHEMA_KEY)) {
        None => 0,
        Some(n) => n.as_u64().ok_or_else(|| PersistError::Parse {
            path: shown.clone(),
            message: format!("`{SCHEMA_KEY}` must be a whole number"),
        })?,
    };
    if found > schema.current {
        return Err(PersistError::Newer { path: shown, found, supported: schema.current });
    }
    for step in found..schema.current {
        value = (schema.migrations[step as usize])(value)
            .map_err(|message| PersistError::Migrate { path: shown.clone(), from: step, message })?;
    }
    if !value.is_object() {
        return Err(PersistError::Migrate {
            path: shown,
            from: schema.current,
            message: "the document is not a JSON object".into(),
        });
    }
    Ok(Some(value))
}

/// Write `value` as a versioned JSON document, atomically.
///
/// `value` must serialise to a JSON object; the schema number is added as its
/// first key so a person opening the file sees it immediately.
pub fn write_document<T: Serialize>(path: &Path, schema: &Schema, value: &T) -> Result<(), PersistError> {
    let shown = path.display().to_string();
    let invalid = |message: String| PersistError::Write {
        path: shown.clone(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, message),
    };
    let mut object = match serde_json::to_value(value).map_err(|e| invalid(e.to_string()))? {
        Value::Object(map) => map,
        _ => return Err(invalid("a document must be a JSON object".into())),
    };
    object.remove(SCHEMA_KEY);

    // Put the schema first by hand: serde_json's map orders keys
    // alphabetically, and a person opening the file should see the version
    // before anything else.
    let body = serde_json::to_string_pretty(&Value::Object(object)).map_err(|e| invalid(e.to_string()))?;
    let text = match body.strip_prefix("{\n") {
        Some(rest) => format!("{{\n  \"{SCHEMA_KEY}\": {},\n{rest}\n", schema.current),
        None => format!("{{\n  \"{SCHEMA_KEY}\": {}\n}}\n", schema.current),
    };
    atomic_write(path, text.as_bytes()).map_err(|source| PersistError::Write { path: shown, source })
}

/// Wrap an unversioned top-level array as `{ key: [...] }`.
///
/// The usual first migration for a file that used to be a bare list: a list
/// has nowhere to keep a schema number. Anything other than a list is refused
/// — an unnumbered file of a list document was always a list, so an object
/// there is damage, and reading it as empty would overwrite it on next save.
pub fn wrap_array(key: &str, value: Value) -> Result<Value, String> {
    match value {
        Value::Array(items) => {
            let mut map = serde_json::Map::new();
            map.insert(key.to_string(), Value::Array(items));
            Ok(Value::Object(map))
        }
        _ => Err("expected a list".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use tempfile::TempDir;

    fn temp_files(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    // ---- atomic_write ------------------------------------------------------

    #[test]
    fn writes_a_new_file() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("a.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn replaces_an_existing_file_and_leaves_no_temporary_behind() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("a.json");
        std::fs::write(&path, b"old contents that are longer").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(temp_files(d.path()).is_empty(), "leaked: {:?}", temp_files(d.path()));
    }

    #[test]
    fn creates_missing_parent_directories() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("deep/er/a.json");
        atomic_write(&path, b"x").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"x");
    }

    #[test]
    fn a_failed_write_leaves_the_original_untouched() {
        let d = TempDir::new().unwrap();
        // The target is a directory, so the final rename cannot succeed.
        let path = d.path().join("taken");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside"), b"keep").unwrap();
        assert!(atomic_write(&path, b"x").is_err());
        assert_eq!(std::fs::read(path.join("inside")).unwrap(), b"keep");
        assert!(temp_files(d.path()).is_empty(), "leaked: {:?}", temp_files(d.path()));
    }

    #[test]
    fn concurrent_writers_never_produce_a_mixture() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("a.json");
        let a = vec![b'a'; 64 * 1024];
        let b = vec![b'b'; 64 * 1024];
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| atomic_write(&path, &a).unwrap());
                s.spawn(|| atomic_write(&path, &b).unwrap());
            }
        });
        let got = std::fs::read(&path).unwrap();
        assert!(got == a || got == b, "a torn write reached the disk");
        assert!(temp_files(d.path()).is_empty());
    }

    // ---- documents ---------------------------------------------------------

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Prefs {
        name: String,
        #[serde(default)]
        size: u32,
    }

    fn to_v1(v: Value) -> Result<Value, String> {
        wrap_array("items", v)
    }
    fn to_v2(mut v: Value) -> Result<Value, String> {
        // v2 renamed `items` to `entries`.
        let obj = v.as_object_mut().ok_or("not an object")?;
        let items = obj.remove("items").unwrap_or(Value::Array(vec![]));
        obj.insert("entries".into(), items);
        Ok(v)
    }

    const PREFS: Schema = Schema { current: 1, migrations: &[|v| Ok(v)] };
    const LIST: Schema = Schema { current: 2, migrations: &[to_v1, to_v2] };

    #[test]
    fn a_missing_document_is_none_rather_than_an_error() {
        let d = TempDir::new().unwrap();
        assert!(read_document(&d.path().join("nope.json"), &PREFS).unwrap().is_none());
    }

    #[test]
    fn a_written_document_carries_its_schema_and_reads_back() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("prefs.json");
        let prefs = Prefs { name: "jky".into(), size: 13 };
        write_document(&path, &PREFS, &prefs).unwrap();

        let raw: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw[SCHEMA_KEY], 1);

        let back = read_document(&path, &PREFS).unwrap().unwrap();
        assert!(back.get(SCHEMA_KEY).is_none(), "the schema key leaked into the data");
        assert_eq!(serde_json::from_value::<Prefs>(back).unwrap(), prefs);
    }

    #[test]
    fn the_schema_is_the_first_key_a_person_sees() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("prefs.json");
        write_document(&path, &PREFS, &Prefs { name: "a".into(), size: 1 }).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let first_key = text.trim_start_matches(['{', '\n', ' ']).split(':').next().unwrap();
        assert_eq!(first_key, "\"schema\"");
    }

    #[test]
    fn an_unversioned_object_is_schema_zero_and_is_migrated() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("prefs.json");
        std::fs::write(&path, r#"{"name":"legacy"}"#).unwrap();
        let back = read_document(&path, &PREFS).unwrap().unwrap();
        assert_eq!(serde_json::from_value::<Prefs>(back).unwrap(), Prefs { name: "legacy".into(), size: 0 });
    }

    #[test]
    fn a_legacy_bare_array_walks_forward_through_every_migration() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("list.json");
        std::fs::write(&path, r#"[1, 2, 3]"#).unwrap();
        let back = read_document(&path, &LIST).unwrap().unwrap();
        assert_eq!(back, serde_json::json!({ "entries": [1, 2, 3] }));
    }

    #[test]
    fn a_middle_version_runs_only_the_migrations_after_it() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("list.json");
        std::fs::write(&path, r#"{"schema": 1, "items": ["x"]}"#).unwrap();
        let back = read_document(&path, &LIST).unwrap().unwrap();
        assert_eq!(back, serde_json::json!({ "entries": ["x"] }));
    }

    #[test]
    fn reading_does_not_rewrite_the_file() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("list.json");
        std::fs::write(&path, r#"[1]"#).unwrap();
        read_document(&path, &LIST).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[1]");
    }

    #[test]
    fn a_document_from_a_newer_build_is_refused_and_left_alone() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("prefs.json");
        let newer = r#"{"schema": 9, "name": "future", "a_field_we_do_not_know": true}"#;
        std::fs::write(&path, newer).unwrap();
        let err = read_document(&path, &PREFS).unwrap_err();
        assert!(matches!(err, PersistError::Newer { found: 9, supported: 1, .. }), "{err}");
        assert!(err.to_string().contains("newer JKY Terminal"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), newer);
    }

    #[test]
    fn invalid_json_is_a_parse_error_naming_the_file() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("prefs.json");
        std::fs::write(&path, "{ not json").unwrap();
        let err = read_document(&path, &PREFS).unwrap_err();
        assert!(matches!(err, PersistError::Parse { .. }));
        assert!(err.to_string().contains("prefs.json"));
    }

    #[test]
    fn a_failing_migration_names_the_step() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("list.json");
        std::fs::write(&path, r#""a string is neither""#).unwrap();
        let err = read_document(&path, &LIST).unwrap_err();
        assert!(matches!(err, PersistError::Migrate { from: 0, .. }), "{err}");
    }

    #[test]
    fn a_non_object_value_cannot_be_written_as_a_document() {
        let d = TempDir::new().unwrap();
        let err = write_document(&d.path().join("x.json"), &PREFS, &vec![1, 2]).unwrap_err();
        assert!(matches!(err, PersistError::Write { .. }));
        assert!(!d.path().join("x.json").exists());
    }

    #[test]
    #[should_panic(expected = "one migration per schema step")]
    fn a_schema_must_have_one_migration_per_step() {
        let d = TempDir::new().unwrap();
        let broken = Schema { current: 3, migrations: &[to_v1] };
        let _ = read_document(&d.path().join("x.json"), &broken);
    }

    #[test]
    fn wrap_array_wraps_arrays_and_passes_objects_through() {
        assert_eq!(wrap_array("k", serde_json::json!([1])).unwrap(), serde_json::json!({ "k": [1] }));
        // Schema 0 of a list document was always a list. Anything else is a
        // file somebody broke by hand, and reading it as empty would lose it.
        assert!(wrap_array("k", serde_json::json!({ "k": [] })).is_err());
        assert!(wrap_array("k", serde_json::json!(5)).is_err());
    }
}
