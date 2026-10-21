use super::*;
use std::fs;
use std::time::{Duration, Instant};

const SID: &str = "11111111-2222-3333-4444-555555555555";

struct Fixture {
    root: tempfile::TempDir,
    home: tempfile::TempDir,
    scripts: tempfile::TempDir,
}

fn fixture(with_transcript: bool) -> Fixture {
    let f = Fixture { root: tempfile::tempdir().unwrap(), home: tempfile::tempdir().unwrap(), scripts: tempfile::tempdir().unwrap() };
    fs::create_dir(f.root.path().join("Ropa")).unwrap();
    if with_transcript {
        let space = fs::canonicalize(f.root.path().join("Ropa")).unwrap();
        let dir = f.home.path().join(".claude/projects").join(crate::memory::slug_for(&space).unwrap());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{SID}.jsonl")), "{}\n").unwrap();
    }
    f
}

fn fake(f: &Fixture, body: &str) -> Cronista {
    let path = f.scripts.path().join("cronista.sh");
    fs::write(&path, body).unwrap();
    Cronista { program: "sh".into(), script: path, env: vec![] }
}

fn printing(json: &str) -> String {
    format!("cat <<'EOF'\n{json}\nEOF\n")
}

fn run(f: &Fixture, c: Option<&Cronista>, sid: &str, timeout: Duration) -> crate::error::Result<CloseTopicResult> {
    close_topic_in(f.root.path(), f.home.path(), c, &CloseState::default(), "Ropa", sid, timeout)
}

const OK_JSON: &str = r#"{"ok":true,"memoria":"/m","cambios":[
 {"archivo":"cronista-t.md","accion":"actualizado","resumen":"Subió la tela"},
 {"archivo":"cronista-n.md","accion":"nuevo","resumen":"Nuevo tema"},
 {"archivo":"../evil.md","accion":"nuevo","resumen":"x"}],
 "antes":{"cronista-t.md":"a\nb\n\nc\n","cronista-n.md":null,"MEMORY.md":"i"},
 "despues":{"cronista-t.md":"a\nB\n\nc\n","cronista-n.md":"x\ny\n","MEMORY.md":"j"}}"#;

#[test]
fn success_returns_real_line_diffs_per_file() {
    let f = fixture(true);
    let c = fake(&f, &printing(OK_JSON));
    let r = run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert!(r.ok && r.error.is_none() && !r.nothing_to_save);
    assert_eq!(r.changes.len(), 2, "unsafe file names are dropped");
    assert_eq!(r.changes[0].file, "cronista-t.md");
    assert_eq!(r.changes[0].action, "actualizado");
    assert_eq!(r.changes[0].summary, "Subió la tela");
    assert_eq!(r.changes[0].added, vec!["B"]);
    assert_eq!(r.changes[0].removed, vec!["b"]);
    assert_eq!(r.changes[1].added, vec!["x", "y"]);
    assert!(r.changes[1].removed.is_empty());
}

#[test]
fn script_receives_the_expected_arguments() {
    let f = fixture(true);
    let out = f.scripts.path().join("args.txt");
    let c = fake(&f, &format!("printf '%s\\n' \"$@\" > '{}'\n{}", out.display(), printing(r#"{"ok":true,"cambios":[]}"#)));
    run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    let args = fs::read_to_string(out).unwrap();
    let lines: Vec<&str> = args.lines().collect();
    assert_eq!(lines[0], "--now");
    assert_eq!(lines[1], "--transcript");
    assert!(lines[2].ends_with(&format!("{SID}.jsonl")));
    assert_eq!(lines[3], "--cwd");
    assert!(lines[4].ends_with("/Ropa"));
}

#[test]
fn cronista_failure_is_reported_not_raised() {
    let f = fixture(true);
    let c = fake(&f, &format!("{}exit 1\n", printing(r#"{"ok":false,"error":"otra ejecución sigue en curso"}"#)));
    let r = run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert!(!r.ok);
    assert!(r.changes.is_empty());
    assert_eq!(r.error.as_deref(), Some("otra ejecución sigue en curso"));
}

#[test]
fn malformed_json_is_an_error_result() {
    let f = fixture(true);
    let c = fake(&f, "echo 'not json'\n");
    let r = run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert!(!r.ok);
    assert!(r.error.unwrap().contains("respuesta no válida"));
}

#[test]
fn timeout_kills_the_script_and_returns_promptly() {
    let f = fixture(true);
    let c = fake(&f, "exec sleep 20\n");
    let t = Instant::now();
    let r = run(&f, Some(&c), SID, Duration::from_millis(300)).unwrap();
    assert!(t.elapsed() < Duration::from_secs(5));
    assert!(!r.ok);
    assert!(r.error.unwrap().contains("tardó demasiado"));
}

#[test]
fn missing_script_or_interpreter_says_not_installed() {
    let f = fixture(true);
    for c in [
        None,
        Some(Cronista { program: "sh".into(), script: f.scripts.path().join("nope.py"), env: vec![] }),
        Some(Cronista { program: "definitely-not-python".into(), script: f.scripts.path().join("x"), env: vec![] }),
    ] {
        if let Some(Cronista { script, .. }) = &c {
            fs::write(script, "").ok();
            if script.ends_with("nope.py") {
                fs::remove_file(script).unwrap();
            }
        }
        let e = run(&f, c.as_ref(), SID, Duration::from_secs(5)).unwrap_err();
        assert_eq!(e.message(), "El cronista no está instalado. Revisa el plugin sistema.");
    }
}

#[test]
fn no_transcript_means_nothing_to_save_without_running_anything() {
    let f = fixture(false);
    let marker = f.scripts.path().join("ran");
    let c = fake(&f, &format!("touch '{}'\n", marker.display()));
    let r = run(&f, Some(&c), SID, Duration::from_secs(5)).unwrap();
    assert!(r.ok && r.nothing_to_save && r.changes.is_empty() && r.error.is_none());
    assert!(!marker.exists());
}

#[test]
fn second_concurrent_call_is_rejected() {
    let f = fixture(true);
    let c = fake(&f, &printing(OK_JSON));
    let state = CloseState::default();
    let _held = state.0.try_lock().unwrap();
    let e = close_topic_in(f.root.path(), f.home.path(), Some(&c), &state, "Ropa", SID, Duration::from_secs(5)).unwrap_err();
    assert_eq!(e.message(), "Ya se está guardando el tema.");
}

#[test]
fn lock_is_released_after_a_call() {
    let f = fixture(true);
    let c = fake(&f, &printing(OK_JSON));
    let state = CloseState::default();
    for _ in 0..2 {
        close_topic_in(f.root.path(), f.home.path(), Some(&c), &state, "Ropa", SID, Duration::from_secs(5)).unwrap();
    }
}

#[test]
fn invalid_session_ids_and_spaces_are_rejected() {
    let f = fixture(true);
    let c = fake(&f, &printing(OK_JSON));
    for sid in ["", "../x", "a b", "a/b", "é", &"a".repeat(65)] {
        assert!(run(&f, Some(&c), sid, Duration::from_secs(5)).is_err(), "{sid}");
    }
    let r = close_topic_in(f.root.path(), f.home.path(), Some(&c), &CloseState::default(), "../x", SID, Duration::from_secs(5));
    assert!(r.is_err());
}

#[test]
fn line_diff_ignores_blank_lines_keeps_order_and_caps() {
    let (a, r, cut) = line_diff("a\n\nb\nb\n", "a\nb\nc\n");
    assert!(!cut);
    assert_eq!(a, vec!["c"]);
    assert_eq!(r, vec!["b"]);
    let many: String = (0..100).map(|i| format!("l{i}\n")).collect();
    let (a, _, cut) = line_diff("", &many);
    assert!(cut);
    assert_eq!(a.len(), MAX_DIFF_LINES);
    assert_eq!(a[0], "l0");
}

#[test]
fn find_cronista_prefers_live_path_then_newest_cache() {
    let home = tempfile::tempdir().unwrap();
    assert!(find_cronista(home.path()).is_none());
    let cache = home.path().join(".claude/plugins/cache/bastian/sistema/1.1.0/scripts");
    fs::create_dir_all(&cache).unwrap();
    fs::write(cache.join("cronista.py"), "").unwrap();
    assert!(find_cronista(home.path()).unwrap().script.starts_with(home.path().join(".claude/plugins/cache")));
    let live = home.path().join("Documents/CLAUDE/repositorio/plugins/sistema/scripts");
    fs::create_dir_all(&live).unwrap();
    fs::write(live.join("cronista.py"), "").unwrap();
    assert!(find_cronista(home.path()).unwrap().script.starts_with(home.path().join("Documents/CLAUDE")));
}

fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[test]
fn timeout_kills_the_whole_process_group() {
    let f = fixture(true);
    let pidfile = f.scripts.path().join("pid");
    let c = fake(&f, &format!("sleep 30 &\necho $! > '{}'\nwait\n", pidfile.display()));
    let r = run(&f, Some(&c), SID, Duration::from_millis(600)).unwrap();
    assert!(!r.ok);
    let pid: i32 = fs::read_to_string(&pidfile).unwrap().trim().parse().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!alive(pid), "grandchild must be gone");
}

#[test]
fn env_puts_claude_dir_first_and_sets_claude_bin() {
    let env = build_env(Some(Path::new("/opt/x/bin/claude")), Path::new("/Users/d"));
    let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    let path = get("PATH").unwrap();
    assert!(path.starts_with("/opt/x/bin:"));
    assert!(path.contains("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"));
    assert!(path.ends_with(":/Users/d/.local/bin"));
    assert_eq!(get("CLAUDE_BIN").unwrap(), "/opt/x/bin/claude");
    let none = build_env(None, Path::new("/Users/d"));
    assert!(none.iter().all(|(n, _)| n != "CLAUDE_BIN"));
    assert!(none.iter().find(|(n, _)| n == "PATH").unwrap().1.starts_with("/opt/homebrew/bin"));
}

#[test]
fn script_gets_the_env_it_was_given() {
    let f = fixture(true);
    let out = f.scripts.path().join("env.txt");
    let mut c = fake(&f, &format!("echo \"$CLAUDE_BIN\" > '{}'\n{}", out.display(), printing(r#"{"ok":true,"cambios":[]}"#)));
    c.env = vec![("CLAUDE_BIN".into(), "/x/claude".into())];
    run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert_eq!(fs::read_to_string(out).unwrap().trim(), "/x/claude");
}

#[test]
fn stderr_tail_is_the_detail_for_bad_output_or_nonzero_exit() {
    let f = fixture(true);
    let c = fake(&f, "printf 'boom\\001 detalle' >&2\necho nojson\nexit 3\n");
    let r = run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert!(!r.ok);
    let e = r.error.unwrap();
    assert!(e.starts_with("El cronista falló: "), "{e}");
    assert!(e.contains("boom") && e.contains("detalle") && !e.contains('\u{1}'));
}

#[test]
fn truncated_and_removed_files_are_flagged() {
    let f = fixture(true);
    let many: String = (0..100).map(|i| format!("l{i}\n")).collect();
    let json = serde_json::json!({"ok":true,"cambios":[
        {"archivo":"cronista-a.md","accion":"nuevo","resumen":""},
        {"archivo":"cronista-b.md","accion":"actualizado","resumen":""}],
        "antes":{"cronista-a.md":null,"cronista-b.md":"x\n"},
        "despues":{"cronista-a.md":many,"cronista-b.md":null}});
    let c = fake(&f, &printing(&json.to_string()));
    let r = run(&f, Some(&c), SID, Duration::from_secs(10)).unwrap();
    assert!(r.changes[0].truncated && r.changes[0].added.len() == MAX_DIFF_LINES);
    assert!(!r.changes[1].truncated);
    assert_eq!(r.changes[1].action, "eliminado");
    assert_eq!(r.changes[1].removed, vec!["x"]);
}
