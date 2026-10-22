//! Watches the workspace root and reports debounced, relative changes.

use crate::activity::{classify, nfc, ActivityLog};
use crate::claude::ClaudeState;
use crate::error::{AppError, Result};
use crate::remote::RemoteState;
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

/// One debounced batch. `paths` is everything that changed (for `fs-changed`);
/// `content` leaves out paths that only had metadata/access events (xattrs,
/// chmod, "opened" marks), which are not real activity.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Batch {
    pub paths: Vec<String>,
    pub content: Vec<String>,
}

/// True for events that can change what a file contains or the tree itself.
fn is_content(kind: &EventKind) -> bool {
    use notify::event::ModifyKind;
    is_relevant(kind) && !matches!(kind, EventKind::Modify(ModifyKind::Metadata(_)))
}

/// Folds one event into the pending sets.
fn collect_event(
    roots: &[PathBuf],
    event: &notify::Event,
    pending: &mut BTreeSet<String>,
    content: &mut BTreeSet<String>,
) {
    if !is_relevant(&event.kind) {
        return;
    }
    let is_content = is_content(&event.kind);
    for p in &event.paths {
        if let Some(rel) = relativize(roots, p) {
            if is_content {
                content.insert(rel.clone());
            }
            pending.insert(rel);
        }
    }
}

pub struct FsWatcher {
    // Dropping the watcher closes the channel, which ends the debounce thread.
    _watcher: notify::RecommendedWatcher,
    _thread: JoinHandle<()>,
}

/// Starts watching `root`; `on_change` receives each debounced, sorted batch.
pub fn start(root: &Path, on_change: impl Fn(Batch) + Send + 'static) -> Result<FsWatcher> {
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
        let mut content: BTreeSet<String> = BTreeSet::new();
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
                        collect_event(&roots, &event, &mut pending, &mut content);
                        if !pending.is_empty() && first_at.is_none() {
                            first_at = Some(Instant::now());
                        }
                    }
                    if first_at.is_some_and(|t| t.elapsed() >= MAX_WAIT) {
                        flush(&mut pending, &mut content, &mut first_at, &on_change);
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => flush(&mut pending, &mut content, &mut first_at, &on_change),
                Err(RecvTimeoutError::Disconnected) => {
                    flush(&mut pending, &mut content, &mut first_at, &on_change);
                    break;
                }
            }
        }
    });
    Ok(FsWatcher { _watcher: watcher, _thread: thread })
}

fn flush(
    pending: &mut BTreeSet<String>,
    content: &mut BTreeSet<String>,
    first_at: &mut Option<Instant>,
    on_change: &impl Fn(Batch),
) {
    *first_at = None;
    if !pending.is_empty() {
        on_change(Batch {
            paths: std::mem::take(pending).into_iter().collect(),
            content: std::mem::take(content).into_iter().collect(),
        });
    }
}

/// Records who is behind a batch of content changes that the app did not make itself.
/// `is_running_in` receives the NFC first path segment (the space).
pub fn attribute_batch(
    log: &ActivityLog,
    root: &Path,
    paths: &[String],
    is_running_in: impl Fn(&str) -> bool,
    remote_on: bool,
) {
    let space_of = |p: &String| nfc(p.split('/').next().unwrap_or(""));
    // Group by space so each path asks about its own folder.
    for space in paths.iter().map(space_of).collect::<BTreeSet<_>>() {
        let batch: Vec<String> = paths.iter().filter(|p| space_of(p) == space).cloned().collect();
        let actor = classify(is_running_in(&space), remote_on);
        log.ingest(&batch, |p| std::fs::symlink_metadata(root.join(p)).is_ok(), actor);
    }
}

fn attribute(app: &AppHandle, root: &Path, paths: &[String]) {
    let claude = app.state::<ClaudeState>();
    let remote_on = app.state::<RemoteState>().is_on();
    let log = app.state::<ActivityLog>();
    let clock = crate::activity::system_clock();
    attribute_batch(&log, root, paths, |space| claude.is_running_in(space, (clock)()), remote_on);
}

/// Tauri-managed slot holding the live watcher.
#[derive(Default)]
pub struct WatcherSlot(Mutex<Option<FsWatcher>>);

/// (Re)starts the watcher on the current workspace root, emitting `fs-changed`.
pub fn restart(app: &AppHandle) {
    let root = app.state::<AppState>().root();
    let handle = app.clone();
    app.state::<ActivityLog>().prune(&root);
    let started = start(&root, {
        let root = root.clone();
        move |batch| {
            attribute(&handle, &root, &batch.content);
            let _ = handle.emit("fs-changed", FsChanged { paths: batch.paths });
        }
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

    fn collect(rx: &Receiver<Batch>, secs: u64) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(secs);
        let mut all = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            if let Ok(batch) = rx.recv_timeout(left) {
                all.extend(batch.paths);
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
    fn metadata_only_events_are_not_content() {
        use notify::event::{AccessKind, DataChange, MetadataKind, ModifyKind};
        let roots = vec![PathBuf::from("/r")];
        let ev = |kind| notify::Event::new(kind).add_path(PathBuf::from("/r/Ropa/a.md"));
        let (mut all, mut content) = (BTreeSet::new(), BTreeSet::new());
        collect_event(&roots, &ev(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended))), &mut all, &mut content);
        collect_event(&roots, &ev(EventKind::Access(AccessKind::Any)), &mut all, &mut content);
        assert_eq!(all.len(), 1, "metadata still reaches fs-changed");
        assert!(content.is_empty());
        collect_event(&roots, &ev(EventKind::Modify(ModifyKind::Data(DataChange::Any))), &mut all, &mut content);
        assert!(content.contains("Ropa/a.md"));
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
        let got = rx.recv_timeout(Duration::from_secs(2)).expect("no event within 2s").paths;
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

    mod attribution {
        use super::*;
        use crate::activity::{Activity, Actor, Clock};
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        fn log_in(dir: &Path) -> (ActivityLog, Arc<AtomicU64>) {
            let t = Arc::new(AtomicU64::new(10_000));
            let t2 = t.clone();
            let clock: Clock = Arc::new(move || t2.load(Ordering::SeqCst));
            (ActivityLog::load(dir.join("cfg").join("a.json"), dir, clock, None), t)
        }

        fn touch(dir: &Path, rels: &[&str]) {
            for r in rels {
                let p = dir.join(r);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, "x").unwrap();
            }
        }

        fn paths(p: &[&str]) -> Vec<String> {
            p.iter().map(|s| s.to_string()).collect()
        }

        #[test]
        fn own_write_with_remote_on_stays_tu() {
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Ropa/n.md"]);
            let (log, _) = log_in(d.path());
            log.record_own("Ropa/n.md");
            attribute_batch(&log, d.path(), &paths(&["Ropa/n.md"]), |_| false, true);
            assert_eq!(log.snapshot()["Ropa/n.md"].by, Actor::Tu);
        }

        #[test]
        fn echo_after_own_write_within_window_stays_tu() {
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Ropa/n.md"]);
            let (log, t) = log_in(d.path());
            log.record_own("Ropa/n.md");
            t.store(11_900, Ordering::SeqCst);
            attribute_batch(&log, d.path(), &paths(&["Ropa/n.md"]), |_| true, true);
            assert_eq!(log.snapshot()["Ropa/n.md"], Activity { at: 10_000, by: Actor::Tu });
        }

        #[test]
        fn outside_write_with_remote_on_is_claude_cel() {
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Ropa/n.md"]);
            let (log, _) = log_in(d.path());
            attribute_batch(&log, d.path(), &paths(&["Ropa/n.md"]), |_| false, true);
            assert_eq!(log.snapshot()["Ropa/n.md"].by, Actor::ClaudeCel);
        }

        #[test]
        fn chat_running_in_one_space_splits_by_space() {
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Ropa/a.md", "Otro/b.md"]);
            let (log, _) = log_in(d.path());
            attribute_batch(&log, d.path(), &paths(&["Ropa/a.md", "Otro/b.md"]), |s| s == "Ropa", true);
            let snap = log.snapshot();
            assert_eq!(snap["Ropa/a.md"].by, Actor::Claude);
            assert_eq!(snap["Otro/b.md"].by, Actor::ClaudeCel);
        }

        #[test]
        fn accented_space_matches_the_running_chat_in_nfd_and_nfc() {
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Diseño/a.md"]);
            let (log, _) = log_in(d.path());
            let nfd = "Dise\u{6e}\u{303}o"; // n + combining tilde
            let running = nfc(&nfd);
            assert_ne!(nfd, "Diseño");
            attribute_batch(&log, d.path(), &paths(&[&format!("{nfd}/a.md")]), |s| s == running, false);
            assert!(log.snapshot().values().all(|a| a.by == Actor::Claude), "{:?}", log.snapshot());
        }

        #[test]
        fn metadata_only_events_are_never_attributed() {
            use notify::event::{MetadataKind, ModifyKind};
            let d = tempfile::tempdir().unwrap();
            touch(d.path(), &["Ropa/n.md"]);
            let (log, _) = log_in(d.path());
            let roots = vec![d.path().to_path_buf()];
            let ev = notify::Event::new(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)))
                .add_path(d.path().join("Ropa/n.md"));
            let (mut all, mut content) = (BTreeSet::new(), BTreeSet::new());
            collect_event(&roots, &ev, &mut all, &mut content);
            let content: Vec<String> = content.into_iter().collect();
            attribute_batch(&log, d.path(), &content, |_| true, true);
            assert!(log.snapshot().is_empty());
        }
    }
}
