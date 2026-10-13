#!/bin/bash
# Daily refresh of the knowledge graph of Diego's notes (espacios/).
# espacios/ is gitignored, so graphify cannot scan it in place: we mirror it
# to a private corpus dir outside the repo and iCloud, then extract through the
# local Claude Code (backend claude-cli: uses the plan, no API key).
set -euo pipefail

SRC="${TYPES_ESPACIOS:-$HOME/Documents/TYPES.nosync/espacios}"
CORPUS="${TYPES_NOTAS_CORPUS:-$HOME/.local/share/types-notas}"
LOG="$HOME/.cache/types-notas.log"
mkdir -p "$CORPUS" "$(dirname "$LOG")" "$HOME/.local/share/types-notas-bin"

exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') notas-grafo ==="

# claude binary: PATH first, else newest VS Code extension build
CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
fi
[ -x "$CLAUDE" ] || { echo "claude binary not found"; exit 1; }
ln -sf "$CLAUDE" "$HOME/.local/share/types-notas-bin/claude"
export PATH="$HOME/.local/share/types-notas-bin:$HOME/Library/Python/3.13/bin:$PATH"
export GRAPHIFY_CLAUDE_CLI_MODEL="${GRAPHIFY_CLAUDE_CLI_MODEL:-sonnet}"

rsync -a --delete --exclude 'graphify-out' --exclude '.DS_Store' "$SRC/" "$CORPUS/"
cd "$CORPUS"
graphify extract . --backend claude-cli
graphify cluster-only . --backend claude-cli || true
echo "ok: $CORPUS/graphify-out/graph.json"
