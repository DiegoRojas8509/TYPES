# Pizarras vivas (capa de historial) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que las pizarras no se saturen: lo vigente al frente; lo reemplazado, los escenarios y las suposiciones descartadas pasan a una capa de historial escondida dentro de la misma pizarra, con fecha y motivo, recuperable. Claude archiva solo lo que un dato nuevo reemplaza; lo demás lo propone y Diego aprueba.

**Architecture:** Un nodo archivado es un nodo normal del `.canvas` con un campo extra `archived: {at, reason, by}`. El tablero lo marca `hidden` en React Flow (sigue en el estado y se guarda tal cual, así no se pierde nada), un panel «Historial» lista y restaura, y las reglas para Claude van en `espacios/CLAUDE.md` (sección nueva, con migración idempotente).

**Tech Stack:** React 19 + TS + `@xyflow/react`, Rust (plantillas), Vitest, `cargo test`.

**Spec:** conversación del 2026-10-21 con Diego. Decisiones suyas: historial como capa escondida dentro de la misma pizarra (un solo archivo); Claude archiva solo lo que un dato nuevo reemplaza, y el resto lo propone y Diego aprueba; aplica a todas las pizarras («no quiero pizarras saturadas»).

## Global Constraints
- Leer `CLAUDE.md` completo antes de tocar código. Interfaz en español; código e identificadores en inglés.
- Nunca perder datos: archivar NUNCA borra; un nodo archivado se conserva byte a byte (todos sus campos) y sigue en el JSON; abrir una pizarra no la escribe; ediciones parchean sin reescribir lo que no se tocó; un `.canvas` inválido sigue en solo lectura.
- Formato: campo opcional `archived: { at: "YYYY-MM-DD", reason: string, by?: "claude" | "tu" }` en cualquier nodo. Un `archived` malformado (no objeto, sin `at` válido) se trata como NO archivado y se conserva tal cual. Claude escribe/lee este campo con Read/Edit.
- Aristas: una arista con un extremo archivado se oculta; no se borra del archivo.
- Estado visual (`hidden`) nunca se persiste en el `.canvas` (igual que `zIndex`/`measured`).
- Los bloques consumen solo `boardActions.ts` (`useBoardActions`); BoardView.tsx no debe crecer más de ~15 líneas (extraer a módulos); las features no se importan entre sí; tokens de tipografía y color existentes; TDD; sin ruido en consola; `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit` verdes antes de cada commit; commits en `feat/pizarra`, sin push; cada commit termina con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
- Un nodo archivado conserva TODOS sus campos (incluidos extras desconocidos) tras archivar, restaurar, y tras cualquier otra edición de la pizarra.
- Mezcla por bloque (`mergeCanvasText`): archivar un bloque mientras Claude edita otro no pierde ninguno; si ambos tocan el mismo bloque se avisa.
- Archivar/restaurar un grupo (zona) o un bloque con aristas no deja aristas colgando visibles ni borra nada.
- Un nodo con `archived` malformado no desaparece de la pantalla (no se oculta por error).
- El panel «Historial» no ejecuta contenido de los bloques (todo como texto plano).
- La migración de la sección en `espacios/CLAUDE.md` no toca texto de Diego y no se duplica.

---

### Task 1: Capa de historial en la pizarra (frontend)

**Files:** `src/lib/canvas.ts` (+test), `src/features/board/boardModel.ts` (+test), `src/features/board/boardActions.ts`, `src/features/board/BoardView.tsx` (mínimo), `src/features/board/HistoryPanel.tsx` (+css, test), `src/features/board/historyModel.ts` (+test), `src/features/board/nodes/BlockShell.tsx` (botón archivar), `src/features/board/CleanButton.tsx`.

**Interfaces (produce):**
- `src/lib/canvas.ts`: `type Archived = { at: string; reason: string; by?: "claude" | "tu" }`; `archivedOf(node: CanvasNode): Archived | null` (null si falta o es inválido: `at` debe cumplir `^\d{4}-\d{2}-\d{2}$`, `reason` string; `by` solo si es «claude» o «tu»); `archiveNode(node, reason, by, now?: Date): CanvasNode` (agrega el campo sin tocar el resto); `restoreNode(node): CanvasNode` (quita solo `archived`).
- `boardModel.ts`: `toFlowNode` marca `hidden: true` si `archivedOf(node)`; las aristas visibles excluyen las que tocan un nodo archivado (solo para mostrar; `fromFlow` guarda TODAS); `fromFlowNode` ignora `hidden`.
- `boardActions.ts`: `useBoardActions()` gana `archive(id: string, reason?: string): void` y `restore(id: string): void` (aplican `archiveNode(..., "tu")` / `restoreNode` con el mismo camino de persistencia que `update`; respetan `editableRef`).
- `historyModel.ts`: `historyEntries(nodes): HistoryEntry[]` — solo nodos archivados válidos; `{id, type, title, snippet, at, reason, by}` con `title` por tipo (text: primer `#`; table/chart/timeline/decision: `title`/`question`; group: `label`; file: nombre; otros: tipo) y `snippet` ≤ 120 caracteres de texto plano; orden por `at` descendente y luego por posición en el archivo.

- [ ] **Bloques:** cada bloque (BlockShell) muestra, al pasar el cursor o enfocarlo, un botón «Archivar» (icono + `aria-label="Archivar «título»"`, alcanzable con teclado, oculto en solo lectura); al pulsarlo pide un motivo corto en un campo inline («¿Por qué se archiva? (opcional)», Enter confirma, Esc cancela) y llama `archive(id, reason)`. Sin motivo → «archivado a mano».
- [ ] **Panel «Historial»:** botón en la barra de la pizarra «Historial (N)» (N = archivados válidos; oculto si N = 0 salvo que el panel esté abierto) que abre un panel lateral (mismo lenguaje que `ImagePanel`: portal en `.board-flow`) con la lista (`historyEntries`): tipo (icono), título, fragmento, «archivado el {fecha} · {motivo} · {Claude|tú}», botones «Restaurar» y «Ver en la pizarra» (lo muestra temporalmente: centra la vista y lo resalta sin restaurarlo; si es complejo, omite «Ver» y documéntalo). Texto siempre plano. Estado vacío: «Aún no hay nada archivado.» Solo lectura: lista sin botones.
- [ ] **«Limpiar con Claude»** (en el panel y como entrada junto a «Ordenar con Claude» si hay espacio): envía por el chat (mismo camino que `OrderButton`, mismas reglas de deshabilitado) exactamente: `Revisa la pizarra "<nombre>" y dime qué bloques archivarías y por qué: datos reemplazados por uno más nuevo, escenarios o suposiciones descartados y bloques repetidos. Haz una lista corta. No cambies nada hasta que yo diga que sí. Cuando apruebe, archívalos agregando el campo "archived" (at, reason, by: "claude") sin borrar nada.`
- [ ] **Tests (RED primero):** `archivedOf` (válido, `at` malformado, `reason` no string, `by` desconocido, campo no objeto); `archiveNode`/`restoreNode` conservan todos los campos extra (deep equal sobre un nodo con campos desconocidos); `toFlowNode` hidden solo con archived válido (malformado → visible); aristas visibles vs guardadas; el JSON guardado tras archivar contiene el nodo completo + `archived` y NO contiene `hidden`; `historyEntries` (orden, títulos por tipo, snippet); botón «Archivar» + motivo (Enter/Esc), `archive`/`restore` llaman a la persistencia con el patrón correcto y NO escriben al abrir; panel (lista, restaurar, vacío, solo lectura, texto hostil literal); botón «Limpiar» envía el texto exacto y se deshabilita igual que «Ordenar». Mezcla: archivar un bloque mientras otro cambia en disco con `mergeCanvasText` no pierde ninguno.
- [ ] Commit `feat: history layer for boards (archive and restore blocks)`.

### Task 2: Reglas para Claude y migración
**Files:** `src-tauri/src/templates.rs`, `src-tauri/src/workspace.rs` (+tests), `CLAUDE.md` del repo.
- Nueva constante `LIVING_BOARDS_SECTION` con el encabezado `## Pizarras vivas` y reglas en español: pizarras cortas, solo lo vigente al frente; cuando un dato nuevo reemplaza a uno viejo (precio, tarifa, fecha, cantidad, condición) NO dejes los dos: archiva el viejo agregando al nodo `"archived": {"at":"AAAA-MM-DD","reason":"<por qué cambió, p. ej. «ahora $30, antes $32»>","by":"claude"}` y deja el nuevo dato visible; lo mismo con escenarios y suposiciones que Diego descartó; lo que NO está reemplazado sino solo te parece viejo o repetido NO lo archives: propónselo y espera su sí; nunca borres un bloque; las decisiones pendientes viven en bloques `decision` visibles; el motivo siempre dice qué lo reemplazó. Incluye un ejemplo de nodo archivado en JSON.
- `ensure_living_boards_section(root)`: igual patrón que `ensure_boards_section` (agrega al final del `CLAUDE.md` raíz si NO existe una línea exactamente `## Pizarras vivas`; idempotente; bytes anteriores intactos; atómico vía `write_text_in`; no sigue symlinks fuera). `ensure_root` la llama después de `ensure_boards_section`. Los espacios heredan la regla del archivo raíz.
- [ ] Tests (RED primero): agrega una vez; idempotente; no toca nada de lo anterior (archivo de 40 líneas manuales + sección Pizarras); archivo sin salto final; CRLF; symlink fuera del root se salta; la sección contiene el campo `archived` con el formato exacto del plan.
- [ ] Actualizar `CLAUDE.md` del repo (formato `.canvas`: campo `archived`; reglas §5: archivar nunca borra, estado `hidden` no se persiste, mezcla; §7 decisiones: historial como capa escondida; Claude archiva solo lo reemplazado). Commit `feat: living boards rules for Claude and archived field docs`.

### Task 3: Cierre
- [ ] Revisión final (Opus) de las dos tareas juntas, correcciones, `pnpm test`, `cargo test`, `npx tsc --noEmit`, `pnpm tauri build --bundles app`, `graphify update .`, push a `feat/pizarra`. Prueba real con Diego: en «Daring Martin · cálculos» pulsar «Limpiar con Claude», aprobar la lista, ver cómo queda la pizarra y abrir «Historial».
