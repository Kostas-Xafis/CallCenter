//! Files next to the exe (see docs/CONTRACT.md): catalog.json, admin.json
//! and backup/. Everything here is plain std I/O so it can be unit-tested
//! against a temp directory.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde_json::{json, Value};

/// Errors are user-facing Greek strings, except these two markers.
pub const CONFLICT: &str = "conflict";
pub const NOT_ADMIN: &str = "not-admin";

const BACKUPS_KEPT: usize = 30;

pub struct Store {
    pub dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Store { dir: dir.into() }
    }

    fn catalog_path(&self) -> PathBuf {
        self.dir.join("catalog.json")
    }

    fn admin_path(&self) -> PathBuf {
        self.dir.join("admin.json")
    }

    fn backup_dir(&self) -> PathBuf {
        self.dir.join("backup")
    }

    // ── Catalog ──────────────────────────────────────────────────────

    /// The catalog, or an empty schema-3 catalog when the file does not exist yet.
    pub fn load(&self) -> Result<Value, String> {
        match fs::read_to_string(self.catalog_path()) {
            Ok(text) => {
                let catalog: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
                    .map_err(|e| format!("Το catalog.json δεν είναι έγκυρο: {e}"))?;
                if !catalog.is_object() {
                    return Err("Το catalog.json δεν είναι έγκυρο.".into());
                }
                Ok(catalog)
            }
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(empty_catalog()),
            Err(e) => Err(format!("Δεν ήταν δυνατή η ανάγνωση του catalog.json: {e}")),
        }
    }

    /// `updatedAt` of the file on disk (null if missing or never saved).
    pub fn version(&self) -> Result<Option<String>, String> {
        Ok(version_of(&self.load()?))
    }

    /// Saves `catalog` if the file is still at `base_version`; returns the new version.
    pub fn save(&self, mut catalog: Value, base_version: Option<String>) -> Result<String, String> {
        let Some(obj) = catalog.as_object_mut() else {
            return Err("Μη έγκυρα δεδομένα καταλόγου.".into());
        };
        let current = self.version()?;
        if current != base_version {
            return Err(CONFLICT.into());
        }

        let mut version = now_iso();
        if Some(&version) == current.as_ref() {
            // Same millisecond as the previous save: still give a new version.
            sleep(Duration::from_millis(2));
            version = now_iso();
        }
        obj.insert("schema".into(), json!(3));
        obj.insert("updatedAt".into(), json!(version));

        self.backup_current()?;
        write_replace(&self.catalog_path(), &to_pretty(&catalog))
            .map_err(|e| format!("Δεν ήταν δυνατή η αποθήκευση του καταλόγου: {e}"))?;
        Ok(version)
    }

    /// Copies the current catalog.json into backup/ and prunes to the newest 30.
    fn backup_current(&self) -> Result<(), String> {
        let src = self.catalog_path();
        if !src.exists() {
            return Ok(());
        }
        let err = |e: std::io::Error| format!("Δεν ήταν δυνατή η δημιουργία αντιγράφου ασφαλείας: {e}");
        let dir = self.backup_dir();
        fs::create_dir_all(&dir).map_err(err)?;

        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let mut dest = dir.join(format!("catalog-{stamp}.json"));
        let mut n = 2;
        while dest.exists() {
            dest = dir.join(format!("catalog-{stamp}-{n}.json"));
            n += 1;
        }
        fs::copy(&src, &dest).map_err(err)?;

        // Names sort chronologically, so the oldest come first.
        let mut backups: Vec<PathBuf> = fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                name.starts_with("catalog-") && name.ends_with(".json")
            })
            .collect();
        backups.sort();
        if backups.len() > BACKUPS_KEPT {
            for old in &backups[..backups.len() - BACKUPS_KEPT] {
                let _ = fs::remove_file(old);
            }
        }
        Ok(())
    }

    // ── Admin password ───────────────────────────────────────────────

    pub fn has_password(&self) -> bool {
        self.admin_path().exists()
    }

    /// Creates admin.json; refuses if one already exists.
    pub fn set_password(&self, password: &str) -> Result<(), String> {
        check_new_password(password)?;
        let body = admin_json(password)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.admin_path())
            .map_err(|e| match e.kind() {
                ErrorKind::AlreadyExists => "Έχει ήδη οριστεί κωδικός διαχειριστή.".to_string(),
                _ => format!("Δεν ήταν δυνατή η αποθήκευση του κωδικού: {e}"),
            })?;
        file.write_all(body.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Δεν ήταν δυνατή η αποθήκευση του κωδικού: {e}"))
    }

    /// True if `password` matches admin.json (false if there is none).
    pub fn verify_password(&self, password: &str) -> Result<bool, String> {
        let text = match fs::read_to_string(self.admin_path()) {
            Ok(t) => t,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("Δεν ήταν δυνατή η ανάγνωση του admin.json: {e}")),
        };
        let bad = || "Το admin.json δεν είναι έγκυρο. Διαγράψτε το για να ορίσετε νέο κωδικό.".to_string();
        let admin: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| bad())?;
        let phc = admin["hash"].as_str().ok_or_else(bad)?;
        let hash = PasswordHash::new(phc).map_err(|_| bad())?;
        Ok(Argon2::default().verify_password(password.as_bytes(), &hash).is_ok())
    }

    /// Replaces the password if `old` is correct; false otherwise.
    pub fn change_password(&self, old: &str, new: &str) -> Result<bool, String> {
        if !self.verify_password(old)? {
            return Ok(false);
        }
        check_new_password(new)?;
        write_replace(&self.admin_path(), &admin_json(new)?)
            .map_err(|e| format!("Δεν ήταν δυνατή η αποθήκευση του κωδικού: {e}"))?;
        Ok(true)
    }
}

pub fn empty_catalog() -> Value {
    json!({ "schema": 3, "updatedAt": null, "title": null, "info": [], "sections": [], "phones": [] })
}

pub fn version_of(catalog: &Value) -> Option<String> {
    catalog["updatedAt"].as_str().map(str::to_owned)
}

/// ISO-8601 UTC with milliseconds, like JavaScript's `toISOString()`.
fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn check_new_password(password: &str) -> Result<(), String> {
    if password.trim().is_empty() {
        return Err("Ο κωδικός δεν μπορεί να είναι κενός.".into());
    }
    Ok(())
}

fn admin_json(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Σφάλμα κρυπτογράφησης κωδικού: {e}"))?;
    Ok(to_pretty(&json!({ "hash": hash.to_string() })))
}

/// Tab-indented JSON with a trailing newline (same style as the existing files).
fn to_pretty(value: &Value) -> String {
    let mut out = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(b"\t");
    let mut ser = serde_json::Serializer::with_formatter(&mut out, fmt);
    serde::Serialize::serialize(value, &mut ser).expect("serializing a Value cannot fail");
    out.push(b'\n');
    String::from_utf8(out).expect("serde_json writes UTF-8")
}

/// Writes `<path>.tmp`, then renames it over `path`. `std::fs::rename`
/// replaces an existing target on Windows too (MoveFileEx with
/// REPLACE_EXISTING semantics), which also works on SMB shares. A few retries
/// cover the target being briefly held open by another PC or an antivirus.
fn write_replace(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    let mut attempt = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 5 => {
                attempt += 1;
                sleep(Duration::from_millis(100 * attempt));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        (dir, store)
    }

    fn backups(store: &Store) -> usize {
        fs::read_dir(store.backup_dir()).map(|d| d.count()).unwrap_or(0)
    }

    #[test]
    fn missing_catalog_is_empty() {
        let (_d, s) = store();
        let c = s.load().unwrap();
        assert_eq!(c["schema"], 3);
        assert!(c["updatedAt"].is_null());
        assert_eq!(s.version().unwrap(), None);
    }

    #[test]
    fn save_sets_version_and_checks_conflicts() {
        let (_d, s) = store();
        let v1 = s.save(json!({ "phones": [1] }), None).unwrap();
        assert_eq!(v1.len(), 24, "ISO with millis: {v1}");
        assert!(v1.ends_with('Z'));
        assert_eq!(s.version().unwrap().as_deref(), Some(v1.as_str()));
        assert_eq!(s.load().unwrap()["phones"], json!([1]));
        assert_eq!(backups(&s), 0, "nothing to back up on the first save");

        // Stale base version → conflict, file unchanged.
        assert_eq!(s.save(json!({ "phones": [9] }), None).unwrap_err(), CONFLICT);
        assert_eq!(s.save(json!({}), Some("2000-01-01T00:00:00.000Z".into())).unwrap_err(), CONFLICT);
        assert_eq!(s.load().unwrap()["phones"], json!([1]));

        let v2 = s.save(json!({ "phones": [2] }), Some(v1.clone())).unwrap();
        assert_ne!(v1, v2);
        assert_eq!(s.load().unwrap()["phones"], json!([2]));
        assert_eq!(backups(&s), 1);
        assert!(!s.dir.join("catalog.json.tmp").exists());
    }

    #[test]
    fn keeps_last_30_backups() {
        let (_d, s) = store();
        let mut v = s.save(json!({}), None).unwrap();
        for _ in 0..35 {
            v = s.save(json!({}), Some(v)).unwrap();
        }
        assert_eq!(backups(&s), BACKUPS_KEPT);
    }

    #[test]
    fn password_lifecycle() {
        let (_d, s) = store();
        assert!(!s.has_password());
        assert!(!s.verify_password("x").unwrap());
        assert!(s.set_password("  ").is_err());

        s.set_password("σωστός").unwrap();
        assert!(s.has_password());
        let stored = fs::read_to_string(s.admin_path()).unwrap();
        assert!(stored.contains("$argon2id$"), "PHC string: {stored}");
        assert!(s.set_password("other").is_err(), "only when none exists");

        assert!(s.verify_password("σωστός").unwrap());
        assert!(!s.verify_password("λάθος").unwrap());

        assert!(!s.change_password("λάθος", "νέος").unwrap());
        assert!(s.change_password("σωστός", "νέος").unwrap());
        assert!(s.verify_password("νέος").unwrap());
        assert!(!s.verify_password("σωστός").unwrap());
    }
}
