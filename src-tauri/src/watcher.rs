//! Watches the workspace root and reports debounced, relative changes.

use crate::error::{AppError, Result};
use crate::settings::AppState;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE: Duration = Duration::from_millis(150);
/// A constant stream of events still gets flushed at least this often.
const MAX_WAIT: Duration = Duration::from_secs(1);

/// Payload of the `fs-changed` event: `{ "paths": ["Ropa/Notas.md", ...] }`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FsChanged {
    pub paths: Vec<String>,
}

/// Turns an absolute path reported by the OS into a `/`-separated path relative
/// to the root. `roots` holds every spelling of the root (raw and canonical,
/// since macOS reports `/private/var/...` for `/var/...`). Returns `None` for
/// paths outside the root, the root itself, or anything containing a dot-entry.
pub fn relativize(roots: &[PathBuf], abs: &Path) -> Option<String> {
    let rel = roots.iter().find_map(|r| abs.strip_prefix(r).ok())?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.starts_with('.') {
                    return None;
                }
                parts.push(s.into_owned());
            }
            _ => return None,
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

/// Keeps only events that change content or the tree (not plain reads).
fn is_relevant(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_) | EventKind::Other)
}

pub struct FsWatcher {
    // Dropping the watcher closes the channel, which ends the debounce thread.
    _watcher: notify::RecommendedWatcher,
    _thread: JoinHandle<()>,
}

/// Starts watching `root`; `on_change` receives each debounced, sorted batch.
pub fn start(root: &Path, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<FsWatcher> {
    let mut roots = vec![root.to_path_buf()];
    if let Ok(canon) = root.canonicalize()
        && canon != root
    {
        roots.push(canon);
    }
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| AppError::Io(e.to_string()))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Io(e.to_string()))?;

    let thread = std::thread::spawn(move || {
        let mut pending: BTreeSet<String> = BTreeSet::new();
        let mut first_at: Option<Instant> = None;
        loop {
            let wait = if pending.is_empty() {
                Duration::from_secs(3600)
            } else {
                DEBOUNCE
            };
            match rx.recv_timeout(wait) {
                Ok(Ok(event)) => {
                    if is_relevant(&event.kind) {
                        for p in &event.paths {
                            if let Some(rel) = relativize(&roots, p) {
                                pending.insert(rel);
                            }
                        }
                        if !pending.is_empty() && first_at.is_none() {
                            first_at = Some(Instant::now());
                        }
                    }
                    if first_at.is_some_and(|t| t.elapsed() >= MAX_WAIT) {
                        flush(&mut pending, &mut first_at, &on_change);
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => flush(&mut pending, &mut first_at, &on_change),
                Err(RecvTimeoutError::Disconnected) => {
                    flush(&mut pending, &mut first_at, &on_change);
                    break;
                }
            }
        }
    });
    Ok(FsWatcher { _watcher: watcher, _thread: thread })
}

fn flush(pending: &mut BTreeSet<String>, first_at: &mut Option<Instant>, on_change: &impl Fn(Vec<String>)) {
    *first_at = None;
    if !pending.is_empty() {
        on_change(std::mem::take(pending).into_iter().collect());
    }
}

/// Tauri-managed slot holding the live watcher.
#[derive(Default)]
pub struct WatcherSlot(Mutex<Option<FsWatcher>>);

/// (Re)starts the watcher on the current workspace root, emitting `fs-changed`.
pub fn restart(app: &AppHandle) {
    let root = app.state::<AppState>().root();
    let handle = app.clone();
    let started = start(&root, move |paths| {
        let _ = handle.emit("fs-changed", FsChanged { paths });
    });
    let slot = app.state::<WatcherSlot>();
    let mut guard = slot.0.lock().unwrap_or_else(|e| e.into_inner());
    match started {
        Ok(w) => *guard = Some(w),
        Err(e) => {
            eprintln!("could not watch workspace: {e}");
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;

    fn collect(rx: &Receiver<Vec<String>>, secs: u64) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(secs);
        let mut all = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            if let Ok(batch) = rx.recv_timeout(left) {
                all.extend(batch);
            }
        }
        all
    }

    #[test]
    fn relativize_handles_roots_dots_and_outside() {
        let roots = vec![PathBuf::from("/var/r"), PathBuf::from("/private/var/r")];
        assert_eq!(relativize(&roots, Path::new("/private/var/r/Ropa/Diseño.md")), Some("Ropa/Diseño.md".into()));
        assert_eq!(relativize(&roots, Path::new("/var/r/a.md")), Some("a.md".into()));
        assert_eq!(relativize(&roots, Path::new("/var/r/Ropa/.a.md.types-tmp")), None);
        assert_eq!(relativize(&roots, Path::new("/var/r/.git/x")), None);
        assert_eq!(relativize(&roots, Path::new("/var/r")), None);
        assert_eq!(relativize(&roots, Path::new("/etc/hosts")), None);
    }

    #[test]
    fn watcher_reports_relative_path_on_write() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Ropa")).unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = start(dir.path(), move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(dir.path().join("Ropa").join("Notas.md"), "hola").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(2)).expect("no event within 2s");
        assert!(got.contains(&"Ropa/Notas.md".to_string()), "got {got:?}");
    }

    #[test]
    fn watcher_ignores_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = start(dir.path(), move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(dir.path().join(".oculto"), "x").unwrap();
        std::fs::write(dir.path().join(".n.md.types-tmp"), "x").unwrap();
        std::fs::write(dir.path().join("visible.md"), "x").unwrap();
        let got = collect(&rx, 2);
        assert!(got.contains(&"visible.md".to_string()), "got {got:?}");
        assert!(got.iter().all(|p| !p.contains('.') || p == "visible.md"), "got {got:?}");
    }
}
