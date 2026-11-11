//! LifeOS backend: the small "helper" that works with the LifeOS folder.
//!
//! The screens (React) never touch the disk directly. They call the commands
//! below. Every path the screens send is *relative to the LifeOS folder*, and
//! `safe_join` refuses anything that would escape it, so the app can only ever
//! read and write inside that one folder (the one exception is `import_file`,
//! which moves a file the user picked from elsewhere *into* the folder).

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Settings {
    root: Option<String>,
}

#[derive(Serialize)]
struct Entry {
    /// Path relative to the LifeOS folder, always with "/" separators.
    path: String,
    mtime: u64,
    size: u64,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("settings.json"))
}

fn root_of(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "The LifeOS folder isn't set yet".to_string())
}

/// Join a relative path onto the root, refusing absolute paths and "..".
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("Path not allowed: {rel}")),
        }
    }
    Ok(root.join(rel_path))
}

fn to_rel(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    Some(parts.join("/"))
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let path = item.path();
        let Ok(meta) = item.metadata() else { continue };
        if meta.is_dir() {
            walk(root, &path, out);
        } else if meta.is_file() {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            if let Some(rel) = to_rel(root, &path) {
                out.push(Entry { path: rel, mtime, size: meta.len() });
            }
        }
    }
}

/// Move a file, falling back to copy + delete when the source is on another
/// drive (a plain rename can't cross drives).
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() {
        return Err(format!("Already exists: {}", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    if fs::rename(from, to).is_err() {
        fs::copy(from, to).map_err(err)?;
        fs::remove_file(from).map_err(err)?;
    }
    Ok(())
}

fn start_watcher(app: &AppHandle, state: &State<AppState>, root: &Path) -> Result<(), String> {
    let handle = app.clone();
    let last = Mutex::new(Instant::now() - Duration::from_secs(5));
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        // Light throttle; the screens debounce as well.
        let mut l = last.lock().unwrap();
        if l.elapsed() > Duration::from_millis(150) {
            *l = Instant::now();
            let _ = handle.emit("lifeos-changed", ());
        }
    })
    .map_err(err)?;
    watcher.watch(root, RecursiveMode::Recursive).map_err(err)?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

// ---------- commands ----------

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let file = settings_file(&app)?;
    let mut s: Settings = fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if s.root.is_none() {
        // Default: Documents/LifeOS
        let docs = app.path().document_dir().map_err(err)?;
        s.root = Some(docs.join("LifeOS").to_string_lossy().to_string());
    }
    Ok(s)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let file = settings_file(&app)?;
    fs::write(file, serde_json::to_string_pretty(&settings).map_err(err)?).map_err(err)
}

/// Point the app at a LifeOS folder (creating it if needed) and start watching it.
#[tauri::command]
fn open_root(app: AppHandle, state: State<AppState>, root: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    fs::create_dir_all(&root).map_err(err)?;
    *state.root.lock().unwrap() = Some(root.clone());
    // Let the window show pictures and videos from this folder (and only this folder).
    app.asset_protocol_scope().allow_directory(&root, true).map_err(err)?;
    start_watcher(&app, &state, &root)
}

#[tauri::command]
fn scan_tree(state: State<AppState>) -> Result<Vec<Entry>, String> {
    let root = root_of(&state)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    Ok(out)
}

#[tauri::command]
fn read_text(state: State<AppState>, path: String) -> Result<Option<String>, String> {
    let root = root_of(&state)?;
    let p = safe_join(&root, &path)?;
    Ok(fs::read_to_string(p).ok())
}

#[tauri::command]
fn read_many(state: State<AppState>, paths: Vec<String>) -> Result<Vec<Option<String>>, String> {
    let root = root_of(&state)?;
    Ok(paths
        .iter()
        .map(|rel| safe_join(&root, rel).ok().and_then(|p| fs::read_to_string(p).ok()))
        .collect())
}

/// Write a text file safely: write to a temp file, then swap it in.
#[tauri::command]
fn write_text(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let p = safe_join(&root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = p.with_extension("lifeos-tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, &p).map_err(err)
}

#[tauri::command]
fn move_within(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let a = safe_join(&root, &from)?;
    let b = safe_join(&root, &to)?;
    if a == b {
        return Ok(());
    }
    move_file(&a, &b)
}

/// Rename or move a whole folder inside LifeOS (used when a project is renamed).
#[tauri::command]
fn rename_dir(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let a = safe_join(&root, &from)?;
    let b = safe_join(&root, &to)?;
    if a == b {
        return Ok(());
    }
    if b.exists() {
        return Err(format!("Already exists: {to}"));
    }
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(&a, &b).map_err(err)
}

#[tauri::command]
fn path_exists(state: State<AppState>, path: String) -> Result<bool, String> {
    let root = root_of(&state)?;
    Ok(safe_join(&root, &path)?.exists())
}

#[tauri::command]
fn make_dir(state: State<AppState>, path: String) -> Result<(), String> {
    let root = root_of(&state)?;
    fs::create_dir_all(safe_join(&root, &path)?).map_err(err)
}

/// Move a file the user picked (anywhere on the Mac) into the LifeOS folder.
#[tauri::command]
fn import_file(state: State<AppState>, from_abs: String, to: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let b = safe_join(&root, &to)?;
    move_file(Path::new(&from_abs), &b)
}

fn run_open(args: &[&str]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).args(args).spawn().map_err(err)?;
    Ok(())
}

/// The full location of a file in the LifeOS folder, so the window can show it
/// (pictures and videos on a project's Board). Still only inside the folder.
#[tauri::command]
fn full_path(state: State<AppState>, path: String) -> Result<String, String> {
    let root = root_of(&state)?;
    Ok(safe_join(&root, &path)?.to_string_lossy().to_string())
}

/// Open a file or folder with its default app.
#[tauri::command]
fn open_in_os(state: State<AppState>, path: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let p = safe_join(&root, &path)?;
    run_open(&[&p.to_string_lossy()])
}

/// Show a file or folder in Finder.
#[tauri::command]
fn reveal_in_finder(state: State<AppState>, path: String) -> Result<(), String> {
    let root = root_of(&state)?;
    let p = safe_join(&root, &path)?;
    #[cfg(target_os = "macos")]
    {
        return run_open(&["-R", &p.to_string_lossy()]);
    }
    #[allow(unreachable_code)]
    {
        let target = if p.is_dir() { p.clone() } else { p.parent().unwrap_or(&p).to_path_buf() };
        run_open(&[&target.to_string_lossy()])
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            open_root,
            scan_tree,
            read_text,
            read_many,
            write_text,
            move_within,
            rename_dir,
            path_exists,
            make_dir,
            import_file,
            full_path,
            open_in_os,
            reveal_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running LifeOS");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_blocks_escapes() {
        let root = Path::new("/tmp/LifeOS");
        assert!(safe_join(root, "Health/Medical/Blood Test.md").is_ok());
        assert!(safe_join(root, "../secrets.txt").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "Health/../../x").is_err());
    }

    #[test]
    fn walk_skips_hidden_and_reports_relative_paths() {
        let dir = std::env::temp_dir().join(format!("lifeos-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Health/Medical")).unwrap();
        fs::create_dir_all(dir.join(".lifeos")).unwrap();
        fs::write(dir.join("Health/Medical/Blood Test.md"), "x").unwrap();
        fs::write(dir.join(".lifeos/modules.json"), "{}").unwrap();
        let mut out = Vec::new();
        walk(&dir, &dir, &mut out);
        let paths: Vec<String> = out.iter().map(|e| e.path.clone()).collect();
        assert_eq!(paths, vec!["Health/Medical/Blood Test.md".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_file_refuses_to_overwrite() {
        let dir = std::env::temp_dir().join(format!("lifeos-mv-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        assert!(move_file(&dir.join("a.txt"), &dir.join("b.txt")).is_err());
        assert!(move_file(&dir.join("a.txt"), &dir.join("sub/c.txt")).is_ok());
        assert!(dir.join("sub/c.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
