use crate::error::{AppError, Result};
use crate::settings::AppState;
use serde::Serialize;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use crate::activity::ActivityLog;
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Dir,
    File,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub children: Vec<TreeNode>,
    /// Last modification, milliseconds since the epoch; `None` when unknown.
    pub modified: Option<u64>,
}

/// Name of the per-folder image store. Always written in NFC.
pub const IMAGES_DIR: &str = "Im\u{e1}genes";

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeletedEntry {
    /// Workspace-relative path the entry had.
    pub original: String,
    /// Absolute path inside the system trash; empty when the platform cannot tell.
    pub trashed: String,
}

fn is_taken(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

/// Splits a path string into safe `Normal` components. Anything else
/// (`..`, absolute, backslashes, NUL, prefixes) escapes the workspace.
pub(crate) fn rel_parts(rel: &str) -> Result<Vec<String>> {
    if rel.contains('\0') || rel.contains('\\') {
        return Err(AppError::OutsideWorkspace);
    }
    let mut parts = Vec::new();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => {
                parts.push(s.to_str().ok_or(AppError::OutsideWorkspace)?.to_string())
            }
            Component::CurDir => {}
            _ => return Err(AppError::OutsideWorkspace),
        }
    }
    Ok(parts)
}

fn join_rel(parts: &[String]) -> String {
    parts.join("/")
}

/// Resolves `rel` under `root`, walking component by component so that
/// symlinks are checked even when the final path does not exist yet.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let parts = rel_parts(rel)?;
    let canon_root = root.canonicalize()?;
    let mut cur = canon_root.clone();
    for (i, part) in parts.iter().enumerate() {
        let next = cur.join(part);
        match std::fs::symlink_metadata(&next) {
            Ok(md) if md.file_type().is_symlink() => {
                let target = next.canonicalize().map_err(|_| AppError::OutsideWorkspace)?;
                if !target.starts_with(&canon_root) {
                    return Err(AppError::OutsideWorkspace);
                }
                cur = target;
            }
            Ok(_) => cur = next,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                cur = next;
                for rest in &parts[i + 1..] {
                    cur.push(rest);
                }
                break;
            }
            Err(e) => return Err(e.into()),
        }
    }
    if !cur.starts_with(&canon_root) {
        return Err(AppError::OutsideWorkspace);
    }
    Ok(cur)
}

/// Like `resolve` for an existing entry that will be renamed or deleted:
/// the entry itself must not be a symlink and must not be the root.
fn resolve_entry(root: &Path, rel: &str) -> Result<PathBuf> {
    let parts = rel_parts(rel)?;
    let (last, parent) = parts
        .split_last()
        .ok_or_else(|| AppError::Invalid("no se puede modificar la carpeta raíz".into()))?;
    let full = resolve(root, &join_rel(parent))?.join(last);
    match std::fs::symlink_metadata(&full) {
        Ok(md) if md.file_type().is_symlink() => {
            Err(AppError::Invalid("no se pueden modificar enlaces simbólicos".into()))
        }
        Ok(_) => Ok(full),
        Err(e) => Err(e.into()),
    }
}

fn resolve_dir(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = resolve(root, rel)?;
    if p.is_dir() {
        Ok(p)
    } else {
        Err(AppError::NotFound("la carpeta".into()))
    }
}

pub fn validate_name(name: &str) -> Result<&str> {
    let n = name.trim();
    let why = if n.is_empty() {
        "no puede estar vacío"
    } else if n.chars().any(char::is_control) {
        // The name ends up in the `Pizarra abierta: <board>` prompt line: a newline would inject a line.
        "no puede contener saltos de línea ni caracteres de control"
    } else if n.contains('/') || n.contains('\\') {
        "no puede contener / ni \\"
    } else if n.starts_with('.') {
        "no puede empezar con punto"
    } else if n.len() > 200 {
        "es demasiado largo"
    } else {
        return Ok(n);
    };
    Err(AppError::InvalidName(why.into()))
}

/// `stem + ext` if free in `dir`, else `stem 2 + ext`, `stem 3 + ext`...
fn unique_name(dir: &Path, stem: &str, ext: &str) -> String {
    let mut candidate = format!("{stem}{ext}");
    let mut n = 2;
    while is_taken(&dir.join(&candidate)) {
        candidate = format!("{stem} {n}{ext}");
        n += 1;
    }
    candidate
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

fn child_rel(dir_parts: &[String], name: &str) -> String {
    if dir_parts.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", join_rel(dir_parts), name)
    }
}

pub fn ensure_root(root: &Path) -> Result<()> {
    std::fs::create_dir_all(root)?;
    let file = root.join("CLAUDE.md");
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&file) {
        Ok(mut f) => f.write_all(crate::templates::ROOT_CLAUDE_MD.as_bytes())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    ensure_boards_section(root)?;
    migrate_old_image_lines(root);
    Ok(())
}

/// Rewrites, in the root CLAUDE.md and in each top-level space's CLAUDE.md, only the
/// lines that match byte for byte what the old templates wrote about `adjuntos/`.
/// Any other line (including ones Diego edited) is kept; idempotent; errors are ignored
/// because this is a best-effort courtesy that must never block startup.
fn migrate_old_image_lines(root: &Path) {
    let mut files = vec!["CLAUDE.md".to_string()];
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if let (true, Some(name)) = (is_dir, e.file_name().to_str()) {
                if !name.starts_with('.') {
                    files.push(format!("{name}/CLAUDE.md"));
                }
            }
        }
    }
    for rel in files {
        // `resolve` (inside read/write) rejects a CLAUDE.md symlinked outside the workspace.
        let Ok(text) = read_text_in(root, &rel) else { continue };
        let migrated = text
            .split('\n')
            .map(|line| {
                crate::templates::LINE_MIGRATIONS
                    .iter()
                    .find(|(old, _)| *old == line)
                    .map_or(line, |(_, new)| *new)
            })
            .collect::<Vec<_>>()
            .join("\n");
        if migrated != text {
            let _ = write_text_in(root, &rel, &migrated);
        }
    }
}

/// Appends the `## Pizarras` section to the root CLAUDE.md when it is missing.
/// Existing content is never modified; calling it twice does not duplicate.
pub fn ensure_boards_section(root: &Path) -> Result<()> {
    let file = root.join("CLAUDE.md");
    let existing = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    let text = String::from_utf8_lossy(&existing);
    if text.lines().any(|l| l.trim_end() == "## Pizarras") {
        return Ok(());
    }
    let mut addition = String::new();
    if !existing.is_empty() {
        addition.push_str(if existing.ends_with(b"\n") { "\n" } else { "\n\n" });
    }
    addition.push_str(crate::templates::BOARDS_SECTION);
    let mut f = std::fs::OpenOptions::new().append(true).create(true).open(&file)?;
    f.write_all(addition.as_bytes())?;
    Ok(())
}

fn build_children(dir: &Path, rel_parts: &[String]) -> std::io::Result<Vec<TreeNode>> {
    let mut nodes = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        let Some(name) = entry.file_name().to_str().map(String::from) else { continue };
        if name.starts_with('.') || ft.is_symlink() {
            continue;
        }
        let mut parts = rel_parts.to_vec();
        parts.push(name.clone());
        let path = join_rel(&parts);
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        if ft.is_dir() {
            let children = build_children(&entry.path(), &parts).unwrap_or_default();
            nodes.push(TreeNode { name, path, kind: NodeKind::Dir, children, modified });
        } else if ft.is_file() {
            nodes.push(TreeNode { name, path, kind: NodeKind::File, children: Vec::new(), modified });
        }
    }
    nodes.sort_by(|a, b| {
        (a.kind == NodeKind::File)
            .cmp(&(b.kind == NodeKind::File))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(nodes)
}

pub fn build_tree(root: &Path) -> Result<Vec<TreeNode>> {
    Ok(build_children(&root.canonicalize()?, &[])?)
}

pub fn read_text_in(root: &Path, rel: &str) -> Result<String> {
    let p = resolve(root, rel)?;
    if !p.is_file() {
        return Err(AppError::NotFound("el archivo".into()));
    }
    let bytes = std::fs::read(&p)?;
    String::from_utf8(bytes).map_err(|_| AppError::Invalid("el archivo no es de texto".into()))
}

/// Writes atomically (temp file in the same folder, then rename) so a crash
/// never leaves a half-written page.
pub fn write_text_in(root: &Path, rel: &str, content: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    let parent = p.parent().ok_or(AppError::OutsideWorkspace)?;
    if !parent.is_dir() {
        return Err(AppError::NotFound("la carpeta".into()));
    }
    if p.is_dir() {
        return Err(AppError::Invalid("es una carpeta, no un archivo".into()));
    }
    let name = p.file_name().and_then(|n| n.to_str()).ok_or(AppError::OutsideWorkspace)?;
    let tmp = parent.join(format!(".{name}.types-tmp"));
    let result = std::fs::write(&tmp, content).and_then(|_| std::fs::rename(&tmp, &p));
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub fn create_space_in(root: &Path, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    let root = resolve_dir(root, "")?;
    let unique = unique_name(&root, name, "");
    let dir = root.join(&unique);
    std::fs::create_dir(&dir)?;
    std::fs::write(dir.join("CLAUDE.md"), crate::templates::SPACE_CLAUDE_MD)?;
    Ok(unique)
}

/// Creates an empty-or-seeded file with `ext` in `dir`, stripping a trailing
/// `ext` (case-insensitive) from `name` and deduplicating against siblings.
fn create_file_in(root: &Path, dir: &str, name: &str, ext: &str, content: &str) -> Result<String> {
    let name = validate_name(name)?;
    let dir_path = resolve_dir(root, dir)?;
    let stem = match name.len().checked_sub(ext.len()) {
        Some(i) if name.is_char_boundary(i) && name[i..].eq_ignore_ascii_case(ext) => &name[..i],
        _ => name,
    };
    validate_name(stem)?;
    let unique = unique_name(&dir_path, stem, ext);
    std::fs::write(dir_path.join(&unique), content)?;
    Ok(child_rel(&rel_parts(dir)?, &unique))
}

pub fn create_page_in(root: &Path, dir: &str, name: &str) -> Result<String> {
    create_file_in(root, dir, name, ".md", "")
}

pub fn create_board_in(root: &Path, dir: &str, name: &str) -> Result<String> {
    create_file_in(root, dir, name, ".canvas", crate::templates::EMPTY_CANVAS)
}

pub fn create_folder_in(root: &Path, dir: &str, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    let dir_path = resolve_dir(root, dir)?;
    let unique = unique_name(&dir_path, name, "");
    std::fs::create_dir(dir_path.join(&unique))?;
    Ok(child_rel(&rel_parts(dir)?, &unique))
}

pub fn rename_entry_in(root: &Path, rel: &str, new_name: &str) -> Result<String> {
    let new_name = validate_name(new_name)?;
    let from = resolve_entry(root, rel)?;
    let parts = rel_parts(rel)?;
    let parent_parts = &parts[..parts.len() - 1];
    let parent = from.parent().ok_or(AppError::OutsideWorkspace)?;
    let current = parts.last().map(String::as_str).unwrap_or_default();

    // Files keep their extension when the new name does not carry it.
    let mut wanted = new_name.to_string();
    if from.is_file() {
        let ext = Path::new(current).extension().and_then(|e| e.to_str()).unwrap_or("");
        if !ext.is_empty() && !wanted.to_lowercase().ends_with(&format!(".{}", ext.to_lowercase())) {
            wanted = format!("{wanted}.{ext}");
        }
    }
    if wanted == current {
        return Ok(join_rel(&parts));
    }
    let final_name = if wanted.to_lowercase() == current.to_lowercase() {
        wanted // case-only change: the "taken" entry is this very file
    } else {
        let (stem, ext) = split_ext(&wanted);
        let (stem, ext) = if from.is_file() { (stem, ext) } else { (wanted.as_str(), "") };
        unique_name(parent, stem, ext)
    };
    std::fs::rename(&from, parent.join(&final_name))?;
    Ok(child_rel(parent_parts, &final_name))
}

/// `trasher` moves a path to the system trash and returns where it landed
/// (empty path when unknown); injected so tests never touch the real trash.
pub fn delete_entry_with(
    root: &Path,
    rel: &str,
    trasher: impl Fn(&Path) -> Result<PathBuf>,
) -> Result<DeletedEntry> {
    let p = resolve_entry(root, rel)?;
    let original = join_rel(&rel_parts(rel)?);
    let trashed = trasher(&p)?;
    Ok(DeletedEntry { original, trashed: trashed.to_string_lossy().into_owned() })
}

fn system_trash(p: &Path) -> Result<PathBuf> {
    // On macOS the default Finder method is slow, shows a progress window and
    // asks for Automation permission; NSFileManager moves to the trash silently
    // and, called directly, tells us the resulting location (needed for undo).
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let path = p.to_str().ok_or_else(|| AppError::Invalid("la ruta no es texto válido".into()))?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let mut result: Option<Retained<NSURL>> = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut result))
            .map_err(|e| AppError::Io(e.to_string()))?;
        Ok(result
            .and_then(|u| u.path())
            .map(|s| PathBuf::from(s.to_string()))
            .unwrap_or_default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(p).map_err(|e| AppError::Io(e.to_string()))?;
        Ok(PathBuf::new())
    }
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let md = std::fs::symlink_metadata(from)?;
    if md.file_type().is_symlink() {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(std::fs::read_link(from)?, to);
        #[cfg(not(unix))]
        return Err(std::io::Error::other("enlace simbólico no soportado"));
    } else if md.is_dir() {
        std::fs::create_dir(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            copy_recursive(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else {
        // create_new: a file that appeared at `to` meanwhile is never truncated.
        let mut src = std::fs::File::open(from)?;
        let mut dst = std::fs::OpenOptions::new().write(true).create_new(true).open(to)?;
        std::io::copy(&mut src, &mut dst)?;
        std::fs::set_permissions(to, md.permissions())?;
        Ok(())
    }
}

fn is_cross_device(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::CrossesDevices || e.raw_os_error() == Some(18)
}

fn move_path(from: &Path, to: &Path) -> Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => move_after_cross_device(from, to),
        Err(e) => Err(e.into()),
    }
}

/// Copy, then remove the source only if the copy worked. If `to` already existed or
/// appeared meanwhile, it is left untouched.
fn move_after_cross_device(from: &Path, to: &Path) -> Result<()> {
    if is_taken(to) {
        return Err(AppError::AlreadyExists("Ya existe el destino; no lo sobrescribo.".into()));
    }
    if let Err(e) = copy_recursive(from, to) {
        // `to` did not exist a moment ago, so whatever is there is our partial copy.
        if !matches!(e.kind(), std::io::ErrorKind::AlreadyExists) {
            let _ = if to.is_dir() { std::fs::remove_dir_all(to) } else { std::fs::remove_file(to) };
        }
        return Err(e.into());
    }
    if std::fs::symlink_metadata(from)?.is_dir() {
        std::fs::remove_dir_all(from)?;
    } else {
        std::fs::remove_file(from)?;
    }
    Ok(())
}

/// `trashed` lives outside the workspace by nature: only accept an existing,
/// absolute, `..`-free path whose parent chain contains a `.Trash`/`.Trashes` folder.
fn validate_trashed(trashed: &str) -> Result<PathBuf> {
    let gone = || AppError::NotFound("el elemento en la papelera".into());
    let p = Path::new(trashed);
    if trashed.is_empty() || !p.is_absolute() || trashed.contains('\0') {
        return Err(AppError::Invalid("la ubicación en la papelera no es válida".into()));
    }
    if p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(AppError::Invalid("la ubicación en la papelera no es válida".into()));
    }
    std::fs::symlink_metadata(p).map_err(|_| gone())?;
    let name = p.file_name().ok_or_else(gone)?;
    let parent = p.parent().ok_or_else(gone)?.canonicalize().map_err(|_| gone())?;
    let in_trash = parent
        .components()
        .any(|c| matches!(c, Component::Normal(s) if s == ".Trash" || s == ".Trashes"));
    if !in_trash {
        return Err(AppError::Invalid("el elemento no está en la papelera".into()));
    }
    Ok(parent.join(name))
}

/// Moves a trashed entry back to `original`. Never overwrites.
pub fn restore_entry_in(root: &Path, original: &str, trashed: &str) -> Result<String> {
    let parts = rel_parts(original)?;
    let name = parts
        .last()
        .ok_or_else(|| AppError::Invalid("falta la ruta original".into()))?
        .clone();
    let dest = resolve(root, &join_rel(&parts))?;
    let src = validate_trashed(trashed)?;
    if is_taken(&dest) {
        return Err(AppError::AlreadyExists(format!("Ya existe «{name}»; no la sobrescribo.")));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    move_path(&src, &dest)?;
    Ok(join_rel(&parts))
}

/// Returns `<root>/<dir>/Imágenes` (created when `create`) and its workspace-relative path.
/// The image folder itself is resolved too, so a symlinked `Imágenes` cannot leave the root.
fn images_dir(root: &Path, dir: &str, create: bool) -> Result<(PathBuf, String)> {
    let parts = rel_parts(dir)?;
    resolve_dir(root, &join_rel(&parts))?;
    let rel = child_rel(&parts, IMAGES_DIR);
    let images = resolve(root, &rel)?;
    if create {
        std::fs::create_dir_all(&images)?;
    }
    Ok((images, rel))
}

pub fn save_image_in(root: &Path, dir: &str, file_name: &str, bytes: &[u8]) -> Result<String> {
    let name = validate_name(file_name)?;
    let (images, rel_dir) = images_dir(root, dir, true)?;
    let (stem, ext) = split_ext(name);
    let first = unique_name(&images, stem, ext);
    let unique = create_exclusive(&images, stem, ext, first, bytes)?;
    Ok(format!("{rel_dir}/{unique}"))
}

/// Writes `bytes` to a brand-new file, starting at `candidate` and moving on to
/// `stem 2`, `stem 3`... whenever the name was taken meanwhile. `create_new`
/// makes the check atomic, so a concurrent save can never be truncated.
fn create_exclusive(dir: &Path, stem: &str, ext: &str, mut candidate: String, bytes: &[u8]) -> Result<String> {
    use std::io::Write;
    let mut n = 2;
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join(&candidate)) {
            Ok(mut f) => {
                f.write_all(bytes)?;
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                candidate = format!("{stem} {n}{ext}");
                n += 1;
            }
            Err(e) => return Err(e.into()),
        }
    }
}

pub fn list_images_in(root: &Path, dir: &str) -> Result<Vec<String>> {
    let (images, rel_dir) = images_dir(root, dir, false)?;
    let Ok(entries) = std::fs::read_dir(&images) else { return Ok(Vec::new()) };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| !n.starts_with('.'))
        .filter(|n| {
            Path::new(n)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        })
        .collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b)));
    Ok(names.into_iter().map(|n| format!("{rel_dir}/{n}")).collect())
}

/// Copies external files into `<dest_dir>/Imágenes/`.
pub fn import_files_in(root: &Path, dest_dir: &str, sources: &[String]) -> Result<Vec<String>> {
    let (dir, rel_dir) = images_dir(root, dest_dir, true)?;
    let mut out = Vec::new();
    for src in sources {
        let src = Path::new(src);
        if !src.is_absolute() {
            return Err(AppError::Invalid("el origen debe ser una ruta absoluta".into()));
        }
        if !src.is_file() {
            return Err(AppError::Invalid("solo se pueden importar archivos".into()));
        }
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let name = validate_name(name)?;
        let (stem, ext) = split_ext(name);
        let unique = unique_name(&dir, stem, ext);
        std::fs::copy(src, dir.join(&unique))?;
        out.push(format!("{rel_dir}/{unique}"));
    }
    Ok(out)
}

/// Chat attachments: stored in the space's own `Imágenes/` (first path segment).
pub fn save_attachment_in(root: &Path, space: &str, file_name: &str, bytes: &[u8]) -> Result<String> {
    let parts = rel_parts(space)?;
    let space = parts
        .first()
        .ok_or_else(|| AppError::Invalid("falta indicar el espacio".into()))?;
    save_image_in(root, space, file_name, bytes)
}

// --- Tauri commands: thin wrappers over the functions above ---

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> Result<Vec<TreeNode>> {
    build_tree(&state.root())
}

#[tauri::command]
pub fn read_text(state: State<AppState>, path: String) -> Result<String> {
    read_text_in(&state.root(), &path)
}

#[tauri::command]
pub fn write_text(state: State<AppState>, log: State<ActivityLog>, path: String, content: String) -> Result<()> {
    write_text_logged(&state.root(), &log, &path, &content)
}

/// Pre-marks the path as ours, writes it, then records `Tu`. The pre-mark closes the
/// race where the watcher reports the write before `record_own` runs.
pub fn write_text_logged(root: &Path, log: &ActivityLog, path: &str, content: &str) -> Result<()> {
    let rel = join_rel(&rel_parts(path).unwrap_or_default());
    log.mark_own(&rel);
    write_text_in(root, path, content)?;
    log.record_own(&rel);
    Ok(())
}

/// Child `name` of `dir` as a relative path (best effort, for pre-marking only).
fn premark_path(dir: &str, name: &str) -> String {
    let mut parts = rel_parts(dir).unwrap_or_default();
    parts.push(name.to_string());
    join_rel(&parts)
}

#[tauri::command]
pub fn create_space(state: State<AppState>, log: State<ActivityLog>, name: String) -> Result<String> {
    log.mark_own_tree(&name);
    let rel = create_space_in(&state.root(), &name)?;
    log.record_own_tree(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn create_page(state: State<AppState>, log: State<ActivityLog>, dir: String, name: String) -> Result<String> {
    log.mark_own(&premark_path(&dir, &name));
    log.mark_own(&premark_path(&dir, &format!("{name}.md")));
    let rel = create_page_in(&state.root(), &dir, &name)?;
    log.record_own(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn create_board(state: State<AppState>, log: State<ActivityLog>, dir: String, name: String) -> Result<String> {
    log.mark_own(&premark_path(&dir, &name));
    log.mark_own(&premark_path(&dir, &format!("{name}.canvas")));
    let rel = create_board_in(&state.root(), &dir, &name)?;
    log.record_own(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, log: State<ActivityLog>, dir: String, name: String) -> Result<String> {
    log.mark_own_tree(&premark_path(&dir, &name));
    let rel = create_folder_in(&state.root(), &dir, &name)?;
    log.record_own_tree(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn rename_entry(state: State<AppState>, log: State<ActivityLog>, path: String, new_name: String) -> Result<String> {
    let old = join_rel(&rel_parts(&path).unwrap_or_default());
    log.mark_own_tree(&old);
    let parent = old.rsplit_once('/').map_or("", |(p, _)| p);
    log.mark_own_tree(&premark_path(parent, &new_name));
    let new = rename_entry_in(&state.root(), &path, &new_name)?;
    if old != new {
        log.record_move_own(&old, &new);
    }
    Ok(new)
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, log: State<ActivityLog>, path: String) -> Result<DeletedEntry> {
    let deleted = delete_entry_with(&state.root(), &path, system_trash)?;
    log.remove_own(&deleted.original);
    Ok(deleted)
}

#[tauri::command]
pub fn restore_entry(state: State<AppState>, log: State<ActivityLog>, original: String, trashed: String) -> Result<String> {
    // Pre-mark: a cross-device restore copies for a while.
    log.mark_own_tree(&join_rel(&rel_parts(&original).unwrap_or_default()));
    let rel = restore_entry_in(&state.root(), &original, &trashed)?;
    log.record_own_tree(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn save_image(state: State<AppState>, log: State<ActivityLog>, dir: String, file_name: String, bytes: Vec<u8>) -> Result<String> {
    let rel = save_image_in(&state.root(), &dir, &file_name, &bytes)?;
    log.record_own(&rel);
    Ok(rel)
}

#[tauri::command]
pub fn list_images(state: State<AppState>, dir: String) -> Result<Vec<String>> {
    list_images_in(&state.root(), &dir)
}

#[tauri::command]
pub fn import_files(state: State<AppState>, log: State<ActivityLog>, dest_dir: String, sources: Vec<String>) -> Result<Vec<String>> {
    // Pre-mark the destination so a long copy is not attributed to anyone else.
    let mut dest = rel_parts(&dest_dir).unwrap_or_default();
    dest.push(IMAGES_DIR.to_string());
    log.mark_own_tree(&join_rel(&dest));
    let out = import_files_in(&state.root(), &dest_dir, &sources)?;
    for rel in &out {
        log.record_own(rel);
    }
    Ok(out)
}

#[tauri::command]
pub fn save_attachment(state: State<AppState>, log: State<ActivityLog>, space: String, file_name: String, bytes: Vec<u8>) -> Result<String> {
    let rel = save_attachment_in(&state.root(), &space, &file_name, &bytes)?;
    log.record_own(&rel);
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn ws() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("ws");
        ensure_root(&root).unwrap();
        (d, root)
    }

    #[test]
    fn tree_nodes_carry_modified_time() {
        let (_d, root) = ws();
        fs::create_dir(root.join("Ropa")).unwrap();
        fs::write(root.join("Ropa").join("a.md"), "x").unwrap();
        let tree = build_tree(&root).unwrap();
        let ropa = tree.iter().find(|n| n.name == "Ropa").unwrap();
        assert!(ropa.modified.is_some_and(|m| m > 1_500_000_000_000));
        assert!(ropa.children[0].modified.is_some_and(|m| m > 1_500_000_000_000));
    }

    #[test]
    fn resolve_rejects_parent_escape() {
        let (_d, root) = ws();
        for p in ["../x", "a/../../x", "a/..", "..", "a/../b"] {
            assert!(matches!(resolve(&root, p), Err(AppError::OutsideWorkspace)), "{p}");
        }
    }

    #[test]
    fn resolve_rejects_absolute() {
        let (_d, root) = ws();
        assert!(matches!(resolve(&root, "/etc/hosts"), Err(AppError::OutsideWorkspace)));
        assert!(matches!(resolve(&root, "a\\b"), Err(AppError::OutsideWorkspace)));
        assert!(matches!(resolve(&root, "a\0b"), Err(AppError::OutsideWorkspace)));
    }

    #[test]
    #[cfg(unix)]
    fn resolve_rejects_symlink_outside() {
        let (d, root) = ws();
        let outside = d.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("flink")).unwrap();
        std::os::unix::fs::symlink(d.path().join("nope"), root.join("dangling")).unwrap();
        // existing target through a dir link, a not-yet-existing file through it,
        // a file link, and a dangling link
        for p in ["link/secret.txt", "link/new.md", "link", "flink", "dangling"] {
            assert!(matches!(resolve(&root, p), Err(AppError::OutsideWorkspace)), "{p}");
        }
        assert!(read_text_in(&root, "link/secret.txt").is_err());
        assert!(write_text_in(&root, "link/new.md", "x").is_err());
        assert!(!outside.join("new.md").exists());
    }

    #[test]
    #[cfg(unix)]
    fn resolve_accepts_symlink_inside() {
        let (_d, root) = ws();
        fs::create_dir(root.join("real")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();
        assert!(resolve(&root, "alias/new.md").is_ok());
    }

    #[test]
    fn resolve_accepts_unicode_and_new_paths() {
        let (_d, root) = ws();
        fs::create_dir(root.join("Ropa")).unwrap();
        let p = resolve(&root, "Ropa/Diseño otoño.md").unwrap();
        assert!(p.ends_with("Ropa/Diseño otoño.md"));
        assert!(resolve(&root, "Ropa/nueva/mas/profunda.md").is_ok());
        assert!(resolve(&root, "").is_ok());
        assert!(resolve(&root, "./Ropa").is_ok());
    }

    #[test]
    fn ensure_root_creates_claude_md_without_overwriting() {
        let (_d, root) = ws();
        assert!(root.join("CLAUDE.md").is_file());
        fs::write(root.join("CLAUDE.md"), "mío").unwrap();
        ensure_root(&root).unwrap();
        let md = fs::read_to_string(root.join("CLAUDE.md")).unwrap();
        assert!(md.starts_with("mío"));
        assert!(!md.contains("Reglas de formato del espacio de trabajo"));
        assert!(md.contains("## Pizarras"));
    }

    #[test]
    fn tree_sorts_dirs_first_and_hides_dotfiles() {
        let (_d, root) = ws();
        fs::create_dir_all(root.join("b/sub")).unwrap();
        fs::create_dir(root.join("A")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".hidden"), "").unwrap();
        fs::write(root.join("b/z.md"), "").unwrap();
        fs::write(root.join("b/Ñandú.md"), "").unwrap();
        fs::write(root.join("b/a.md"), "").unwrap();
        let tree = build_tree(&root).unwrap();
        let names: Vec<_> = tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["A", "b", "CLAUDE.md"]);
        let b = &tree[1];
        assert_eq!(b.kind, NodeKind::Dir);
        let kids: Vec<_> = b.children.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(kids, ["b/sub", "b/a.md", "b/z.md", "b/Ñandú.md"]);
        assert_eq!(serde_json::to_value(&b.children[1]).unwrap()["kind"], "file");
    }

    #[test]
    #[cfg(unix)]
    fn tree_skips_symlinks() {
        let (d, root) = ws();
        std::os::unix::fs::symlink(d.path(), root.join("out")).unwrap();
        assert!(build_tree(&root).unwrap().iter().all(|n| n.name != "out"));
    }

    #[test]
    fn create_space_writes_claude_md_without_image_folder() {
        let (_d, root) = ws();
        assert_eq!(create_space_in(&root, "Ropa").unwrap(), "Ropa");
        let md = fs::read_to_string(root.join("Ropa/CLAUDE.md")).unwrap();
        assert!(md.contains("Proveedores y tarifas") && md.contains("Márgenes objetivo"));
        assert!(md.contains(".canvas"), "a new space must point at boards");
        assert!(!root.join("Ropa/adjuntos").exists());
        assert!(!root.join("Ropa").join(IMAGES_DIR).exists());
        assert_eq!(create_space_in(&root, "Ropa").unwrap(), "Ropa 2");
    }

    #[test]
    fn names_are_validated() {
        let (_d, root) = ws();
        for bad in ["", "   ", "a/b", "a\\b", ".oculto", "..", "a\0b"] {
            assert!(matches!(create_space_in(&root, bad), Err(AppError::InvalidName(_))), "{bad:?}");
        }
    }

    #[test]
    fn names_with_control_characters_are_rejected_everywhere() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let page = create_page_in(&root, "Ropa", "Notas").unwrap();
        for bad in ["a\nb", "a\tb", "a\rb", "a\u{7f}b"] {
            assert!(matches!(create_space_in(&root, bad), Err(AppError::InvalidName(_))), "space {bad:?}");
            assert!(matches!(create_page_in(&root, "Ropa", bad), Err(AppError::InvalidName(_))), "page {bad:?}");
            assert!(matches!(create_board_in(&root, "Ropa", bad), Err(AppError::InvalidName(_))), "board {bad:?}");
            assert!(matches!(create_folder_in(&root, "Ropa", bad), Err(AppError::InvalidName(_))), "folder {bad:?}");
            assert!(matches!(rename_entry_in(&root, &page, bad), Err(AppError::InvalidName(_))), "rename {bad:?}");
        }
        assert!(root.join(&page).is_file());
    }

    #[test]
    fn create_page_dedupes_name() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert_eq!(create_page_in(&root, "Ropa", "Notas").unwrap(), "Ropa/Notas.md");
        assert_eq!(create_page_in(&root, "Ropa", "Notas").unwrap(), "Ropa/Notas 2.md");
        assert_eq!(create_page_in(&root, "Ropa", "Notas.md").unwrap(), "Ropa/Notas 3.md");
        assert!(root.join("Ropa/Notas 2.md").is_file());
        assert_eq!(fs::read_to_string(root.join("Ropa/Notas.md")).unwrap(), "");
    }

    #[test]
    fn create_board_dedupes_name_and_writes_empty_canvas() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert_eq!(create_board_in(&root, "Ropa", "Plan").unwrap(), "Ropa/Plan.canvas");
        assert_eq!(create_board_in(&root, "Ropa", "Plan").unwrap(), "Ropa/Plan 2.canvas");
        assert_eq!(create_board_in(&root, "Ropa", "Plan.canvas").unwrap(), "Ropa/Plan 3.canvas");
        assert_eq!(create_board_in(&root, "Ropa", "Plan.CANVAS").unwrap(), "Ropa/Plan 4.canvas");
        let raw = fs::read_to_string(root.join("Ropa/Plan.canvas")).unwrap();
        // exactly what the frontend's `serializeCanvas` writes, so the first edit does not reformat the file
        assert_eq!(raw, "{\n  \"nodes\": [],\n  \"edges\": []\n}\n");
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["nodes"], serde_json::json!([]));
        assert_eq!(v["edges"], serde_json::json!([]));
    }

    #[test]
    fn create_board_rejects_escape_and_bad_names() {
        let (_d, root) = ws();
        assert!(matches!(create_board_in(&root, "..", "x"), Err(AppError::OutsideWorkspace)));
        assert!(create_board_in(&root, "NoExiste", "x").is_err());
        assert!(matches!(create_board_in(&root, "", ".canvas"), Err(AppError::InvalidName(_))));
        assert!(matches!(create_board_in(&root, "", "a/b"), Err(AppError::InvalidName(_))));
    }

    #[test]
    fn ensure_boards_section_appends_once_and_keeps_text() {
        let (_d, root) = ws();
        let original = "# Mis reglas\n\nTexto de Diego sin salto final";
        fs::write(root.join("CLAUDE.md"), original).unwrap();
        ensure_boards_section(&root).unwrap();
        let once = fs::read_to_string(root.join("CLAUDE.md")).unwrap();
        assert!(once.starts_with(original));
        assert_eq!(once.matches("## Pizarras").count(), 1);
        assert!(once.contains(".canvas") && once.contains("decision"));
        ensure_boards_section(&root).unwrap();
        ensure_root(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("CLAUDE.md")).unwrap(), once);
    }

    #[test]
    fn ensure_boards_section_creates_missing_claude_md() {
        let d = tempfile::tempdir().unwrap();
        ensure_boards_section(d.path()).unwrap();
        let md = fs::read_to_string(d.path().join("CLAUDE.md")).unwrap();
        assert_eq!(md.matches("## Pizarras").count(), 1);
    }

    #[test]
    fn new_workspace_claude_md_includes_boards_section() {
        let (_d, root) = ws();
        let md = fs::read_to_string(root.join("CLAUDE.md")).unwrap();
        assert!(md.starts_with(crate::templates::ROOT_CLAUDE_MD));
        assert_eq!(md.matches("## Pizarras").count(), 1);
    }

    #[test]
    fn create_page_in_missing_dir_or_escape_fails() {
        let (_d, root) = ws();
        assert!(create_page_in(&root, "NoExiste", "x").is_err());
        assert!(matches!(create_page_in(&root, "..", "x"), Err(AppError::OutsideWorkspace)));
    }

    #[test]
    fn create_folder_dedupes() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert_eq!(create_folder_in(&root, "Ropa", "Moldes").unwrap(), "Ropa/Moldes");
        assert_eq!(create_folder_in(&root, "Ropa", "Moldes").unwrap(), "Ropa/Moldes 2");
    }

    #[test]
    fn rename_keeps_extension_and_rejects_slash() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let p = create_page_in(&root, "Ropa", "Notas").unwrap();
        assert_eq!(rename_entry_in(&root, &p, "Diseño otoño").unwrap(), "Ropa/Diseño otoño.md");
        assert!(root.join("Ropa/Diseño otoño.md").is_file());
        assert!(matches!(rename_entry_in(&root, "Ropa/Diseño otoño.md", "a/b"), Err(AppError::InvalidName(_))));
        // already has extension: not doubled
        assert_eq!(rename_entry_in(&root, "Ropa/Diseño otoño.md", "Final.md").unwrap(), "Ropa/Final.md");
        // folders have no extension forced
        create_folder_in(&root, "Ropa", "Moldes").unwrap();
        assert_eq!(rename_entry_in(&root, "Ropa/Moldes", "Patrones").unwrap(), "Ropa/Patrones");
    }

    #[test]
    fn rename_collision_gets_suffix_and_same_name_is_noop() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        create_page_in(&root, "Ropa", "A").unwrap();
        create_page_in(&root, "Ropa", "B").unwrap();
        assert_eq!(rename_entry_in(&root, "Ropa/B.md", "A").unwrap(), "Ropa/A 2.md");
        assert_eq!(rename_entry_in(&root, "Ropa/A.md", "A").unwrap(), "Ropa/A.md");
        assert!(rename_entry_in(&root, "", "x").is_err());
        assert!(rename_entry_in(&root, "Ropa/nada.md", "x").is_err());
    }

    #[test]
    fn write_then_read_roundtrip() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let text = "# Diseño otoño\n\n| a | b |\n|---|---|\n| 1 | ñ |\n";
        write_text_in(&root, "Ropa/Diseño otoño.md", text).unwrap();
        assert_eq!(read_text_in(&root, "Ropa/Diseño otoño.md").unwrap(), text);
        write_text_in(&root, "Ropa/Diseño otoño.md", "nuevo").unwrap();
        assert_eq!(read_text_in(&root, "Ropa/Diseño otoño.md").unwrap(), "nuevo");
        // no temp files left behind
        let n = fs::read_dir(root.join("Ropa")).unwrap().count();
        assert_eq!(n, 2); // CLAUDE.md, the page
    }

    #[test]
    fn read_write_reject_dirs_and_missing_parent() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert!(read_text_in(&root, "Ropa").is_err());
        assert!(read_text_in(&root, "Ropa/nada.md").is_err());
        assert!(write_text_in(&root, "Ropa", "x").is_err());
        assert!(write_text_in(&root, "Falta/x.md", "x").is_err());
        assert!(write_text_in(&root, "../x.md", "x").is_err());
    }

    #[test]
    fn images_dir_name_is_nfc() {
        assert_eq!(IMAGES_DIR, "Im\u{e1}genes");
    }

    #[test]
    fn create_exclusive_never_truncates_an_existing_file() {
        let (_d, root) = ws();
        fs::write(root.join("a.png"), [1, 2, 3]).unwrap();
        // the first candidate was free when picked but got taken meanwhile
        let name = create_exclusive(&root, "a", ".png", "a.png".into(), &[9]).unwrap();
        assert_eq!(name, "a 2.png");
        assert_eq!(fs::read(root.join("a.png")).unwrap(), [1, 2, 3]);
        assert_eq!(fs::read(root.join("a 2.png")).unwrap(), [9]);
    }

    #[test]
    fn save_image_lands_in_the_given_folder_level() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        create_folder_in(&root, "Ropa", "Maquila").unwrap();
        let a = save_image_in(&root, "Ropa", "foto ñ.png", &[1, 2, 3]).unwrap();
        assert_eq!(a, "Ropa/Imágenes/foto ñ.png");
        assert_eq!(fs::read(root.join(&a)).unwrap(), [1, 2, 3]);
        let b = save_image_in(&root, "Ropa/Maquila", "p.png", &[7]).unwrap();
        assert_eq!(b, "Ropa/Maquila/Imágenes/p.png");
        assert!(root.join("Ropa/Maquila/Imágenes/p.png").is_file());
        assert!(!root.join("Ropa/Imágenes/p.png").exists());
        // duplicates never overwrite
        assert_eq!(save_image_in(&root, "Ropa", "foto ñ.png", &[9]).unwrap(), "Ropa/Imágenes/foto ñ 2.png");
        assert_eq!(fs::read(root.join(&a)).unwrap(), [1, 2, 3]);
        assert!(save_image_in(&root, "Ropa", "../x.png", &[]).is_err());
        assert!(save_image_in(&root, "Nada", "x.png", &[]).is_err());
        assert!(matches!(save_image_in(&root, "..", "x.png", &[]), Err(AppError::OutsideWorkspace)));
    }

    #[test]
    fn save_attachment_lands_in_space_images_dir() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert_eq!(save_attachment_in(&root, "Ropa", "a.png", &[1]).unwrap(), "Ropa/Imágenes/a.png");
        // any path inside the space: the space is its first segment
        assert_eq!(save_attachment_in(&root, "Ropa/Sub", "a.png", &[1]).unwrap(), "Ropa/Imágenes/a 2.png");
        assert!(save_attachment_in(&root, "", "a.png", &[1]).is_err());
    }

    #[test]
    fn list_images_is_flat_filtered_sorted_and_empty_without_folder() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert!(list_images_in(&root, "Ropa").unwrap().is_empty());
        let dir = root.join("Ropa").join(IMAGES_DIR);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/deep.png"), "").unwrap();
        for n in ["b.PNG", "a.jpg", "c.webp", "d.svg", "e.gif", "f.jpeg", "g.avif", "h.bmp", "notas.md", "sin_ext", ".oculta.png"] {
            fs::write(dir.join(n), "").unwrap();
        }
        let got = list_images_in(&root, "Ropa").unwrap();
        let expected: Vec<String> = ["a.jpg", "b.PNG", "c.webp", "d.svg", "e.gif", "f.jpeg", "g.avif", "h.bmp"]
            .iter()
            .map(|n| format!("Ropa/Imágenes/{n}"))
            .collect();
        assert_eq!(got, expected);
        assert!(list_images_in(&root, "Nada").is_err());
        assert!(matches!(list_images_in(&root, ".."), Err(AppError::OutsideWorkspace)));
    }

    #[test]
    fn import_files_copies_into_the_target_folder_images_dir() {
        let (d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        create_folder_in(&root, "Ropa", "Sub").unwrap();
        let src = d.path().join("tela.jpg");
        fs::write(&src, "img").unwrap();
        let got = import_files_in(&root, "Ropa", &[src.to_string_lossy().into()]).unwrap();
        assert_eq!(got, ["Ropa/Imágenes/tela.jpg"]);
        let got = import_files_in(&root, "Ropa/Sub", &[src.to_string_lossy().into()]).unwrap();
        assert_eq!(got, ["Ropa/Sub/Imágenes/tela.jpg"]);
        let got = import_files_in(&root, "Ropa", &[src.to_string_lossy().into()]).unwrap();
        assert_eq!(got, ["Ropa/Imágenes/tela 2.jpg"]);
        assert!(import_files_in(&root, "Nada", &[src.to_string_lossy().into()]).is_err());
    }

    #[test]
    fn import_files_rejects_relative_and_dirs() {
        let (d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        assert!(import_files_in(&root, "Ropa", &["rel.png".into()]).is_err());
        assert!(import_files_in(&root, "Ropa", &[d.path().to_string_lossy().into()]).is_err());
    }

    #[test]
    fn delete_calls_trasher_and_returns_original_and_trashed() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let page = create_page_in(&root, "Ropa", "Notas").unwrap();
        let seen = std::cell::RefCell::new(Vec::new());
        let got = delete_entry_with(&root, &page, |p| {
            seen.borrow_mut().push(p.to_path_buf());
            Ok(PathBuf::from("/fake/.Trash/Notas.md"))
        })
        .unwrap();
        assert_eq!(seen.borrow().len(), 1);
        assert!(seen.borrow()[0].ends_with("Ropa/Notas.md"));
        assert_eq!(got.original, "Ropa/Notas.md");
        assert_eq!(got.trashed, "/fake/.Trash/Notas.md");
        let v = serde_json::to_value(&got).unwrap();
        assert_eq!(v["original"], "Ropa/Notas.md");
        assert_eq!(v["trashed"], "/fake/.Trash/Notas.md");
        for bad in ["", "../x", "/etc/hosts", "Ropa/nada.md"] {
            let r = delete_entry_with(&root, bad, |_| panic!("must not trash {bad:?}"));
            assert!(r.is_err(), "{bad:?}");
        }
    }

    /// A fake trash folder that satisfies the `.Trash` rule, outside the workspace.
    fn fake_trash(d: &tempfile::TempDir) -> PathBuf {
        let t = d.path().join(".Trash");
        fs::create_dir_all(&t).unwrap();
        t
    }

    #[test]
    fn restore_moves_back_files_and_folders() {
        let (d, root) = ws();
        let trash = fake_trash(&d);
        create_space_in(&root, "Ropa").unwrap();
        let page = create_page_in(&root, "Ropa", "Notas").unwrap();
        fs::write(root.join(&page), "texto").unwrap();
        let t = delete_entry_with(&root, &page, |p| {
            let dest = trash.join("Notas.md");
            fs::rename(p, &dest).unwrap();
            Ok(dest)
        })
        .unwrap();
        assert!(!root.join(&page).exists());
        assert_eq!(restore_entry_in(&root, &t.original, &t.trashed).unwrap(), "Ropa/Notas.md");
        assert_eq!(fs::read_to_string(root.join(&page)).unwrap(), "texto");
        assert!(!trash.join("Notas.md").exists());

        // a whole folder, restored under a parent that vanished
        let folder = trash.join("Moldes");
        fs::create_dir_all(folder.join("in")).unwrap();
        fs::write(folder.join("in/a.txt"), "a").unwrap();
        assert_eq!(restore_entry_in(&root, "Ropa/Moldes", &folder.to_string_lossy()).unwrap(), "Ropa/Moldes");
        assert_eq!(fs::read_to_string(root.join("Ropa/Moldes/in/a.txt")).unwrap(), "a");
    }

    #[test]
    fn restore_never_overwrites() {
        let (d, root) = ws();
        let trash = fake_trash(&d);
        create_space_in(&root, "Ropa").unwrap();
        let page = create_page_in(&root, "Ropa", "Notas").unwrap();
        fs::write(root.join(&page), "nuevo").unwrap();
        fs::write(trash.join("Notas.md"), "viejo").unwrap();
        let err = restore_entry_in(&root, &page, &trash.join("Notas.md").to_string_lossy()).unwrap_err();
        assert_eq!(err.message(), "Ya existe «Notas.md»; no la sobrescribo.");
        assert_eq!(fs::read_to_string(root.join(&page)).unwrap(), "nuevo");
        assert_eq!(fs::read_to_string(trash.join("Notas.md")).unwrap(), "viejo");
    }

    #[test]
    fn restore_rejects_unsafe_original_and_trashed() {
        let (d, root) = ws();
        let trash = fake_trash(&d);
        fs::write(trash.join("x.md"), "x").unwrap();
        let ok = trash.join("x.md").to_string_lossy().to_string();
        for bad in ["../x.md", "/etc/x.md", "a/../../x.md", ""] {
            assert!(restore_entry_in(&root, bad, &ok).is_err(), "{bad:?}");
        }
        assert!(trash.join("x.md").exists());
        // trashed not in a .Trash folder
        let plain = d.path().join("plain.md");
        fs::write(&plain, "p").unwrap();
        assert!(restore_entry_in(&root, "p.md", &plain.to_string_lossy()).is_err());
        assert!(plain.exists());
        // relative, traversal out of the trash, missing, and the trash itself
        assert!(restore_entry_in(&root, "p.md", "x.md").is_err());
        let sneaky = format!("{}/../plain.md", trash.display());
        assert!(restore_entry_in(&root, "p.md", &sneaky).is_err());
        let gone = trash.join("nada.md").to_string_lossy().to_string();
        let err = restore_entry_in(&root, "p.md", &gone).unwrap_err();
        assert!(err.message().contains("papelera"), "{}", err.message());
        assert!(restore_entry_in(&root, "p.md", &trash.to_string_lossy()).is_err());
        assert!(!root.join("p.md").exists());
    }

    #[test]
    #[cfg(unix)]
    fn symlinked_images_dir_cannot_escape_the_workspace() {
        let (d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let outside = d.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("leak.png"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("Ropa").join(IMAGES_DIR)).unwrap();
        assert!(matches!(save_image_in(&root, "Ropa", "a.png", &[1]), Err(AppError::OutsideWorkspace)));
        assert!(matches!(list_images_in(&root, "Ropa"), Err(AppError::OutsideWorkspace)));
        let src = d.path().join("s.jpg");
        fs::write(&src, "i").unwrap();
        assert!(matches!(
            import_files_in(&root, "Ropa", &[src.to_string_lossy().into()]),
            Err(AppError::OutsideWorkspace)
        ));
        assert!(!outside.join("a.png").exists() && !outside.join("s.jpg").exists());
    }

    #[test]
    fn restore_exists_error_has_exact_message_and_kind() {
        let (d, root) = ws();
        let trash = fake_trash(&d);
        create_space_in(&root, "Ropa").unwrap();
        let page = create_page_in(&root, "Ropa", "Notas").unwrap();
        fs::write(trash.join("Notas.md"), "v").unwrap();
        let err = restore_entry_in(&root, &page, &trash.join("Notas.md").to_string_lossy()).unwrap_err();
        assert_eq!(err.kind(), "exists");
        assert_eq!(err.message(), "Ya existe «Notas.md»; no la sobrescribo.");
    }

    #[test]
    #[cfg(unix)]
    fn move_fallback_copies_symlinks_as_symlinks() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(d.path().join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(d.path().join("secret.txt"), src.join("link")).unwrap();
        fs::write(src.join("f.txt"), "f").unwrap();
        let dst = d.path().join("dst");
        copy_recursive(&src, &dst).unwrap();
        assert!(fs::symlink_metadata(dst.join("link")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(dst.join("f.txt")).unwrap(), "f");
    }

    #[test]
    fn move_path_returns_non_cross_device_errors_untouched() {
        let d = tempfile::tempdir().unwrap();
        let missing = d.path().join("nada");
        let err = move_path(&missing, &d.path().join("x")).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(!d.path().join("x").exists());
    }

    #[test]
    fn copy_fallback_keeps_a_destination_that_appeared_meanwhile() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        let to = d.path().join("to");
        fs::create_dir(&to).unwrap();
        fs::write(to.join("mine.txt"), "m").unwrap();
        assert!(move_after_cross_device(&src, &to).is_err());
        assert_eq!(fs::read_to_string(to.join("mine.txt")).unwrap(), "m");
        assert!(src.exists());
    }

    const OLD_ROOT_LINE: &str = "- Las imágenes y archivos adjuntos viven en la carpeta `adjuntos/` de cada espacio. Referéncialos con rutas relativas, por ejemplo `![molde](adjuntos/molde.png)`.";
    const OLD_BOARD_LINE: &str = "- Las imágenes viven en `adjuntos/` y se referencian con ruta relativa a la carpeta de la pizarra, por ejemplo `adjuntos/molde.png` (o `../adjuntos/molde.png` si la pizarra está en una subcarpeta).";

    #[test]
    fn migration_replaces_only_exact_old_lines_and_is_idempotent() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let old_root = format!("# Mío\n{OLD_ROOT_LINE}\notra línea\n## Pizarras\n{OLD_BOARD_LINE}\nfin");
        fs::write(root.join("CLAUDE.md"), &old_root).unwrap();
        ensure_root(&root).unwrap();
        let got = fs::read_to_string(root.join("CLAUDE.md")).unwrap();
        let expected = old_root
            .replace(OLD_ROOT_LINE, crate::templates::NEW_ROOT_IMAGES_LINE)
            .replace(OLD_BOARD_LINE, crate::templates::NEW_BOARD_IMAGES_LINE);
        assert_eq!(got, expected);
        assert!(!got.contains("adjuntos/"));
        ensure_root(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("CLAUDE.md")).unwrap(), expected);
    }

    #[test]
    fn migration_updates_space_claude_md_and_leaves_edited_lines_alone() {
        let (_d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        create_space_in(&root, "Tela").unwrap();
        let old_space = crate::templates::OLD_SPACE_IMAGES_LINE;
        fs::write(root.join("Ropa/CLAUDE.md"), format!("{old_space}\nrest")).unwrap();
        let edited = format!("{} (mi cambio)\n", OLD_ROOT_LINE);
        fs::write(root.join("Tela/CLAUDE.md"), &edited).unwrap();
        let plain = "sin nada viejo\r\nlinea";
        fs::create_dir(root.join("Otra")).unwrap();
        fs::write(root.join("Otra/CLAUDE.md"), plain).unwrap();
        ensure_root(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("Ropa/CLAUDE.md")).unwrap(),
            format!("{}\nrest", crate::templates::NEW_SPACE_IMAGES_LINE)
        );
        assert_eq!(fs::read_to_string(root.join("Tela/CLAUDE.md")).unwrap(), edited);
        assert_eq!(fs::read_to_string(root.join("Otra/CLAUDE.md")).unwrap(), plain);
    }

    #[test]
    fn new_templates_contain_the_migration_target_lines() {
        use crate::templates::*;
        assert!(ROOT_CLAUDE_MD.lines().any(|l| l == NEW_ROOT_IMAGES_LINE));
        assert!(SPACE_CLAUDE_MD.lines().any(|l| l == NEW_SPACE_IMAGES_LINE));
        assert!(BOARDS_SECTION.lines().any(|l| l == NEW_BOARD_IMAGES_LINE));
        for (old, _) in LINE_MIGRATIONS {
            assert!(!ROOT_CLAUDE_MD.contains(old) && !SPACE_CLAUDE_MD.contains(old) && !BOARDS_SECTION.contains(old));
        }
    }

    #[test]
    #[cfg(unix)]
    fn migration_never_writes_through_a_symlinked_claude_md() {
        let (d, root) = ws();
        create_space_in(&root, "Ropa").unwrap();
        let outside = d.path().join("outside.md");
        let body = format!("{OLD_ROOT_LINE}\n");
        fs::write(&outside, &body).unwrap();
        fs::write(root.join("CLAUDE.md"), "mío\n").unwrap();
        fs::remove_file(root.join("Ropa/CLAUDE.md")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("Ropa/CLAUDE.md")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("Ropa/other.md")).unwrap();
        ensure_root(&root).unwrap();
        assert_eq!(fs::read_to_string(&outside).unwrap(), body);
        assert!(fs::symlink_metadata(root.join("Ropa/CLAUDE.md")).unwrap().file_type().is_symlink());
    }

    #[test]
    fn migration_leaves_crlf_lines_untouched() {
        let (_d, root) = ws();
        let crlf = format!("# x\r\n{OLD_ROOT_LINE}\r\nfin\r\n## Pizarras\r\n");
        fs::write(root.join("CLAUDE.md"), &crlf).unwrap();
        ensure_root(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("CLAUDE.md")).unwrap(), crlf);
    }

    #[test]
    fn cross_device_copy_never_truncates_a_file_that_appeared() {
        let d = tempfile::tempdir().unwrap();
        let from = d.path().join("a.txt");
        let to = d.path().join("b.txt");
        fs::write(&from, "origen").unwrap();
        fs::write(&to, "mío").unwrap();
        assert!(copy_recursive(&from, &to).is_err());
        assert_eq!(fs::read_to_string(&to).unwrap(), "mío");
    }

    #[test]
    fn write_text_logged_records_tu_and_shields_the_echo() {
        use crate::activity::{Actor, Clock};
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;
        let (d, root) = ws();
        fs::create_dir(root.join("Ropa")).unwrap();
        let t = Arc::new(AtomicU64::new(5_000));
        let t2 = t.clone();
        let clock: Clock = Arc::new(move || t2.load(Ordering::SeqCst));
        let log = ActivityLog::load(d.path().join("cfg.json"), &root, clock, None);
        write_text_logged(&root, &log, "Ropa/n.md", "hola").unwrap();
        assert_eq!(fs::read_to_string(root.join("Ropa/n.md")).unwrap(), "hola");
        t.store(6_000, Ordering::SeqCst);
        log.ingest(&["Ropa/n.md".into()], |_| true, Actor::Claude);
        assert_eq!(log.snapshot()["Ropa/n.md"].by, Actor::Tu);
    }
}
