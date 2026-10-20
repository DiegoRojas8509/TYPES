use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub workspace_root: PathBuf,
    pub claude_path: Option<PathBuf>,
}

impl Settings {
    pub fn default_for_home(home: &Path) -> Self {
        Settings {
            workspace_root: home.join("Documents").join("TYPES.nosync").join("espacios"),
            claude_path: None,
        }
    }
}

/// Reads settings; a missing or corrupt file yields the defaults.
pub fn load(file: &Path, home: &Path) -> Settings {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Settings::default_for_home(home))
}

pub fn save(file: &Path, settings: &Settings) -> Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| AppError::Io(e.to_string()))?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

/// Managed Tauri state shared by all commands.
pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config_file: PathBuf,
}

impl AppState {
    pub fn new(config_file: PathBuf, settings: Settings) -> Self {
        AppState { settings: Mutex::new(settings), config_file }
    }

    pub fn snapshot(&self) -> Settings {
        self.settings.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn root(&self) -> PathBuf {
        self.snapshot().workspace_root
    }

    /// Applies `f`, persists, and returns the new settings.
    pub fn update(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings> {
        let mut guard = self.settings.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = guard.clone();
        f(&mut next);
        save(&self.config_file, &next)?;
        *guard = next.clone();
        Ok(next)
    }
}

pub fn set_claude_path_in(state: &AppState, path: Option<String>) -> Result<Settings> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).map(PathBuf::from);
    if path.as_ref().is_some_and(|p| !p.is_absolute()) {
        return Err(AppError::Invalid("la ruta de Claude debe ser absoluta".into()));
    }
    state.update(|s| s.claude_path = path)
}

pub fn set_workspace_root_in(state: &AppState, path: String) -> Result<Settings> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() {
        return Err(AppError::Invalid("la carpeta debe ser una ruta absoluta".into()));
    }
    crate::workspace::ensure_root(&p)?;
    state.update(|s| s.workspace_root = p)
}

/// Lets the asset protocol serve files under the workspace root, and only there
/// (the static scope in `tauri.conf.json` is empty). Called at startup and
/// whenever the root changes. Grants cannot be revoked at runtime, so a root
/// used earlier in the same session stays readable until the app restarts.
pub fn grant_asset_scope(app: &AppHandle, root: &Path) {
    let scope = app.asset_protocol_scope();
    if let Err(e) = scope.allow_directory(root, true) {
        eprintln!("could not allow asset scope for {}: {e}", root.display());
    }
    // The protocol matches against the real path, so cover symlinked roots too.
    if let Ok(real) = root.canonicalize()
        && real != root
    {
        let _ = scope.allow_directory(&real, true);
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.snapshot()
}

#[tauri::command]
pub fn set_workspace_root(app: AppHandle, state: State<AppState>, path: String) -> Result<Settings> {
    let settings = set_workspace_root_in(&state, path)?;
    grant_asset_scope(&app, &settings.workspace_root);
    app.state::<crate::activity::ActivityLog>().clear();
    crate::watcher::restart(&app);
    Ok(settings)
}

#[tauri::command]
pub fn set_claude_path(state: State<AppState>, path: Option<String>) -> Result<Settings> {
    set_claude_path_in(&state, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_documents_types_espacios() {
        let s = Settings::default_for_home(Path::new("/h"));
        assert_eq!(s.workspace_root, PathBuf::from("/h/Documents/TYPES.nosync/espacios"));
        assert!(s.claude_path.is_none());
    }

    #[test]
    fn save_then_load_roundtrip_and_camel_case() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg").join("settings.json");
        let s = Settings { workspace_root: "/x".into(), claude_path: Some("/c".into()) };
        save(&file, &s).unwrap();
        assert_eq!(load(&file, dir.path()), s);
        let raw = std::fs::read_to_string(&file).unwrap();
        assert!(raw.contains("workspaceRoot") && raw.contains("claudePath"));
    }

    #[test]
    fn corrupt_file_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.json");
        std::fs::write(&file, "{nope").unwrap();
        assert_eq!(load(&file, dir.path()), Settings::default_for_home(dir.path()));
    }

    #[test]
    fn set_root_rejects_relative_and_creates_template() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(dir.path().join("s.json"), Settings::default_for_home(dir.path()));
        assert!(set_workspace_root_in(&state, "relativo".into()).is_err());
        let new_root = dir.path().join("mis espacios");
        let s = set_workspace_root_in(&state, new_root.to_string_lossy().into()).unwrap();
        assert_eq!(s.workspace_root, new_root);
        assert!(new_root.join("CLAUDE.md").is_file());
        assert_eq!(load(&dir.path().join("s.json"), dir.path()).workspace_root, new_root);
    }

    #[test]
    fn set_claude_path_empty_clears() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(dir.path().join("s.json"), Settings::default_for_home(dir.path()));
        let s = set_claude_path_in(&state, Some("/usr/bin/claude".into())).unwrap();
        assert_eq!(s.claude_path, Some("/usr/bin/claude".into()));
        assert!(set_claude_path_in(&state, Some("claude".into())).is_err());
        assert!(set_claude_path_in(&state, Some("  ".into())).unwrap().claude_path.is_none());
    }
}
