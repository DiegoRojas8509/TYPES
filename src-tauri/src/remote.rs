//! `claude remote-control` as a child process, so Diego can drive a session over his notes from the phone.

use crate::claude;
use crate::error::{AppError, Result};
use crate::settings::AppState;
use serde::Serialize;
use std::io::{BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const MSG_NO_CLAUDE: &str = "No encuentro Claude Code. Instálalo o indica su ruta en los ajustes.";
const TRUST_NOTE: &str = "Responde y y Enter a las dos preguntas. Cuando diga Connected, cierra esta ventana con Ctrl+C y vuelve a Types.";
const TRUST_FILE: &str = "confiar-control-remoto.command";
const SESSION_URL: &str = "https://claude.ai/code/session_";
const ENV_URL: &str = "https://claude.ai/code?environment=";

// ---------- pure helpers ----------

pub fn build_remote_args() -> Vec<String> {
    ["remote-control", "--name", "Types", "--permission-mode", "acceptEdits"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Removes CSI (`ESC [ … final`) and OSC (`ESC ] … BEL | ESC \`) sequences and stray two-byte escapes.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('[') => {
                for n in it.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(n) = it.next() {
                    if n == '\u{7}' {
                        break;
                    }
                    if n == '\u{1b}' {
                        it.next_if_eq(&'\\');
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// URLs carried as the parameter of OSC-8 hyperlinks (`ESC ] 8 ; ; URL ST`).
fn osc8_urls(s: &str) -> Vec<String> {
    s.split("\u{1b}]8;")
        .skip(1)
        .filter_map(|rest| {
            let after_params = rest.split_once(';')?.1;
            let end = after_params.find(['\u{7}', '\u{1b}'])?;
            Some(after_params[..end].to_string()).filter(|u| u.starts_with("https://"))
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteSignal {
    Connecting,
    Connected,
    Url(String),
    Untrusted,
    Error(String),
}

fn find_url(text: &str) -> Option<String> {
    for prefix in [SESSION_URL, ENV_URL] {
        if let Some(i) = text.find(prefix) {
            let tail = &text[i..];
            let end = tail.find(|c: char| c.is_whitespace() || c == '\u{1b}' || c == '\u{7}').unwrap_or(tail.len());
            return Some(tail[..end].trim_end_matches(['.', ',', ')']).to_string());
        }
    }
    None
}

pub fn parse_line(raw: &str) -> Option<RemoteSignal> {
    let line = strip_ansi(raw);
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    if line.contains("Workspace not trusted") {
        return Some(RemoteSignal::Untrusted);
    }
    if let Some(u) = find_url(line).or_else(|| osc8_urls(raw).iter().find_map(|u| find_url(u))) {
        return Some(RemoteSignal::Url(u));
    }
    if line.contains("Connecting") {
        return Some(RemoteSignal::Connecting);
    }
    if line.contains("Connected") {
        return Some(RemoteSignal::Connected);
    }
    line.strip_prefix("Error:").map(|m| RemoteSignal::Error(m.trim().to_string()))
}

/// zsh `.command` script that walks Diego through the one-time trust and consent prompts.
pub fn trust_script(root: &Path, bin: &Path) -> String {
    let q = |p: &Path| format!("'{}'", p.to_string_lossy().replace('\'', r"'\''"));
    format!(
        "#!/bin/zsh\necho '{TRUST_NOTE}'\ncd {} || exit 1\n{} remote-control --name Types\n",
        q(root),
        q(bin)
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum RemoteStatus {
    #[default]
    Off,
    Starting,
    On {
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    Untrusted,
    Error {
        message: String,
    },
}

fn is_session_url(u: &str) -> bool {
    u.starts_with(SESSION_URL)
}

/// Next status after a signal, or `None` when nothing changes (redraws and duplicates).
pub fn apply_signal(current: &RemoteStatus, sig: &RemoteSignal) -> Option<RemoteStatus> {
    let next = match (current, sig) {
        (RemoteStatus::Starting, RemoteSignal::Connecting) => return None,
        (_, RemoteSignal::Connecting) => return None,
        (RemoteStatus::On { .. }, RemoteSignal::Connected) => return None,
        (_, RemoteSignal::Connected) => RemoteStatus::On { url: None },
        (RemoteStatus::On { url: Some(old) }, RemoteSignal::Url(u)) if is_session_url(old) || !is_session_url(u) => {
            return None;
        }
        (_, RemoteSignal::Url(u)) => RemoteStatus::On { url: Some(u.clone()) },
        (_, RemoteSignal::Untrusted) => RemoteStatus::Untrusted,
        (RemoteStatus::On { .. }, RemoteSignal::Error(_)) => return None,
        (_, RemoteSignal::Error(m)) => RemoteStatus::Error { message: m.clone() },
    };
    (&next != current).then_some(next)
}

// ---------- state & process control ----------

#[derive(Default)]
struct Inner {
    status: RemoteStatus,
    child: Option<Arc<Mutex<Child>>>,
    caffeinate: Option<Child>,
    last_stderr: Option<String>,
    generation: u64,
}

#[derive(Default)]
pub struct RemoteState {
    inner: Mutex<Inner>,
}

impl RemoteState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn status(&self) -> RemoteStatus {
        self.lock().status.clone()
    }

    /// Sets the status and tells the UI, only when it really changed.
    fn set(&self, app: &AppHandle, next: RemoteStatus) {
        let changed = {
            let mut g = self.lock();
            let changed = g.status != next;
            g.status = next.clone();
            changed
        };
        if changed {
            let _ = app.emit("remote-event", next);
        }
    }

    fn feed(&self, app: &AppHandle, run: u64, line: &str, is_stderr: bool) {
        let next = {
            let mut g = self.lock();
            if g.generation != run {
                return;
            }
            match parse_line(line) {
                Some(sig) => apply_signal(&g.status, &sig),
                None => {
                    if is_stderr && !line.trim().is_empty() {
                        g.last_stderr = Some(strip_ansi(line).trim().to_string());
                    }
                    None
                }
            }
        };
        if let Some(n) = next {
            self.set(app, n);
        }
    }

    /// SIGINT to the process group, then SIGKILL after ~3 s. Leaves the status `Off`.
    pub fn stop(&self, app: &AppHandle) {
        let (child, caff) = {
            let mut g = self.lock();
            g.generation += 1;
            (g.child.take(), g.caffeinate.take())
        };
        if let Some(child) = child {
            let pid = child.lock().unwrap_or_else(|e| e.into_inner()).id() as libc::pid_t;
            unsafe { libc::killpg(pid, libc::SIGINT) };
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let done = matches!(child.lock().unwrap_or_else(|e| e.into_inner()).try_wait(), Ok(Some(_)) | Err(_));
                if done {
                    break;
                }
                if Instant::now() >= deadline {
                    unsafe { libc::killpg(pid, libc::SIGKILL) };
                    let _ = child.lock().unwrap_or_else(|e| e.into_inner()).wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
        }
        if let Some(mut c) = caff {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.set(app, RemoteStatus::Off);
    }
}

fn pump(reader: impl Read, app: AppHandle, run: u64, is_stderr: bool) {
    let mut buf: Vec<u8> = Vec::new();
    let flush = |buf: &mut Vec<u8>| {
        if !buf.is_empty() {
            let line = String::from_utf8_lossy(buf).into_owned();
            buf.clear();
            app.state::<RemoteState>().feed(&app, run, &line, is_stderr);
        }
    };
    for b in BufReader::new(reader).bytes().map_while(|b| b.ok()) {
        if b == b'\n' || b == b'\r' {
            flush(&mut buf);
        } else {
            buf.push(b);
        }
    }
    flush(&mut buf);
}

#[tauri::command]
pub fn remote_status(remote: State<RemoteState>) -> RemoteStatus {
    remote.status()
}

#[tauri::command(async)]
pub fn remote_start(app: AppHandle, state: State<AppState>, remote: State<RemoteState>) -> Result<RemoteStatus> {
    {
        let g = remote.lock();
        if g.child.is_some() && matches!(g.status, RemoteStatus::Starting | RemoteStatus::On { .. }) {
            return Ok(g.status.clone());
        }
    }
    // Drop any leftover (e.g. an Untrusted run that is still being reaped).
    if remote.lock().child.is_some() {
        remote.stop(&app);
    }
    let fail = |msg: String| {
        remote.set(&app, RemoteStatus::Error { message: msg });
        remote.status()
    };
    let settings = state.snapshot();
    let root = settings.workspace_root.clone();
    let Some(bin) = claude::locate(&settings) else {
        return Ok(fail(MSG_NO_CLAUDE.into()));
    };
    if !root.is_dir() {
        return Ok(fail("La carpeta de trabajo no existe.".into()));
    }
    let mut cmd = Command::new(&bin);
    cmd.args(build_remote_args())
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(fail(format!("No pude iniciar Claude Code: {e}"))),
    };
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let caffeinate = Command::new("/usr/bin/caffeinate")
        .args(["-i", "-w", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();
    let child = Arc::new(Mutex::new(child));
    let run = {
        let mut g = remote.lock();
        g.generation += 1;
        g.child = Some(child.clone());
        g.caffeinate = caffeinate;
        g.last_stderr = None;
        g.generation
    };
    remote.set(&app, RemoteStatus::Starting);

    let readers: Vec<_> = [(stdout.map(|s| Box::new(s) as Box<dyn Read + Send>), false), (stderr.map(|s| Box::new(s) as Box<dyn Read + Send>), true)]
        .into_iter()
        .filter_map(|(r, is_err)| {
            let r = r?;
            let app = app.clone();
            Some(std::thread::spawn(move || pump(r, app, run, is_err)))
        })
        .collect();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let code = loop {
            let st = child.lock().unwrap_or_else(|e| e.into_inner()).try_wait();
            match st {
                Ok(Some(s)) => break s.code(),
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => break None,
            }
        };
        for t in readers {
            let _ = t.join();
        }
        let remote = app2.state::<RemoteState>();
        let (next, caff) = {
            let mut g = remote.lock();
            if g.generation != run {
                return; // stopped or replaced: `stop` already settled the status
            }
            g.child = None;
            let next = match &g.status {
                RemoteStatus::Untrusted => RemoteStatus::Untrusted,
                RemoteStatus::Starting if code != Some(0) => RemoteStatus::Error {
                    message: g
                        .last_stderr
                        .clone()
                        .unwrap_or_else(|| format!("Claude Code se cerró antes de conectar (código {}).", code.map_or("?".into(), |c| c.to_string()))),
                },
                RemoteStatus::Error { message } => RemoteStatus::Error { message: message.clone() },
                _ => RemoteStatus::Off,
            };
            (next, g.caffeinate.take())
        };
        if let Some(mut c) = caff {
            let _ = c.kill();
            let _ = c.wait();
        }
        remote.set(&app2, next);
    });
    Ok(remote.status())
}

#[tauri::command(async)]
pub fn remote_stop(app: AppHandle, remote: State<RemoteState>) -> RemoteStatus {
    remote.stop(&app);
    remote.status()
}

#[tauri::command(async)]
pub fn remote_trust(app: AppHandle, state: State<AppState>) -> Result<()> {
    let settings = state.snapshot();
    let bin = claude::locate(&settings).ok_or(AppError::ClaudeNotFound)?;
    let dir = app.path().app_data_dir().map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let file = dir.join(TRUST_FILE);
    std::fs::write(&file, trust_script(&settings.workspace_root, &bin)).map_err(|e| AppError::Io(e.to_string()))?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).map_err(|e| AppError::Io(e.to_string()))?;
    }
    Command::new("/usr/bin/open").arg(&file).spawn().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn args_exact() {
        assert_eq!(build_remote_args(), ["remote-control", "--name", "Types", "--permission-mode", "acceptEdits"]);
    }

    #[test]
    fn strips_csi_and_osc8() {
        let s = "\u{1b}[2K\u{1b}[32m·✔︎· Connected\u{1b}[0m \u{1b}]8;;https://x.y/z\u{7}link\u{1b}]8;;\u{7} \u{1b}]8;;https://a.b\u{1b}\\t\u{1b}]8;;\u{1b}\\!";
        assert_eq!(strip_ansi(s), "·✔︎· Connected link t!");
    }

    #[test]
    fn parses_sample_lines() {
        assert_eq!(parse_line("·|· Connecting · espacios · HEAD"), Some(RemoteSignal::Connecting));
        assert_eq!(parse_line("\u{1b}[2K·✔︎· Connected · espacios · HEAD"), Some(RemoteSignal::Connected));
        assert_eq!(parse_line("Capacity: 0/32 · foo"), None);
        assert_eq!(
            parse_line("Continue coding in the Claude mobile app or https://claude.ai/code?environment=env_01RBj35hd6MxNMCvchygtAGC"),
            Some(RemoteSignal::Url("https://claude.ai/code?environment=env_01RBj35hd6MxNMCvchygtAGC".into()))
        );
        assert_eq!(
            parse_line("Error: Workspace not trusted. Please run `claude` in /x first to review and accept the workspace trust dialog."),
            Some(RemoteSignal::Untrusted)
        );
        assert_eq!(parse_line("Error: boom"), Some(RemoteSignal::Error("boom".into())));
        assert_eq!(parse_line("   "), None);
    }

    #[test]
    fn parses_osc8_session_url() {
        let l = "\u{1b}]8;;https://claude.ai/code/session_01AbC\u{7}open session\u{1b}]8;;\u{7}";
        assert_eq!(parse_line(l), Some(RemoteSignal::Url("https://claude.ai/code/session_01AbC".into())));
        let l2 = "see https://claude.ai/code/session_01AbC.";
        assert_eq!(parse_line(l2), Some(RemoteSignal::Url("https://claude.ai/code/session_01AbC".into())));
    }

    #[test]
    fn prefers_session_url_and_dedupes() {
        let env = RemoteSignal::Url("https://claude.ai/code?environment=env_1".into());
        let ses = RemoteSignal::Url("https://claude.ai/code/session_1".into());
        let on_env = apply_signal(&RemoteStatus::Starting, &env).unwrap();
        assert_eq!(on_env, RemoteStatus::On { url: Some("https://claude.ai/code?environment=env_1".into()) });
        assert_eq!(apply_signal(&on_env, &env), None);
        let on_ses = apply_signal(&on_env, &ses).unwrap();
        assert_eq!(on_ses, RemoteStatus::On { url: Some("https://claude.ai/code/session_1".into()) });
        assert_eq!(apply_signal(&on_ses, &env), None);
        assert_eq!(apply_signal(&on_ses, &ses), None);
        assert_eq!(apply_signal(&on_ses, &RemoteSignal::Connected), None);
        assert_eq!(apply_signal(&on_ses, &RemoteSignal::Connecting), None);
        assert_eq!(apply_signal(&RemoteStatus::Starting, &RemoteSignal::Connected), Some(RemoteStatus::On { url: None }));
        assert_eq!(apply_signal(&RemoteStatus::Starting, &RemoteSignal::Untrusted), Some(RemoteStatus::Untrusted));
    }

    #[test]
    fn serializes_for_ts() {
        let j = |s: &RemoteStatus| serde_json::to_string(s).unwrap();
        assert_eq!(j(&RemoteStatus::Off), r#"{"state":"off"}"#);
        assert_eq!(j(&RemoteStatus::On { url: None }), r#"{"state":"on"}"#);
        assert_eq!(j(&RemoteStatus::On { url: Some("u".into()) }), r#"{"state":"on","url":"u"}"#);
        assert_eq!(j(&RemoteStatus::Error { message: "m".into() }), r#"{"state":"error","message":"m"}"#);
    }

    #[test]
    fn trust_script_quotes_safely() {
        let s = trust_script(&PathBuf::from("/Users/d/Mi Carpeta/Ñandú's/espacios"), &PathBuf::from("/b/it's here/claude"));
        let lines: Vec<_> = s.lines().collect();
        assert_eq!(lines[0], "#!/bin/zsh");
        assert_eq!(lines[1], format!("echo '{TRUST_NOTE}'"));
        assert_eq!(lines[2], r"cd '/Users/d/Mi Carpeta/Ñandú'\''s/espacios' || exit 1");
        assert_eq!(lines[3], r"'/b/it'\''s here/claude' remote-control --name Types");
    }
}
