//! «Cerrar tema»: runs the cronista (`cronista.py --now`) on a conversation and reports the real
//! line diff of the memory files it touched.
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, Result};
use crate::memory::{is_cronista_file, slug_for, space_dir};
use crate::settings::AppState;

const TIMEOUT: Duration = Duration::from_secs(150);
const MAX_DIFF_LINES: usize = 40;
const MAX_OUTPUT: u64 = 4 * 1024 * 1024;
const MAX_ERROR_CHARS: usize = 300;
const NOT_INSTALLED: &str = "El cronista no está instalado. Revisa el plugin sistema.";

/// How to launch the cronista: `<program> <script> --now …` (injectable for tests).
#[derive(Debug, Clone)]
pub struct Cronista {
    pub program: String,
    pub script: PathBuf,
}

/// Live plugin copy first, then the newest cached one.
pub fn find_cronista(home: &Path) -> Option<Cronista> {
    let live = home.join("Documents/CLAUDE/repositorio/plugins/sistema/scripts/cronista.py");
    let script = if live.is_file() { Some(live) } else { newest_cached(home) };
    script.map(|script| Cronista { program: "python3".into(), script })
}

fn newest_cached(home: &Path) -> Option<PathBuf> {
    let base = home.join(".claude/plugins/cache/bastian/sistema");
    std::fs::read_dir(base)
        .ok()?
        .flatten()
        .map(|e| e.path().join("scripts/cronista.py"))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .max_by_key(|(m, _)| *m)
        .map(|(_, p)| p)
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryChange {
    pub file: String,
    pub action: String,
    pub summary: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTopicResult {
    pub ok: bool,
    pub changes: Vec<MemoryChange>,
    pub error: Option<String>,
    pub nothing_to_save: bool,
}

impl CloseTopicResult {
    fn failed(msg: impl Into<String>) -> Self {
        Self { ok: false, changes: vec![], error: Some(msg.into()), nothing_to_save: false }
    }
}

/// Only one close-topic at a time.
#[derive(Default)]
pub struct CloseState(pub(crate) Mutex<()>);

/// Lines added / removed between two texts (multiset comparison, blank lines ignored, capped).
pub fn line_diff(old: &str, new: &str) -> (Vec<String>, Vec<String>) {
    fn only_in(a: &str, b: &str) -> Vec<String> {
        let mut pool: HashMap<&str, usize> = HashMap::new();
        for l in b.lines().filter(|l| !l.trim().is_empty()) {
            *pool.entry(l).or_default() += 1;
        }
        let mut out = Vec::new();
        for l in a.lines().filter(|l| !l.trim().is_empty()) {
            match pool.get_mut(l) {
                Some(n) if *n > 0 => *n -= 1,
                _ => out.push(l.to_string()),
            }
        }
        out.truncate(MAX_DIFF_LINES);
        out
    }
    (only_in(new, old), only_in(old, new))
}

fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn clip(s: &str) -> String {
    s.chars().take(MAX_ERROR_CHARS).collect()
}

/// Runs the script, returning its stdout, or a Spanish message if it timed out.
fn run_script(c: &Cronista, args: &[String], timeout: Duration) -> Result<std::result::Result<String, String>> {
    let mut child = Command::new(&c.program)
        .arg(&c.script)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => AppError::Custom(NOT_INSTALLED.into()),
            _ => AppError::Io(e.to_string()),
        })?;
    let (tx, rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = out.take(MAX_OUTPUT).read_to_string(&mut buf);
            let _ = tx.send(buf);
        });
    }
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait()? {
            Some(_) => break,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(Err("El cronista tardó demasiado y se canceló. Inténtalo de nuevo.".into()));
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    }
    Ok(Ok(rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default()))
}

fn contents(v: &Value, key: &str, file: &str) -> String {
    v.get(key).and_then(|m| m.get(file)).and_then(Value::as_str).unwrap_or("").to_string()
}

fn parse_result(stdout: &str) -> CloseTopicResult {
    let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) else {
        return CloseTopicResult::failed("El cronista devolvió una respuesta no válida.");
    };
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        let why = v.get("error").and_then(Value::as_str).unwrap_or("El cronista no pudo guardar el tema.");
        return CloseTopicResult::failed(clip(why));
    }
    let mut changes = Vec::new();
    for c in v.get("cambios").and_then(Value::as_array).into_iter().flatten() {
        let Some(file) = c.get("archivo").and_then(Value::as_str).filter(|f| is_cronista_file(f)) else { continue };
        let (added, removed) = line_diff(&contents(&v, "antes", file), &contents(&v, "despues", file));
        changes.push(MemoryChange {
            file: file.to_string(),
            action: clip(c.get("accion").and_then(Value::as_str).unwrap_or("actualizado")),
            summary: clip(c.get("resumen").and_then(Value::as_str).unwrap_or("")),
            added,
            removed,
        });
    }
    CloseTopicResult { ok: true, changes, error: None, nothing_to_save: false }
}

pub fn close_topic_in(
    root: &Path,
    home: &Path,
    cronista: Option<&Cronista>,
    state: &CloseState,
    space: &str,
    session_id: &str,
    timeout: Duration,
) -> Result<CloseTopicResult> {
    if !valid_session_id(session_id) {
        return Err(AppError::Invalid("identificador de conversación no válido".into()));
    }
    let cwd = space_dir(root, space)?;
    let _guard = match state.0.try_lock() {
        Ok(g) => g,
        Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
        Err(std::sync::TryLockError::WouldBlock) => return Err(AppError::Custom("Ya se está guardando el tema.".into())),
    };
    let slug = slug_for(&cwd).ok_or_else(|| AppError::Invalid("la ruta del espacio es demasiado larga para su memoria".into()))?;
    let transcript = home.join(".claude/projects").join(slug).join(format!("{session_id}.jsonl"));
    if !transcript.is_file() {
        return Ok(CloseTopicResult { ok: true, changes: vec![], error: None, nothing_to_save: true });
    }
    let c = cronista.filter(|c| c.script.is_file()).ok_or_else(|| AppError::Custom(NOT_INSTALLED.into()))?;
    let args = ["--now", "--transcript", &transcript.to_string_lossy(), "--cwd", &cwd.to_string_lossy()].map(String::from);
    Ok(match run_script(c, &args, timeout)? {
        Ok(stdout) => parse_result(&stdout),
        Err(msg) => CloseTopicResult::failed(msg),
    })
}

#[tauri::command(async)]
pub fn memory_close_topic(
    state: State<AppState>,
    lock: State<CloseState>,
    space: String,
    session_id: String,
) -> Result<CloseTopicResult> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Io("no encuentro la carpeta personal".into()))?;
    let cronista = find_cronista(&home);
    close_topic_in(&state.root(), &home, cronista.as_ref(), &lock, &space, &session_id, TIMEOUT)
}

#[cfg(test)]
#[path = "memory_close_tests.rs"]
mod tests;
