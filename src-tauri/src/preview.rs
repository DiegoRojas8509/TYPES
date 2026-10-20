//! Tiny normalized outline of a `.canvas` board, for card thumbnails.

use crate::error::Result;
use crate::workspace::{read_text_in, resolve};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::State;

const MAX_NODES: usize = 200;
const MAX_CACHE: usize = 512;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PreviewNode {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct BoardPreview {
    pub nodes: Vec<PreviewNode>,
}

type Key = (String, Option<SystemTime>, u64);

#[derive(Default)]
pub struct PreviewCache(Mutex<HashMap<Key, BoardPreview>>);

/// Parses canvas JSON tolerantly; anything unusable yields fewer or no nodes.
pub fn preview_from_json(text: &str) -> BoardPreview {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return BoardPreview::default();
    };
    let Some(nodes) = v.get("nodes").and_then(|n| n.as_array()) else {
        return BoardPreview::default();
    };
    let num = |n: &serde_json::Value, k: &str| n.get(k).and_then(|x| x.as_f64()).filter(|x| x.is_finite());
    let mut raw: Vec<(f64, f64, f64, f64, String)> = Vec::new();
    for n in nodes {
        let (Some(x), Some(y), Some(w), Some(h)) =
            (num(n, "x"), num(n, "y"), num(n, "width"), num(n, "height"))
        else {
            continue;
        };
        if !(x + w).is_finite() || !(y + h).is_finite() {
            continue;
        }
        let kind = n.get("type").and_then(|t| t.as_str()).unwrap_or("").to_string();
        raw.push((x, y, w, h, kind));
        if raw.len() >= MAX_NODES {
            break;
        }
    }
    if raw.is_empty() {
        return BoardPreview::default();
    }
    let min_x = raw.iter().map(|n| n.0.min(n.0 + n.2)).fold(f64::INFINITY, f64::min);
    let max_x = raw.iter().map(|n| n.0.max(n.0 + n.2)).fold(f64::NEG_INFINITY, f64::max);
    let min_y = raw.iter().map(|n| n.1.min(n.1 + n.3)).fold(f64::INFINITY, f64::min);
    let max_y = raw.iter().map(|n| n.1.max(n.1 + n.3)).fold(f64::NEG_INFINITY, f64::max);
    let span = |lo: f64, hi: f64| {
        let s = hi - lo;
        if s.is_finite() && s > 0.0 { s } else { 1.0 }
    };
    let (sx, sy) = (span(min_x, max_x), span(min_y, max_y));
    let nodes = raw
        .into_iter()
        .map(|(x, y, w, h, kind)| PreviewNode {
            x: ((x - min_x) / sx) as f32,
            y: ((y - min_y) / sy) as f32,
            w: (w.abs() / sx) as f32,
            h: (h.abs() / sy) as f32,
            kind,
        })
        .collect();
    BoardPreview { nodes }
}

/// Validates `rel` against the root; never fails for unreadable content.
pub fn board_preview_in(cache: &PreviewCache, root: &Path, rel: &str) -> Result<BoardPreview> {
    let abs = resolve(root, rel)?;
    if !rel.to_lowercase().ends_with(".canvas") {
        return Ok(BoardPreview::default());
    }
    let Ok(md) = std::fs::metadata(&abs) else {
        return Ok(BoardPreview::default());
    };
    let key: Key = (abs.to_string_lossy().into_owned(), md.modified().ok(), md.len());
    if let Some(hit) = cache.0.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(hit.clone());
    }
    let Ok(text) = read_text_in(root, rel) else {
        return Ok(BoardPreview::default());
    };
    let preview = preview_from_json(&text);
    let mut guard = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.len() >= MAX_CACHE {
        guard.clear();
    }
    guard.insert(key, preview.clone());
    Ok(preview)
}

#[cfg(test)]
impl PreviewCache {
    fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

#[tauri::command(async)]
pub fn board_preview(
    state: State<crate::settings::AppState>,
    cache: State<PreviewCache>,
    path: String,
) -> Result<BoardPreview> {
    board_preview_in(&cache, &state.root(), &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn normalizes_to_unit_box() {
        let p = preview_from_json(
            r#"{"nodes":[{"type":"text","x":100,"y":200,"width":100,"height":50},
                          {"type":"file","x":300,"y":400,"width":100,"height":100}]}"#,
        );
        assert_eq!(p.nodes.len(), 2);
        assert_eq!((p.nodes[0].x, p.nodes[0].y), (0.0, 0.0));
        assert_eq!(p.nodes[0].kind, "text");
        let close = |a: f32, b: f32| (a - b).abs() < 1e-6;
        assert!(close(p.nodes[0].w, 1.0 / 3.0) && close(p.nodes[0].h, 1.0 / 6.0));
        assert!(close(p.nodes[1].x, 2.0 / 3.0) && close(p.nodes[1].y, 2.0 / 3.0));
        let max_x = p.nodes.iter().map(|n| n.x + n.w).fold(0.0, f32::max);
        assert!((max_x - 1.0).abs() < 1e-6);
    }

    #[test]
    fn zero_size_box_has_no_nan() {
        let p = preview_from_json(r#"{"nodes":[{"type":"text","x":5,"y":5,"width":0,"height":0}]}"#);
        assert_eq!(p.nodes.len(), 1);
        let n = &p.nodes[0];
        assert!([n.x, n.y, n.w, n.h].iter().all(|v| v.is_finite()));
    }

    #[test]
    fn limits_to_200_first_nodes() {
        let nodes: Vec<String> = (0..300)
            .map(|i| format!(r#"{{"type":"text","x":{i},"y":0,"width":1,"height":1}}"#))
            .collect();
        let p = preview_from_json(&format!(r#"{{"nodes":[{}]}}"#, nodes.join(",")));
        assert_eq!(p.nodes.len(), 200);
    }

    #[test]
    fn skips_malformed_nodes_and_tolerates_garbage() {
        let p = preview_from_json(
            r#"{"nodes":[{"type":"text","x":"a","y":0,"width":1,"height":1},
                          {"type":"text","x":0,"y":0},
                          5, null,
                          {"x":0,"y":0,"width":10,"height":10}]}"#,
        );
        assert_eq!(p.nodes.len(), 1);
        assert_eq!(p.nodes[0].kind, "");
        for bad in ["", "{no", "[]", r#"{"nodes":3}"#, r#"{"nodes":[1e999]}"#] {
            assert!(preview_from_json(bad).nodes.is_empty(), "{bad}");
        }
        let huge = preview_from_json(r#"{"nodes":[{"x":1.7e308,"y":0,"width":1.7e308,"height":1}]}"#);
        assert!(huge.nodes.is_empty());
    }

    #[test]
    fn file_level_rules_and_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PreviewCache::default();
        board(dir.path(), "a.canvas", r#"{"nodes":[{"type":"text","x":0,"y":0,"width":1,"height":1}]}"#);
        board(dir.path(), "e.canvas", "");
        board(dir.path(), "n.md", "{}");
        assert_eq!(board_preview_in(&cache, dir.path(), "a.canvas").unwrap().nodes.len(), 1);
        assert_eq!(cache.len(), 1);
        board_preview_in(&cache, dir.path(), "a.canvas").unwrap();
        assert_eq!(cache.len(), 1);
        assert!(board_preview_in(&cache, dir.path(), "e.canvas").unwrap().nodes.is_empty());
        assert!(board_preview_in(&cache, dir.path(), "n.md").unwrap().nodes.is_empty());
        assert!(board_preview_in(&cache, dir.path(), "falta.canvas").unwrap().nodes.is_empty());
        assert!(board_preview_in(&cache, dir.path(), "../x.canvas").is_err());
    }

    #[test]
    fn cache_invalidates_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PreviewCache::default();
        board(dir.path(), "a.canvas", r#"{"nodes":[]}"#);
        assert!(board_preview_in(&cache, dir.path(), "a.canvas").unwrap().nodes.is_empty());
        board(dir.path(), "a.canvas", r#"{"nodes":[{"type":"text","x":0,"y":0,"width":1,"height":1}]}"#);
        assert_eq!(board_preview_in(&cache, dir.path(), "a.canvas").unwrap().nodes.len(), 1);
    }
}
