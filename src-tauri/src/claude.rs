//! Locates Claude Code, runs it once per message and relays its stream-json output.

use crate::error::{AppError, Result};
use crate::settings::{AppState, Settings};
use crate::workspace;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const ALLOWED_TOOLS: &str = "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash,Skill,Agent,NotebookEdit";

// ---------- binary lookup (pure) ----------

fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.split('.');
    let v = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    if it.next().is_some() { None } else { Some(v) }
}

/// Newest `anthropic.claude-code-<ver>-*` extension that really contains the binary.
pub fn newest_vscode_binary(extensions_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(extensions_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let rest = name.strip_prefix("anthropic.claude-code-")?;
            let ver = parse_version(rest.split('-').next()?)?;
            let bin = e.path().join("resources").join("native-binary").join("claude");
            bin.is_file().then_some((ver, bin))
        })
        .max_by_key(|(v, _)| *v)
        .map(|(_, bin)| bin)
}

/// Order: manual path from settings, `claude` on the login-shell PATH, newest VS Code extension.
pub fn find_claude(
    settings: &Settings,
    home: &Path,
    path_lookup: impl Fn() -> Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(p) = settings.claude_path.as_ref().filter(|p| p.is_file()) {
        return Some(p.clone());
    }
    if let Some(p) = path_lookup().filter(|p| p.is_file()) {
        return Some(p);
    }
    newest_vscode_binary(&home.join(".vscode").join("extensions"))
}

/// Production `path_lookup`: asks the login shell, since GUI apps get a bare PATH.
pub fn shell_lookup() -> Option<PathBuf> {
    let out = Command::new("zsh")
        .args(["-lc", "command -v claude"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).lines().last()?.trim().to_string();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

// ---------- arguments (pure) ----------

/// The prompt is passed after `--` so it can never be taken for an option value
/// (`--allowedTools` is variadic) or for a flag when the text starts with `-`.
/// With `board` (path relative to the space folder, the agent's cwd) the prompt starts with
/// `Pizarra abierta: <board>` so Claude knows which whiteboard Diego is looking at.
pub fn build_args(
    text: &str,
    attachments: &[String],
    session_id: Option<&str>,
    model: Option<&str>,
    board: Option<&str>,
) -> Vec<String> {
    let mut prompt = match board {
        Some(b) => format!("Pizarra abierta: {b}\n\n{text}"),
        None => text.to_string(),
    };
    if !attachments.is_empty() {
        prompt.push_str("\n\nArchivos adjuntos (léelos con Read):");
        for a in attachments {
            prompt.push_str("\n- ");
            prompt.push_str(a);
        }
    }
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        ALLOWED_TOOLS,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    // Alias (`opus`, `sonnet`, `haiku`) or full id; anything odd is ignored so it can't act as a flag.
    if let Some(m) = model.filter(|m| !m.is_empty() && !m.starts_with('-') && m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '[' | ']'))) {
        args.push("--model".into());
        args.push(m.into());
    }
    if let Some(id) = session_id {
        args.push("--resume".into());
        args.push(id.into());
    }
    args.push("--".into());
    args.push(prompt);
    args
}

// ---------- stream lines (pure) ----------

/// Payload of the `claude-event` event, as JS sees it:
/// `{ runId, kind: "raw", line }`, `{ runId, kind: "stderr", text }`, `{ runId, kind: "exit", code }`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ClaudeEvent {
    Raw { run_id: u32, line: serde_json::Value },
    Stderr { run_id: u32, text: String },
    Exit { run_id: u32, code: Option<i32> },
}

/// A JSON object line becomes `Raw`; anything else is forwarded as `Stderr`; blanks are dropped.
pub fn classify_line(run_id: u32, line: &str) -> Option<ClaudeEvent> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    match serde_json::from_str::<serde_json::Value>(t) {
        Ok(v) if v.is_object() => Some(ClaudeEvent::Raw { run_id, line: v }),
        _ => Some(ClaudeEvent::Stderr { run_id, text: t.to_string() }),
    }
}

// ---------- runtime ----------

#[derive(Default)]
pub struct ClaudeState {
    next_id: AtomicU32,
    runs: Mutex<HashMap<u32, Arc<Mutex<Child>>>>,
}

impl ClaudeState {
    fn runs(&self) -> std::sync::MutexGuard<'_, HashMap<u32, Arc<Mutex<Child>>>> {
        self.runs.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Kills every running child (used on app exit). The waiter threads reap them.
    pub fn kill_all(&self) {
        let children: Vec<_> = self.runs().values().cloned().collect();
        for c in children {
            let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub(crate) fn locate(settings: &Settings) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    find_claude(settings, &home, shell_lookup)
}

fn claude_not_found() -> AppError {
    AppError::ClaudeNotFound
}

/// `<bin> --version` with a hard 5 s limit so a broken binary cannot hang the app.
fn read_version(bin: &Path) -> Option<String> {
    let mut child = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut child.stdout.take()?, &mut s).ok()?;
                return Some(s.trim().to_string()).filter(|s| !s.is_empty());
            }
            Some(_) => return None,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

#[tauri::command(async)]
pub fn claude_status(state: State<AppState>) -> ClaudeStatus {
    match locate(&state.snapshot()) {
        Some(p) => ClaudeStatus {
            found: true,
            version: read_version(&p),
            path: Some(p.to_string_lossy().into_owned()),
        },
        None => ClaudeStatus { found: false, path: None, version: None },
    }
}

#[tauri::command(async)]
pub fn claude_send(
    app: AppHandle,
    state: State<AppState>,
    claude: State<ClaudeState>,
    space: String,
    text: String,
    attachments: Vec<String>,
    session_id: Option<String>,
    model: Option<String>,
    board: Option<String>,
) -> Result<u32> {
    let cwd = workspace::resolve(&state.root(), &space)?;
    if !cwd.is_dir() {
        return Err(AppError::Invalid("el espacio no es una carpeta".into()));
    }
    let bin = locate(&state.snapshot()).ok_or_else(claude_not_found)?;
    let args = build_args(&text, &attachments, session_id.as_deref(), model.as_deref(), board.as_deref());
    let mut child = Command::new(&bin)
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => AppError::ClaudeNotFound,
            _ => AppError::Io(e.to_string()),
        })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let run_id = claude.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let child = Arc::new(Mutex::new(child));
    claude.runs().insert(run_id, child.clone());

    let emit = move |app: &AppHandle, ev: ClaudeEvent| {
        let _ = app.emit("claude-event", ev);
    };
    let out_thread = stdout.map(|out| {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                if let Some(ev) = classify_line(run_id, &line) {
                    emit(&app, ev);
                }
            }
        })
    });
    let err_thread = stderr.map(|err| {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(|l| l.ok()) {
                let t = line.trim();
                if !t.is_empty() {
                    emit(&app, ClaudeEvent::Stderr { run_id, text: t.to_string() });
                }
            }
        })
    });
    // Waiter: polls (never holds the lock while blocking, so `claude_stop` can kill),
    // reaps the child, drains the readers, then announces the exit.
    let app2 = app.clone();
    std::thread::spawn(move || {
        let code = loop {
            let status = child.lock().unwrap_or_else(|e| e.into_inner()).try_wait();
            match status {
                Ok(Some(s)) => break s.code(),
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => break None,
            }
        };
        for t in [out_thread, err_thread].into_iter().flatten() {
            let _ = t.join();
        }
        app2.state::<ClaudeState>().runs().remove(&run_id);
        emit(&app2, ClaudeEvent::Exit { run_id, code });
    });
    Ok(run_id)
}

#[tauri::command(async)]
pub fn claude_stop(claude: State<ClaudeState>, run_id: u32) {
    let child = claude.runs().get(&run_id).cloned();
    if let Some(c) = child {
        let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_ext(dir: &Path, name: &str) -> PathBuf {
        let bin = dir.join(name).join("resources").join("native-binary").join("claude");
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, "").unwrap();
        bin
    }

    #[test]
    fn newest_vscode_binary_picks_highest_semver() {
        let d = tempfile::tempdir().unwrap();
        fake_ext(d.path(), "anthropic.claude-code-2.1.99-darwin-arm64");
        let want = fake_ext(d.path(), "anthropic.claude-code-2.1.296-darwin-arm64");
        fake_ext(d.path(), "other.ext-9.9.9");
        std::fs::create_dir_all(d.path().join("anthropic.claude-code-3.0.0-darwin-arm64")).unwrap(); // no binary
        assert_eq!(newest_vscode_binary(d.path()), Some(want));
    }

    #[test]
    fn find_claude_prefers_manual_then_path_then_vscode() {
        let home = tempfile::tempdir().unwrap();
        let vs = fake_ext(&home.path().join(".vscode").join("extensions"), "anthropic.claude-code-2.1.1-darwin-arm64");
        let manual = home.path().join("manual-claude");
        let on_path = home.path().join("path-claude");
        std::fs::write(&manual, "").unwrap();
        std::fs::write(&on_path, "").unwrap();
        let mut s = Settings::default_for_home(home.path());
        s.claude_path = Some(manual.clone());
        assert_eq!(find_claude(&s, home.path(), || Some(on_path.clone())), Some(manual));
        s.claude_path = None;
        assert_eq!(find_claude(&s, home.path(), || Some(on_path.clone())), Some(on_path));
        assert_eq!(find_claude(&s, home.path(), || None), Some(vs));
        // A manual path that no longer exists falls through.
        s.claude_path = Some(home.path().join("gone"));
        assert!(find_claude(&s, home.path(), || None).is_some());
    }

    #[test]
    fn find_claude_none_when_nothing() {
        let home = tempfile::tempdir().unwrap();
        let s = Settings::default_for_home(home.path());
        assert_eq!(find_claude(&s, home.path(), || None), None);
    }

    #[test]
    fn build_args_has_required_flags_and_bash() {
        let a = build_args("Responde solo: ok", &[], None, None, None);
        assert_eq!(a.first().map(String::as_str), Some("-p"));
        for f in ["--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits", "--allowedTools"] {
            assert!(a.iter().any(|x| x == f), "missing {f}");
        }
        assert!(a.contains(&ALLOWED_TOOLS.to_string()));
        assert!(ALLOWED_TOOLS.split(',').any(|x| x == "Bash"));
        assert!(!a.iter().any(|x| x == "--resume"));
        // The prompt is the last argument, behind `--`.
        let n = a.len();
        assert_eq!(a[n - 2], "--");
        assert_eq!(a[n - 1], "Responde solo: ok");
    }

    #[test]
    fn build_args_adds_model_only_when_safe() {
        let a = build_args("hola", &[], None, Some("opus"), None);
        let i = a.iter().position(|x| x == "--model").expect("--model");
        assert_eq!(a[i + 1], "opus");
        for bad in ["", "--version", "a b", "x;y"] {
            assert!(!build_args("hola", &[], None, Some(bad), None).iter().any(|x| x == "--model"), "{bad}");
        }
        assert!(!build_args("hola", &[], None, None, None).iter().any(|x| x == "--model"));
    }

    #[test]
    fn build_args_adds_resume() {
        let a = build_args("hola", &[], Some("abc-123"), None, None);
        let i = a.iter().position(|x| x == "--resume").unwrap();
        assert_eq!(a[i + 1], "abc-123");
        assert!(i < a.iter().position(|x| x == "--").unwrap());
    }

    #[test]
    fn build_args_lists_attachments() {
        let a = build_args("mira", &["Ropa/adjuntos/a b.png".into(), "Ropa/adjuntos/c.png".into()], None, None, None);
        assert_eq!(
            a.last().unwrap(),
            "mira\n\nArchivos adjuntos (léelos con Read):\n- Ropa/adjuntos/a b.png\n- Ropa/adjuntos/c.png"
        );
    }

    #[test]
    fn build_args_puts_the_open_board_before_the_message() {
        let a = build_args("agrega una tabla", &[], None, None, Some("Plan.canvas"));
        assert_eq!(a.last().unwrap(), "Pizarra abierta: Plan.canvas\n\nagrega una tabla");
        let n = a.len();
        assert_eq!(a[n - 2], "--");
        // Every flag is still there.
        let without = build_args("agrega una tabla", &[], None, None, None);
        assert_eq!(a[..n - 1], without[..without.len() - 1]);
    }

    #[test]
    fn build_args_without_board_is_unchanged() {
        let a = build_args("hola", &[], None, None, None);
        assert_eq!(a.last().unwrap(), "hola");
        assert!(!a.last().unwrap().contains("Pizarra abierta"));
    }

    #[test]
    fn build_args_board_and_attachments_compose() {
        let a = build_args("mira", &["adjuntos/a.png".into()], Some("s1"), Some("opus"), Some("sub/Plan.canvas"));
        assert_eq!(
            a.last().unwrap(),
            "Pizarra abierta: sub/Plan.canvas\n\nmira\n\nArchivos adjuntos (léelos con Read):\n- adjuntos/a.png"
        );
        assert!(a.iter().any(|x| x == "--resume"));
        assert!(a.iter().any(|x| x == "--model"));
    }

    #[test]
    fn build_args_board_name_is_passed_verbatim() {
        let name = r#"Mi "plan" (v2) $HOME;x.canvas"#;
        let a = build_args("hola", &[], None, None, Some(name));
        assert_eq!(a.last().unwrap(), &format!("Pizarra abierta: {name}\n\nhola"));
        // A board name that looks like a flag still sits behind `--`.
        let b = build_args("hola", &[], None, None, Some("--version"));
        assert_eq!(b[b.len() - 2], "--");
        assert_eq!(b.last().unwrap(), "Pizarra abierta: --version\n\nhola");
    }

    #[test]
    fn build_args_prompt_starting_with_dash_is_safe() {
        let a = build_args("--version", &[], None, None, None);
        assert_eq!(&a[a.len() - 2..], ["--", "--version"]);
    }

    #[test]
    fn classify_line_json_object_is_raw() {
        let ev = classify_line(3, r#"{"type":"result","subtype":"success"}"#).unwrap();
        assert_eq!(ev, ClaudeEvent::Raw { run_id: 3, line: serde_json::json!({"type":"result","subtype":"success"}) });
    }

    #[test]
    fn classify_line_non_json_is_stderr_and_blank_dropped() {
        assert_eq!(classify_line(1, "boom"), Some(ClaudeEvent::Stderr { run_id: 1, text: "boom".into() }));
        assert_eq!(classify_line(1, "42"), Some(ClaudeEvent::Stderr { run_id: 1, text: "42".into() }));
        assert_eq!(classify_line(1, "  \n"), None);
    }

    #[test]
    fn event_payloads_are_camel_case_with_kind() {
        let raw = serde_json::to_value(ClaudeEvent::Raw { run_id: 7, line: serde_json::json!({"a":1}) }).unwrap();
        assert_eq!(raw, serde_json::json!({"kind":"raw","runId":7,"line":{"a":1}}));
        let err = serde_json::to_value(ClaudeEvent::Stderr { run_id: 7, text: "x".into() }).unwrap();
        assert_eq!(err, serde_json::json!({"kind":"stderr","runId":7,"text":"x"}));
        let exit = serde_json::to_value(ClaudeEvent::Exit { run_id: 7, code: None }).unwrap();
        assert_eq!(exit, serde_json::json!({"kind":"exit","runId":7,"code":null}));
    }

    #[test]
    fn status_serializes_camel_case() {
        let v = serde_json::to_value(ClaudeStatus { found: false, path: None, version: None }).unwrap();
        assert_eq!(v, serde_json::json!({"found":false,"path":null,"version":null}));
    }
}
