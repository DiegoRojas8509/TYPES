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
use unicode_normalization::UnicodeNormalization;

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
    /// path -> instant (ms) until which watcher events for exactly that path are our echo.
    own: Mutex<HashMap<String, u64>>,
    /// folder -> instant until which events for it AND everything under it are our echo.
    own_dirs: Mutex<HashMap<String, u64>>,
    file: PathBuf,
    clock: Clock,
    debounce: Option<Duration>,
    save_pending: AtomicBool,
    flush_lock: Mutex<()>,
    notifier: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

#[derive(Clone)]
pub struct ActivityLog(Arc<Shared>);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Activity keys are always NFC (macOS may report NFD).
pub fn nfc(s: &str) -> String {
    s.nfc().collect()
}

fn is_under(path: &str, dir: &str) -> bool {
    path == dir || (path.starts_with(dir) && path.as_bytes().get(dir.len()) == Some(&b'/'))
}

/// `a/b/c` -> `["a", "a/b"]`.
fn ancestors(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').collect();
    (1..parts.len()).map(|i| parts[..i].join("/")).collect()
}

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

impl ActivityLog {
    /// Loads `file`, dropping unsafe keys and paths that no longer exist under `root`.
    pub fn load(file: PathBuf, root: &Path, clock: Clock, debounce: Option<Duration>) -> Self {
        let small = std::fs::metadata(&file).map(|m| m.len() <= MAX_FILE_BYTES).unwrap_or(false);
        let raw: HashMap<String, Activity> = if small {
            std::fs::read_to_string(&file)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            HashMap::new()
        };
        let mut map = HashMap::new();
        for (k, v) in raw {
            let Ok(parts) = crate::workspace::rel_parts(&k) else { continue };
            if parts.is_empty() {
                continue;
            }
            let key = nfc(&parts.join("/"));
            if std::fs::symlink_metadata(root.join(&key)).is_ok() || std::fs::symlink_metadata(root.join(&k)).is_ok() {
                map.insert(key, v);
            }
            if map.len() >= MAX_ENTRIES {
                break;
            }
        }
        ActivityLog(Arc::new(Shared {
            map: Mutex::new(map),
            own: Mutex::new(HashMap::new()),
            own_dirs: Mutex::new(HashMap::new()),
            file,
            clock,
            debounce,
            save_pending: AtomicBool::new(false),
            flush_lock: Mutex::new(()),
            notifier: Mutex::new(None),
        }))
    }

    pub fn set_notifier(&self, f: impl Fn() + Send + Sync + 'static) {
        *lock(&self.0.notifier) = Some(Arc::new(f));
    }

    pub fn snapshot(&self) -> HashMap<String, Activity> {
        lock(&self.0.map).clone()
    }

    /// Forgets everything (the workspace root changed).
    pub fn clear(&self) {
        lock(&self.0.map).clear();
        lock(&self.0.own).clear();
        lock(&self.0.own_dirs).clear();
        self.changed();
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn record(&self, path: &str, by: Actor) {
        let at = (self.0.clock)();
        lock(&self.0.map).insert(nfc(path), Activity { at, by });
        self.changed();
    }

    fn mark(&self, path: &str, tree: bool) {
        let until = (self.0.clock)() + OWN_WINDOW_MS;
        let now = (self.0.clock)();
        let mut own = lock(&self.0.own);
        own.retain(|_, u| *u > now);
        own.insert(path.to_string(), until);
        for a in ancestors(path) {
            own.insert(a, until);
        }
        if tree {
            let mut dirs = lock(&self.0.own_dirs);
            dirs.retain(|_, u| *u > now);
            dirs.insert(path.to_string(), until);
        }
    }

    /// Marks a single path (and its folders) as ours BEFORE the app writes it, so the
    /// watcher cannot win the race against `record_own`.
    pub fn mark_own(&self, path: &str) {
        self.mark(&nfc(path), false);
    }

    /// Marks a folder (and everything that appears under it) as ours BEFORE a
    /// long operation, so its watcher events are not attributed to anyone else.
    pub fn mark_own_tree(&self, path: &str) {
        self.mark(&nfc(path), true);
    }

    /// The app itself changed `path`: records `Tu` and remembers the path (and
    /// its folders, whose mtime changes too) so the watcher echo is ignored.
    /// Ancestors get no entry of their own; folder activity is derived from descendants.
    pub fn record_own(&self, path: &str) {
        let path = nfc(path);
        self.mark(&path, false);
        let at = (self.0.clock)();
        lock(&self.0.map).insert(path, Activity { at, by: Actor::Tu });
        self.changed();
    }

    /// Like `record_own` for a folder the app created or filled: its whole subtree is ours.
    pub fn record_own_tree(&self, path: &str) {
        let path = nfc(path);
        self.mark(&path, true);
        let at = (self.0.clock)();
        lock(&self.0.map).insert(path, Activity { at, by: Actor::Tu });
        self.changed();
    }

    /// The app moved `from` to `to`: activity under `from` follows the move.
    pub fn record_move_own(&self, from: &str, to: &str) {
        let (from, to) = (nfc(from), nfc(to));
        {
            let mut map = lock(&self.0.map);
            let moved: Vec<String> = map.keys().filter(|k| is_under(k, &from)).cloned().collect();
            for k in moved {
                if let Some(a) = map.remove(&k) {
                    map.insert(format!("{to}{}", &k[from.len()..]), a);
                }
            }
        }
        self.mark(&from, true);
        self.record_own_tree(&to);
    }

    /// The app deleted `path`: forget it and everything under it.
    pub fn remove_own(&self, path: &str) {
        let path = nfc(path);
        self.mark(&path, true);
        self.remove_tree(&path);
        self.changed();
    }

    fn remove_tree(&self, path: &str) {
        lock(&self.0.map).retain(|k, _| !is_under(k, path));
    }

    pub fn is_own(&self, path: &str) -> bool {
        let path = nfc(path);
        let now = (self.0.clock)();
        if lock(&self.0.own).get(&path).is_some_and(|u| *u > now) {
            return true;
        }
        lock(&self.0.own_dirs).iter().any(|(d, u)| *u > now && is_under(&path, d))
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
            let key = nfc(p);
            if exists(p) {
                lock(&self.0.map).insert(key, Activity { at, by: actor });
            } else {
                self.remove_tree(&key);
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

    /// Writes the log now (atomic: temp file, fsync, rename). Serialized.
    pub fn flush(&self) -> Result<()> {
        let _guard = lock(&self.0.flush_lock);
        self.0.save_pending.store(false, Ordering::SeqCst);
        let json = serde_json::to_string(&self.snapshot()).map_err(|e| AppError::Io(e.to_string()))?;
        if let Some(dir) = self.0.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.0.file.with_extension("json.tmp");
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(json.as_bytes())?;
            f.sync_all()?;
        }
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
        assert!(!snap.contains_key("Ropa"), "ancestors get no entry");
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
        assert!(log.is_own("Ropa/a.md") && log.is_own("Moda/x/y"));
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

    #[test]
    fn created_space_children_are_all_own() {
        let dir = tempfile::tempdir().unwrap();
        let (log, t) = new_log(dir.path());
        log.record_own_tree("Ropa");
        t.store(1_800, Ordering::SeqCst);
        let evs: Vec<String> = ["Ropa", "Ropa/CLAUDE.md", "Ropa/adjuntos", "Ropa/adjuntos/a.png"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        log.ingest(&evs, |_| true, Actor::Fuera);
        let snap = log.snapshot();
        assert!(snap.values().all(|a| a.by == Actor::Tu), "{snap:?}");
        assert!(!snap.contains_key("Ropa/CLAUDE.md"));
        t.store(3_500, Ordering::SeqCst);
        log.ingest(&["Ropa/CLAUDE.md".into()], |_| true, Actor::Fuera);
        assert_eq!(log.snapshot()["Ropa/CLAUDE.md"].by, Actor::Fuera);
    }

    #[test]
    fn premarked_tree_covers_long_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (log, t) = new_log(dir.path());
        log.mark_own_tree("Ropa/Imágenes");
        t.store(2_500, Ordering::SeqCst);
        assert!(log.is_own("Ropa/Imágenes/big.png"));
        assert!(log.is_own("Ropa"));
        assert!(!log.is_own("Ropa/otro.md"));
    }

    #[test]
    fn nfd_and_nfc_spellings_match() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        let nfc_p = "Ropa/Im\u{e1}genes/a.png";
        let nfd_p = "Ropa/Ima\u{301}genes/a.png";
        log.record_own(nfc_p);
        assert!(log.is_own(nfd_p));
        log.ingest(&[nfd_p.into()], |_| true, Actor::Fuera);
        assert_eq!(log.snapshot().len(), 1);
        assert_eq!(log.snapshot()[nfc_p].by, Actor::Tu);
        let (log2, _) = new_log(dir.path());
        log2.record_own(nfd_p);
        assert!(log2.is_own(nfc_p));
        assert!(log2.snapshot().contains_key(nfc_p));
    }

    #[test]
    fn concurrent_flushes_leave_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        for i in 0..200 {
            log.record(&format!("f{i}.md"), Actor::Tu);
        }
        let hs: Vec<_> = (0..8)
            .map(|_| {
                let l = log.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        l.flush().unwrap();
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        let raw = std::fs::read_to_string(dir.path().join("cfg").join("actividad.json")).unwrap();
        let back: HashMap<String, Activity> = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.len(), 200);
    }

    #[test]
    fn hostile_file_is_filtered_and_capped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ok.md"), "x").unwrap();
        let cfg = dir.path().join("cfg");
        std::fs::create_dir(&cfg).unwrap();
        let a = r#"{"at":1,"by":"tu"}"#;
        std::fs::write(
            cfg.join("actividad.json"),
            format!(r#"{{"ok.md":{a},"/etc/hosts":{a},"../x":{a},"":{a},"a\\b":{a}}}"#),
        )
        .unwrap();
        let (c, _) = fake_clock();
        let log = ActivityLog::load(cfg.join("actividad.json"), dir.path(), c.clone(), None);
        assert_eq!(log.snapshot().keys().collect::<Vec<_>>(), vec!["ok.md"]);
        // Oversized file starts empty.
        std::fs::write(cfg.join("actividad.json"), vec![b' '; 4 * 1024 * 1024 + 1]).unwrap();
        let log = ActivityLog::load(cfg.join("actividad.json"), dir.path(), c, None);
        assert!(log.snapshot().is_empty());
    }

    #[test]
    fn clear_forgets_everything() {
        let dir = tempfile::tempdir().unwrap();
        let (log, _) = new_log(dir.path());
        log.record_own_tree("Ropa");
        log.clear();
        assert!(log.snapshot().is_empty() && !log.is_own("Ropa/x"));
    }

    #[test]
    fn premark_shields_the_echo_before_the_record() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        let (log, t) = new_log(dir.path());
        log.mark_own("a.md");
        // The watcher wins the race: the event arrives before record_own.
        log.ingest(&["a.md".into()], |_| true, Actor::Fuera);
        assert!(log.snapshot().is_empty(), "premarked path is not attributed to anyone");
        t.store(4_000, Ordering::SeqCst);
        log.ingest(&["a.md".into()], |_| true, Actor::Fuera);
        assert_eq!(log.snapshot()["a.md"].by, Actor::Fuera);
    }
}
