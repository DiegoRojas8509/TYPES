//! Read-only view of Claude's NATIVE memory for a space (`~/.claude/projects/<slug>/memory/`),
//! which the «cronista» keeps up to date. Only `MEMORY.md` and the `cronista-*.md` files it lists are read.
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, Result};
use crate::settings::AppState;
use crate::workspace;

/// Longest project slug Claude Code uses verbatim (longer ones are hashed: not supported, like the cronista).
const MAX_SLUG: usize = 200;
/// Largest memory file `memory_read` / `memory_status` will load.
pub(crate) const MAX_READ: usize = 200 * 1024;
const BLOCK_START: &str = "<!-- cronista:inicio -->";
const BLOCK_END: &str = "<!-- cronista:fin -->";
const DECISION_WORDS: [&str; 4] = ["decid", "acordad", "quedó", "se eligió"];

/// Same scheme as Claude Code: every non-ASCII-alphanumeric character becomes `-`.
pub fn slug_for(path: &Path) -> Option<String> {
    let s: String = path
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    (s.chars().count() <= MAX_SLUG).then_some(s)
}

pub fn memory_dir_in(home: &Path, space_dir: &Path) -> Option<PathBuf> {
    Some(home.join(".claude/projects").join(slug_for(space_dir)?).join("memory"))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IndexEntry {
    pub file: String,
    pub title: String,
    pub description: String,
}

/// A plain `cronista-<name>.md` file name (no separators, no dots games).
pub fn is_cronista_file(name: &str) -> bool {
    let ok_chars = name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    ok_chars && !name.contains("..") && name.len() > "cronista-.md".len() && name.starts_with("cronista-") && name.ends_with(".md")
}

/// Entries of the cronista block of MEMORY.md: `- [name](cronista-x.md) — description`.
pub fn parse_index(text: &str) -> Vec<IndexEntry> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if l == BLOCK_START {
            inside = true;
        } else if l == BLOCK_END {
            inside = false;
        } else if inside {
            if let Some(e) = parse_line(l) {
                out.push(e);
            }
        }
    }
    out
}

fn parse_line(l: &str) -> Option<IndexEntry> {
    let rest = l.strip_prefix("- [")?;
    let (title, rest) = rest.split_once("](")?;
    let (file, rest) = rest.split_once(')')?;
    if !is_cronista_file(file) {
        return None;
    }
    let desc = rest.trim().trim_start_matches(['—', '–', '-']).trim();
    Some(IndexEntry { file: file.into(), title: title.trim().into(), description: desc.into() })
}

/// (facts, decisions) of one memory file.
pub fn count_facts(text: &str) -> (u32, u32) {
    let mut lines = text.lines().peekable();
    if lines.peek().map(|l| l.trim()) == Some("---") {
        lines.next();
        for l in lines.by_ref() {
            if l.trim() == "---" {
                break;
            }
        }
    }
    let (mut facts, mut decisions) = (0, 0);
    let (mut history, mut decision_section) = (false, false);
    for line in lines {
        if line.starts_with('#') {
            let h = line.to_lowercase();
            history = h.contains("historial");
            decision_section = h.contains("decisi");
        } else if !history {
            if let Some(item) = line.strip_prefix("- ") {
                facts += 1;
                let t = item.to_lowercase();
                if decision_section || DECISION_WORDS.iter().any(|w| t.contains(w)) {
                    decisions += 1;
                }
            }
        }
    }
    (facts, decisions)
}

fn read_capped(path: &Path) -> Result<String> {
    let md = std::fs::symlink_metadata(path)?;
    if !md.file_type().is_file() {
        return Err(AppError::Invalid("solo se leen archivos normales de la memoria".into()));
    }
    if md.len() > MAX_READ as u64 {
        return Err(AppError::Invalid("el archivo de memoria es demasiado grande".into()));
    }
    Ok(String::from_utf8_lossy(&std::fs::read(path)?).into_owned())
}

/// Reads `MEMORY.md` or a `cronista-*.md` file from the memory folder.
pub fn read_file(dir: &Path, file: &str) -> Result<String> {
    if file != "MEMORY.md" && !is_cronista_file(file) {
        return Err(AppError::InvalidName("solo MEMORY.md o cronista-*.md".into()));
    }
    read_capped(&dir.join(file))
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let m = std::fs::symlink_metadata(path).ok()?.modified().ok()?;
    u64::try_from(m.duration_since(UNIX_EPOCH).ok()?.as_millis()).ok()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub file: String,
    pub title: String,
    pub description: String,
    /// File mtime in ms.
    pub updated: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    pub dir: String,
    pub exists: bool,
    pub entries: Vec<MemoryEntry>,
    pub facts: u32,
    pub decisions: u32,
    pub updated: Option<u64>,
    pub index_lines: u32,
}

/// Space folder of the workspace: a plain name of an existing top-level directory.
pub(crate) fn space_dir(root: &Path, space: &str) -> Result<PathBuf> {
    workspace::resolve_dir(root, workspace::validate_name(space)?)
}

fn space_memory(root: &Path, home: &Path, space: &str) -> Result<PathBuf> {
    memory_dir_in(home, &space_dir(root, space)?)
        .ok_or_else(|| AppError::Invalid("la ruta del espacio es demasiado larga para su memoria".into()))
}

pub fn status_in(root: &Path, home: &Path, space: &str) -> Result<MemoryStatus> {
    let dir = space_memory(root, home, space)?;
    let mut st = MemoryStatus {
        dir: dir.to_string_lossy().into_owned(),
        exists: dir.is_dir(),
        entries: vec![],
        facts: 0,
        decisions: 0,
        updated: None,
        index_lines: 0,
    };
    let Ok(index) = read_capped(&dir.join("MEMORY.md")) else { return Ok(st) };
    st.index_lines = u32::try_from(index.lines().count()).unwrap_or(u32::MAX);
    for e in parse_index(&index) {
        let path = dir.join(&e.file);
        let Ok(text) = read_capped(&path) else { continue };
        let (f, d) = count_facts(&text);
        st.facts += f;
        st.decisions += d;
        let updated = mtime_ms(&path);
        st.updated = st.updated.max(updated);
        st.entries.push(MemoryEntry { file: e.file, title: e.title, description: e.description, updated });
    }
    Ok(st)
}

pub(crate) fn home() -> Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| AppError::Io("no encuentro la carpeta personal".into()))
}

#[tauri::command(async)]
pub fn memory_status(state: State<AppState>, space: String) -> Result<MemoryStatus> {
    status_in(&state.root(), &home()?, &space)
}

#[tauri::command(async)]
pub fn memory_read(state: State<AppState>, space: String, file: String) -> Result<String> {
    read_file(&space_memory(&state.root(), &home()?, &space)?, &file)
}

#[cfg(test)]
#[path = "memory_tests.rs"]
mod tests;
