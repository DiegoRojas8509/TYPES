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
    /// Extra environment for the child (on top of the inherited one).
    pub env: Vec<(String, String)>,
}

/// Live plugin copy first, then the newest cached one.
pub fn find_cronista(home: &Path) -> Option<Cronista> {
    let live = home.join("Documents/CLAUDE/repositorio/plugins/sistema/scripts/cronista.py");
    let script = if live.is_file() { Some(live) } else { newest_cached(home) };
    let python = if Path::new("/usr/bin/python3").is_file() { "/usr/bin/python3" } else { "python3" };
    script.map(|script| Cronista { program: python.into(), script, env: vec![] })
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
    /// The diff was cut at 40 lines in `added` or `removed`.
    pub truncated: bool,
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
pub fn line_diff(old: &str, new: &str) -> (Vec<String>, Vec<String>, bool) {
    fn only_in(a: &str, b: &str) -> (Vec<String>, bool) {
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
        let cut = out.len() > MAX_DIFF_LINES;
        out.truncate(MAX_DIFF_LINES);
        (out, cut)
    }
    let (added, c1) = only_in(new, old);
    let (removed, c2) = only_in(old, new);
    (added, removed, c1 || c2)
}

fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn clip(s: &str) -> String {
    s.chars().take(MAX_ERROR_CHARS).collect()
}

/// Environment for the cronista under a GUI launch (Finder gives a minimal PATH): the claude binary's
/// folder first, then the usual tool folders and `~/.local/bin`; `CLAUDE_BIN` points at the binary.
pub fn build_env(claude: Option<&Path>, home: &Path) -> Vec<(String, String)> {
    let mut dirs: Vec<String> = Vec::new();
    if let Some(d) = claude.and_then(Path::parent) {
        dirs.push(d.to_string_lossy().into_owned());
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(String::from));
    dirs.push(home.join(".local/bin").to_string_lossy().into_owned());
    let mut env = vec![("PATH".to_string(), dirs.join(":"))];
    if let Some(c) = claude {
        env.push(("CLAUDE_BIN".into(), c.to_string_lossy().into_owned()));
    }
    env
}

/// Owns the cronista process and its whole process group: dropping it before the child finished
/// (timeout, error path) stops every descendant (cronista -> claude-cli.sh -> claude).
struct Running {
    child: std::process::Child,
    pgid: i32,
    done: bool,
}

impl Running {
    fn stop(&mut self) {
        // SAFETY: plain signal syscalls on a group we created and have not reaped yet.
        unsafe { libc::killpg(self.pgid, libc::SIGTERM) };
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until && matches!(self.child.try_wait(), Ok(None)) {
            std::thread::sleep(Duration::from_millis(30));
        }
        unsafe { libc::killpg(self.pgid, libc::SIGKILL) };
        let _ = self.child.wait();
        self.done = true;
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if !self.done {
            self.stop();
        }
    }
}

struct Output {
    stdout: String,
    stderr: String,
    success: bool,
}

/// Last ~300 chars of stderr without control characters.
fn tail(raw: &str) -> String {
    let clean: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let chars: Vec<char> = clean.trim().chars().collect();
    chars[chars.len().saturating_sub(MAX_ERROR_CHARS)..].iter().collect()
}

fn capture(pipe: Option<impl Read + Send + 'static>) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    if let Some(p) = pipe {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = p.take(MAX_OUTPUT).read_to_end(&mut buf);
            let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
        });
    }
    rx
}

/// Runs the script, returning its output, or a Spanish message if it timed out.
fn run_script(c: &Cronista, args: &[String], timeout: Duration) -> Result<std::result::Result<Output, String>> {
    use std::os::unix::process::CommandExt;
    let mut child = Command::new(&c.program)
        .arg(&c.script)
        .args(args)
        .envs(c.env.iter().map(|(k, v)| (k, v)))
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => AppError::Custom(NOT_INSTALLED.into()),
            _ => AppError::Io(e.to_string()),
        })?;
    let out_rx = capture(child.stdout.take());
    let err_rx = capture(child.stderr.take());
    let pgid = i32::try_from(child.id()).map_err(|_| AppError::Io("pid fuera de rango".into()))?;
    let mut run = Running { child, pgid, done: false };
    let deadline = Instant::now() + timeout;
    let status = loop {
        match run.child.try_wait()? {
            Some(st) => break st,
            None if Instant::now() >= deadline => {
                run.stop();
                return Ok(Err("El cronista tardó demasiado y se canceló. Inténtalo de nuevo.".into()));
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    };
    run.done = true;
    let wait = Duration::from_secs(2);
    Ok(Ok(Output {
        stdout: out_rx.recv_timeout(wait).unwrap_or_default(),
        stderr: err_rx.recv_timeout(wait).unwrap_or_default(),
        success: status.success(),
    }))
}

fn contents(v: &Value, key: &str, file: &str) -> String {
    v.get(key).and_then(|m| m.get(file)).and_then(Value::as_str).unwrap_or("").to_string()
}

fn parse_result(out: &Output) -> CloseTopicResult {
    let detail = tail(&out.stderr);
    let bad = || {
        if detail.is_empty() {
            CloseTopicResult::failed("El cronista devolvió una respuesta no válida.")
        } else {
            CloseTopicResult::failed(format!("El cronista falló: {detail}"))
        }
    };
    let Ok(v) = serde_json::from_str::<Value>(out.stdout.trim()) else { return bad() };
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        return match v.get("error").and_then(Value::as_str) {
            Some(why) => CloseTopicResult::failed(clip(why)),
            None if !out.success => bad(),
            None => CloseTopicResult::failed("El cronista no pudo guardar el tema."),
        };
    }
    let mut changes = Vec::new();
    for c in v.get("cambios").and_then(Value::as_array).into_iter().flatten() {
        let Some(file) = c.get("archivo").and_then(Value::as_str).filter(|f| is_cronista_file(f)) else { continue };
        let (added, removed, truncated) = line_diff(&contents(&v, "antes", file), &contents(&v, "despues", file));
        let removed_file = matches!(v.get("despues").and_then(|m| m.get(file)), Some(Value::Null));
        let action = if removed_file {
            "eliminado".to_string()
        } else {
            clip(c.get("accion").and_then(Value::as_str).unwrap_or("actualizado"))
        };
        changes.push(MemoryChange {
            file: file.to_string(),
            action,
            summary: clip(c.get("resumen").and_then(Value::as_str).unwrap_or("")),
            added,
            removed,
            truncated,
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
        Ok(out) => parse_result(&out),
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
    let mut cronista = find_cronista(&home);
    if let Some(c) = cronista.as_mut() {
        c.env = build_env(crate::claude::locate(&state.snapshot()).as_deref(), &home);
    }
    close_topic_in(&state.root(), &home, cronista.as_ref(), &lock, &space, &session_id, TIMEOUT)
}

#[cfg(test)]
#[path = "memory_close_tests.rs"]
mod tests;
