//! Who changed what and when. Lives in the app config dir, never in the workspace.

use crate::error::{AppError, Result};
use crate::settings::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;

/// How long the watcher echo of an app write is ignored.
const OWN_WINDOW_MS: u64 = 2000;
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Actor {
    /// Diego, through the app.
    Tu,
    /// The embedded Claude chat.
    Claude,
    /// Claude driven from the phone (remote control).
    ClaudeCel,
    /// Anything else (another app, Finder, git...).
    Fuera,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Activity {
    /// Milliseconds since the epoch.
    pub at: u64,
    pub by: Actor,
}

/// Decides who made a change the app did not make itself.
pub fn classify(claude_running_in_space: bool, remote_on: bool) -> Actor {
    if claude_running_in_space {
        Actor::Claude
    } else if remote_on {
        Actor::ClaudeCel
    } else {
        Actor::Fuera
    }
}

pub type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    })
}

struct Shared {
    map: Mutex<HashMap<String, Activity>>,
    /// path -> instant (ms) until which watcher events for it are our own echo.
    own: Mutex<HashMap<String, u64>>,
    file: PathBuf,
    clock: Clock,
    debounce: Option<Duration>,
    save_pending: AtomicBool,
    notifier: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

#[derive(Clone)]
pub struct ActivityLog(Arc<Shared>);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn is_under(path: &str, dir: &str) -> bool {
    path == dir || (path.starts_with(dir) && path.as_bytes().get(dir.len()) == Some(&b'/'))
}

/// `a/b/c` -> `["a", "a/b"]`.
fn ancestors(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').collect();
    (1..parts.len()).map(|i| parts[..i].join("/")).collect()
}

impl ActivityLog {
    /// Loads `file`, dropping paths that no longer exist under `root`.
    pub fn load(file: PathBuf, root: &Path, clock: Clock, debounce: Option<Duration>) -> Self {
        let mut map: HashMap<String, Activity> = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        map.retain(|p, _| std::fs::symlink_metadata(root.join(p)).is_ok());
        ActivityLog(Arc::new(Shared {
            map: Mutex::new(map),
            own: Mutex::new(HashMap::new()),
            file,
            clock,
            debounce,
            save_pending: AtomicBool::new(false),
            notifier: Mutex::new(None),
        }))
    }

    pub fn set_notifier(&self, f: impl Fn() + Send + Sync + 'static) {
        *lock(&self.0.notifier) = Some(Arc::new(f));
    }

    pub fn snapshot(&self) -> HashMap<String, Activity> {
        lock(&self.0.map).clone()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn record(&self, path: &str, by: Actor) {
        let at = (self.0.clock)();
        lock(&self.0.map).insert(path.to_string(), Activity { at, by });
        self.changed();
    }

    /// The app itself changed `path` (and so its folders): records `Tu` and
    /// remembers the paths so the watcher echo is not reclassified.
    pub fn record_own(&self, path: &str) {
        let now = (self.0.clock)();
        let mut all = ancestors(path);
        all.push(path.to_string());
        {
            let mut own = lock(&self.0.own);
            own.retain(|_, until| *until > now);
            let mut map = lock(&self.0.map);
            for p in all {
                own.insert(p.clone(), now + OWN_WINDOW_MS);
                map.insert(p, Activity { at: now, by: Actor::Tu });
            }
        }
        self.changed();
    }

    /// The app moved `from` to `to`: activity under `from` follows the move.
    pub fn record_move_own(&self, from: &str, to: &str) {
        {
            let mut map = lock(&self.0.map);
            let moved: Vec<String> = map.keys().filter(|k| is_under(k, from)).cloned().collect();
            for k in moved {
                if let Some(a) = map.remove(&k) {
                    map.insert(format!("{to}{}", &k[from.len()..]), a);
                }
            }
        }
        let now = (self.0.clock)();
        lock(&self.0.own).insert(from.to_string(), now + OWN_WINDOW_MS);
        self.record_own(to);
    }

    /// The app deleted `path`: forget it and everything under it.
    pub fn remove_own(&self, path: &str) {
        let now = (self.0.clock)();
        {
            let mut own = lock(&self.0.own);
            own.insert(path.to_string(), now + OWN_WINDOW_MS);
            for a in ancestors(path) {
                own.insert(a, now + OWN_WINDOW_MS);
            }
        }
        self.remove_tree(path);
        for a in ancestors(path) {
            lock(&self.0.map).insert(a, Activity { at: now, by: Actor::Tu });
        }
        self.changed();
    }

    fn remove_tree(&self, path: &str) {
        lock(&self.0.map).retain(|k, _| !is_under(k, path));
    }

    pub fn is_own(&self, path: &str) -> bool {
        let now = (self.0.clock)();
        lock(&self.0.own).get(path).is_some_and(|until| *until > now)
    }

    /// Applies a watcher batch: own echoes are skipped, vanished paths are
    /// forgotten, the rest are attributed to `actor`.
    pub fn ingest(&self, paths: &[String], exists: impl Fn(&str) -> bool, actor: Actor) {
        let mut touched = false;
        let at = (self.0.clock)();
        for p in paths {
            if self.is_own(p) {
                continue;
            }
            touched = true;
            if exists(p) {
                lock(&self.0.map).insert(p.clone(), Activity { at, by: actor });
            } else {
                self.remove_tree(p);
            }
        }
        if touched {
            self.changed();
        }
    }

    /// Drops entries whose path no longer exists under `root`.
    pub fn prune(&self, root: &Path) {
        let before = lock(&self.0.map).len();
        lock(&self.0.map).retain(|p, _| std::fs::symlink_metadata(root.join(p)).is_ok());
        if lock(&self.0.map).len() != before {
            self.changed();
        }
    }

    fn changed(&self) {
        self.schedule_save();
        let n = lock(&self.0.notifier).clone();
        if let Some(n) = n {
            n();
        }
    }

    fn schedule_save(&self) {
        let Some(delay) = self.0.debounce else { return };
        if !self.0.save_pending.swap(true, Ordering::SeqCst) {
            let this = self.clone();
            std::thread::spawn(move || {
                std::thread::sleep(delay);
                let _ = this.flush();
            });
        }
    }

    /// Writes the log now (atomic: temp file, then rename).
    pub fn flush(&self) -> Result<()> {
        self.0.save_pending.store(false, Ordering::SeqCst);
        let json = serde_json::to_string(&self.snapshot()).map_err(|e| AppError::Io(e.to_string()))?;
        if let Some(dir) = self.0.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.0.file.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, &self.0.file)?;
        Ok(())
    }
}

pub fn default_file(state: &AppState) -> PathBuf {
    state
        .config_file
        .parent()
        .map(|d| d.join("actividad.json"))
        .unwrap_or_else(|| PathBuf::from("actividad.json"))
}

pub fn default_debounce() -> Option<Duration> {
    Some(SAVE_DEBOUNCE)
}

#[tauri::command]
pub fn activity(log: State<ActivityLog>) -> HashMap<String, Activity> {
    log.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    fn fake_clock() -> (Clock, Arc<AtomicU64>) {
        let t = Arc::new(AtomicU64::new(1_000));
        let t2 = t.clone();
        (Arc::new(move || t2.load(Ordering::SeqCst)), t)
    }

    fn new_log(dir: &Path) -> (ActivityLog, Arc<AtomicU64>) {
        let (c, t) = fake_clock();
        (ActivityLog::load(dir.join("cfg").join("actividad.json"), dir, c, None), t)
    }

    #[test]
    fn classify_four_combinations() {
        assert_eq!(classify(true, true), Actor::Claude);
        assert_eq!(classify(true, false), Actor::Claude);
        assert_eq!(classify(false, true), Actor::ClaudeCel);
        assert_eq!(classify(false, false), Actor::Fuera);
    }

    #[test]
    fn actor_serializes_kebab() {
        let j = serde_json::to_string(&Activity { at: 5, by: Actor::ClaudeCel }).unwrap();
        assert_eq!(j, r#"{"at":5,"by":"claude-cel"}"#);
        assert_eq!(serde_json::to_string(&Actor::Tu).unwrap(), r#""tu""#);
        assert_eq!(serde_json::to_string(&Actor::Fuera).unwrap(), r#""fuera""#);
    }

    #[test]
    fn saves_reloads_and_drops_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        std::fs::write(dir.path().join("b.md"), "x").unwrap();
        let (log, _) = new_log(dir.path());
        log.record("a.md", Actor::Claude);
        log.record("b.md", Actor::Fuera);
        log.flush().unwrap();
        std::fs::remove_file(dir.path().join("b.md")).unwrap();
        let (c, _) = fake_clock();
        let again = ActivityLog::load(dir.path().join("cfg").join("actividad.json"), dir.path(), c, None);
        let snap = again.snapshot();
        assert_eq!(snap.get("a.md"), Some(&Activity { at: 1_000, by: Actor::Claude }));
        assert!(!snap.contains_key("b.md"));
    }

    #[test]
    fn corrupt_file_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("cfg")).unwrap();
        std::fs::write(dir.path().join("cfg").join("actividad.json"), "{no").unwrap();
        let (log, _) = new_log(dir.path());
        assert!(log.snapshot().is_empty());
    }

    #[test]
    fn debounced_save_writes_file() {
        let dir = tempfile::tempdir().unwrap();
        let (c, _) = fake_clock();
        let file = dir.path().join("cfg").join("actividad.json");
        let log = ActivityLog::load(file.clone(), dir.path(), c, Some(Duration::from_millis(30)));
        log.record("a.md", Actor::Tu);
        log.record("b.md", Actor::Tu);
        assert!(!file.exists());
        std::thread::sleep(Duration::from_millis(300));
        let raw = std::fs::read_to_string(&file).unwrap();
        assert!(raw.contains("a.md") && raw.contains("b.md"));
    }

    #[test]
    fn own_write_echo_is_not_reclassified() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Ropa")).unwrap();
        std::fs::write(dir.path().join("Ropa/n.md"), "x").unwrap();
        let (log, t) = new_log(dir.path());
        log.record_own("Ropa/n.md");
        t.store(1_500, Ordering::SeqCst);
        log.ingest(&["Ropa/n.md".into(), "Ropa".into()], |_| true, Actor::Claude);
        let snap = log.snapshot();
        assert_eq!(snap["Ropa/n.md"].by, Actor::Tu);
        assert_eq!(snap["Ropa"].by, Actor::Tu);
        // After the window the same event is an outside change.
        t.store(4_000, Ordering::SeqCst);
        log.ingest(&["Ropa/n.md".into()], |_| true, Actor::Claude);
        assert_eq!(log.snapshot()["Ropa/n.md"], Activity { at: 4_000, by: Actor::Claude });
    }

    #[test]
    fn external_change_gets_actor_and_deletion_forgets() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        log.ingest(&["a.md".into()], |_| true, Actor::ClaudeCel);
        assert_eq!(log.snapshot()["a.md"].by, Actor::ClaudeCel);
        log.ingest(&["a.md".into()], |_| false, Actor::Fuera);
        assert!(log.snapshot().is_empty());
    }

    #[test]
    fn move_carries_children_and_delete_forgets_tree() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        log.record("Ropa/a.md", Actor::Claude);
        log.record("Ropas/b.md", Actor::Claude);
        log.record_move_own("Ropa", "Moda");
        let snap = log.snapshot();
        assert_eq!(snap["Moda/a.md"].by, Actor::Claude);
        assert_eq!(snap["Moda"].by, Actor::Tu);
        assert!(!snap.contains_key("Ropa/a.md"));
        assert!(snap.contains_key("Ropas/b.md"));
        log.remove_own("Moda");
        assert!(!log.snapshot().keys().any(|k| k.starts_with("Moda")));
        assert!(log.is_own("Moda"));
    }

    #[test]
    fn notifier_fires_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        let n = Arc::new(AtomicU64::new(0));
        let n2 = n.clone();
        log.set_notifier(move || {
            n2.fetch_add(1, Ordering::SeqCst);
        });
        log.record("a", Actor::Tu);
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }
}
