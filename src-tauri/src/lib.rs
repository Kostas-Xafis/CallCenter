//! Tauri backend for the phone catalog. The command table is in
//! docs/CONTRACT.md; the file handling lives in storage.rs.

mod storage;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use storage::{Store, NOT_ADMIN};
use tauri::State;

struct App {
    store: Store,
    /// Admin session: set by login/set_password, lives as long as the process.
    admin: AtomicBool,
}

impl App {
    fn require_admin(&self) -> Result<(), String> {
        if self.admin.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(NOT_ADMIN.into())
        }
    }
}

/// Folder holding catalog.json: the exe's own folder. In debug builds,
/// `CATALOG_DIR` if set, else `<repo>/workspace/`.
fn data_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        if let Some(dir) = std::env::var_os("CATALOG_DIR") {
            return dir.into();
        }
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("workspace");
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

#[tauri::command]
fn load_catalog(app: State<App>) -> Result<Value, String> {
    let catalog = app.store.load()?;
    let version = storage::version_of(&catalog);
    Ok(json!({ "catalog": catalog, "version": version }))
}

#[tauri::command]
fn catalog_version(app: State<App>) -> Result<Option<String>, String> {
    app.store.version()
}

#[tauri::command]
fn save_catalog(app: State<App>, catalog: Value, base_version: Option<String>) -> Result<String, String> {
    app.require_admin()?;
    app.store.save(catalog, base_version)
}

#[tauri::command]
fn has_password(app: State<App>) -> bool {
    app.store.has_password()
}

#[tauri::command]
fn set_password(app: State<App>, password: String) -> Result<(), String> {
    app.store.set_password(&password)?;
    app.admin.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn login(app: State<App>, password: String) -> Result<bool, String> {
    let ok = app.store.verify_password(&password)?;
    if ok {
        app.admin.store(true, Ordering::SeqCst);
    }
    Ok(ok)
}

#[tauri::command]
fn logout(app: State<App>) {
    app.admin.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn is_admin(app: State<App>) -> bool {
    app.admin.load(Ordering::SeqCst)
}

#[tauri::command]
fn change_password(app: State<App>, old_password: String, new_password: String) -> Result<bool, String> {
    app.require_admin()?;
    app.store.change_password(&old_password, &new_password)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(App { store: Store::new(data_dir()), admin: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![
            load_catalog,
            catalog_version,
            save_catalog,
            has_password,
            set_password,
            login,
            logout,
            is_admin,
            change_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the catalog app");
}
