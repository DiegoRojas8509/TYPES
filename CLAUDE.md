# Types

App de escritorio personal de Diego: su mesa de trabajo para negocios reales (el primero: un proyecto de ropa). Organiza ideas en pizarras (bloques de nota, tabla, gráfica, imagen, línea de tiempo y decisión) y su Claude Code trabaja sobre esos mismos archivos desde un panel de chat dentro de la app: analiza, costea, genera reportes, dashboards y previews de moldes, y Diego ve en vivo lo que hace.

## 0. Arranque
Memoria visible en `~/Documents/CLAUDE/memorias/TYPES`. Skills de la biblioteca prendidas aquí: ver `.claude/skills/`.
Para features nuevas usa superpowers (brainstorming → writing-plans → subagent-driven-development). Para UI usa frontend-design (y ui-ux-pro-max cuando se prenda).

## 1. Regla de modelos (de Diego, 2026-10-12)
- **Pensar con Opus:** diseño, arquitectura, planes, decisiones y revisión de código los hace la sesión principal en Opus.
- **Programar con Sonnet:** todo el código lo escriben subagentes lanzados con `model: "sonnet"` (el Sonnet más reciente disponible), uno por tarea del plan.
- Cada subagente recibe la tarea del plan y debe leer este CLAUDE.md completo antes de tocar código. Si la guía y la tarea chocan, se detiene y lo reporta; no improvisa arquitectura.

## 2. Qué es y qué no es
**Es:** pizarra creativa (`.canvas`) + editor de notas Markdown + gestor de archivos + panel de Claude, todo sobre una carpeta local de archivos normales.
**No es:** una app web, un servicio con backend, ni un producto multiusuario. No lleva API key propia: usa el Claude Code ya instalado y logueado en la Mac.
**Lo que la haría fallar aunque funcione:** que Claude no pueda leer o escribir lo que Diego ve; que la app pierda o reescriba texto de Diego; que los datos queden encerrados en un formato que solo la app entiende.

## 3. Fases
| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Espacios y páginas, editor Markdown, visor de HTML e imágenes, refresco en vivo, panel de chat con Claude | Código completo (tareas 1-7, pruebas verdes) y `Types.app` compilada. **Falta la prueba real con la ventana abierta** (plan, Tarea 8 paso 3; se cubre junto con la de la pizarra): ver `docs/superpowers/plans/2026-10-12-types-fase-1.md` |
| Pizarra | Pizarras `.canvas` (JSON Canvas + bloques extra) como página principal; el "+" crea pizarras; Claude sabe cuál está abierta y la puede ordenar | Código completo (tareas 1-9, pruebas verdes), `Types.app` compila. **Falta la prueba real con la ventana abierta**: ver `docs/superpowers/plans/2026-10-14-pizarra.md` (Tarea 10) |
| 2 | Tableros tipo Trello | Absorbida por la pizarra (zonas + bloques de proceso). Solo se retoma si Diego pide columnas/tarjetas estilo Kanban |
| 3 | Exportación (Google Drive y otros destinos) | Pendiente |

## 4. Arquitectura

### Stack
Tauri 2 · Rust · React 19 + TypeScript + Vite · pnpm · Zustand (estado) · Tiptap con serialización Markdown (editor de notas `.md`) · `@xyflow/react` (pizarra) · `recharts` (gráficas) · Vitest y `cargo test`.
Antes de usar una librería, confirma su API actual con context7; no programes de memoria.

### Dónde vive cada cosa
- **Carpeta física:** `~/Documents/TYPES.nosync` (el sufijo `.nosync` evita que iCloud la suba y permite liberar espacio). `~/Documents/TYPES` NO es un symlink (iCloud lo convirtió en carpeta propia); no lo uses para datos.
- **Código:** todo el repo salvo `espacios/`.
- **Carpeta de datos (workspace):** por defecto `~/Documents/TYPES.nosync/espacios` (ruta real, nunca `~/Documents/TYPES`: ahí no hay symlink sino una carpeta de iCloud y los datos se saldrían a la nube; decisión de Diego, 2026-10-13: todo local), configurable desde la app. Está en `.gitignore`: **son datos de negocio y el repo de GitHub es público, nunca se commitean.**
- **Contrapartida conocida:** Claude Code carga los CLAUDE.md de todas las carpetas padre. El agente que arranca en `espacios/<espacio>` también lee esta guía de desarrollo (regla de modelos, arquitectura). Es ruido, no un fallo. Si estorba, evaluar `claudeMdExcludes` en los ajustes del workspace; confirma primero que ese ajuste existe en la versión instalada.

### Formato del workspace
```
espacios/
  CLAUDE.md            reglas de formato para Claude (plantilla que crea la app)
  Ropa/                un espacio = un negocio o proyecto
    CLAUDE.md          contexto de ese negocio (proveedores, tarifas, mermas, márgenes)
    *.canvas           pizarras: la página principal (lo que crea el "+")
    *.md               notas Markdown: ya existentes y los CLAUDE.md; se abren en el editor
    *.html             salidas visuales de Claude: dashboards, reportes, previews de moldes
    adjuntos/          imágenes y archivos que Diego suelta en una pizarra, nota o chat
```
- Una pizarra es un `.canvas`: JSON Canvas (`{nodes, edges}`; todo nodo lleva `id, type, x, y, width, height, color?`) más bloques extra. Tipos: `text` (nota Markdown), `file` (imagen, ruta relativa a la carpeta del `.canvas`, normalmente en `adjuntos/`), `group` (zona), `table`, `chart`, `timeline`, `decision`; un tipo desconocido se conserva intacto. Campos de cada tipo: plan `docs/superpowers/plans/2026-10-14-pizarra.md`, sección "Formato `.canvas`".
- El "+" del sidebar crea pizarras. Los `.md` siguen abriéndose y guardándose en el editor Tiptap, pero ya no se crean desde la app. Sin formato propietario ni base de datos: ambos son texto plano legible fuera de la app.
- Los HTML que genera Claude deben ser autocontenidos (CSS y JS inline), porque el visor los muestra aislados.
- El sistema de archivos es la única fuente de verdad. La app no guarda copia del contenido.

### Backend (Rust, `src-tauri/src/`)
| Módulo | Responsabilidad |
|--------|-----------------|
| `workspace.rs` | Raíz del workspace, árbol, leer/escribir, crear/renombrar/borrar (a la papelera), importar adjuntos, `create_board` (crea un `.canvas` vacío sin pisar nombres). Toda ruta se valida contra la raíz. |
| `templates.rs` | Plantillas de los CLAUDE.md del workspace y de cada espacio, incluida la sección `## Pizarras` (reglas del `.canvas` para Claude; se agrega al CLAUDE.md raíz existente sin tocar el resto). |
| `watcher.rs` | Vigila el workspace y emite el evento `fs-changed` al frontend. |
| `claude.rs` | Localiza el binario de Claude Code, lo lanza en la carpeta del espacio y retransmite su salida como eventos `claude-event`. |
| `settings.rs` | Ajustes persistentes (raíz del workspace, ruta manual del binario). |

### Frontend (`src/`)
`lib/api.ts` (única puerta a `invoke` y eventos) · `lib/useDocument.ts` (máquina de estados de un archivo abierto, compartida por notas y pizarras) · `store/` · `features/sidebar` · `features/editor` (notas `.md`) · `features/board` (pizarra y sus bloques; lógica de formato en `lib/canvas.ts`) · `features/viewer` · `features/chat` · `features/shell` (router de documentos `DocumentPane`, avisos, iconos y paneles).
Cada feature es dueña de sus componentes y su lógica. Se comunican por los stores de zustand: importar el módulo de STORE de otra feature (p. ej. `features/chat/conversations`) es el canal permitido; importar sus componentes no. `features/shell` es el router: es el único lugar que puede montar los componentes de entrada de las features (`DocumentPane` monta editor, pizarra y visores), y sus iconos son piezas compartidas que cualquier feature puede importar.

### Integración con Claude Code
- Binario, en este orden: ruta manual en ajustes → `claude` en el PATH del shell de login → la extensión de VS Code más reciente en `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude`. (En esta Mac hoy solo existe la tercera.)
- Un proceso por mensaje: `claude -p <texto> --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools Read Write Edit Glob Grep WebSearch WebFetch Bash Skill Agent NotebookEdit [--model <alias>] [--resume <session_id>]`, con `cwd` = carpeta del espacio.
- Una conversación por espacio; el `session_id` se guarda para continuarla.
- Si hay una pizarra `.canvas` abierta dentro del espacio, el prompt empieza con `Pizarra abierta: <ruta relativa al espacio>` (parámetro `board` de `claude_send`). El botón "Ordenar con Claude" de la pizarra solo envía un mensaje por el chat; nunca escribe el `.canvas`.
- Las imágenes del chat se guardan en `<espacio>/adjuntos/` y se le pasan a Claude como rutas en el mensaje.
- Bash, Skill, Agent y NotebookEdit permitidos al agente embebido (decisión de Diego, 2026-10-13: mismos accesos que Claude Code en su terminal). En modo no interactivo no hay forma de aprobar permisos, así que van sin restricción. Riesgo aceptado: una nota o página web con instrucciones maliciosas podría hacerle ejecutar comandos. Si hace falta, diseñar una interfaz de permisos o restringir con `Bash(patrón)`.
- Selector de modelo en el compositor (`src/lib/model.ts`, se guarda en localStorage); se pasa como `--model` por mensaje. "Predeterminado" = el modelo por defecto del Claude Code instalado.

## 5. Reglas de implementación
- **Nunca perder texto de Diego.** Guardado automático con espera de 800 ms. Si un archivo abierto cambia en disco: sin cambios locales pendientes se recarga solo; con cambios pendientes se avisa y Diego elige.
- **No reescribir lo que no se editó.** Abrir una página o pizarra no la guarda. Solo se escribe a disco cuando Diego modifica algo.
- **Pizarras:** una edición parchea el dato crudo solo del bloque tocado; nunca reescribe bloques que Diego no tocó (conserva campos extra/desconocidos y entradas que no son objeto). Un `.canvas` inválido o vacío se abre en solo lectura y nunca se sobrescribe. Los cambios de Diego y los de Claude se fusionan por bloque (hook de merge de `useDocument`), no por archivo completo. Las notas cuyo Markdown el editor no puede conservar quedan en solo lectura.
- **Accesibilidad de bloques:** el estado de un bloque (p. ej. hecho/en curso/pendiente, opción elegida) se distingue sin depender solo del color, y todo control es alcanzable con teclado.
- **Rutas seguras.** Ningún comando acepta rutas que salgan de la raíz del workspace (`..`, absolutas, symlinks hacia afuera).
- **Borrar manda a la papelera**, nunca elimina definitivo.
- Interfaz en español; código, identificadores y commits en inglés.
- TDD en la lógica (Rust y utilidades TS). Commits chicos y frecuentes en la rama de trabajo, nunca directo a `main`.
- Diseño visual: sobrio y denso tipo Notion, tema claro y oscuro, sin adornos. Sin gatos.

## 6. Comandos
```bash
pnpm install          # dependencias
pnpm tauri dev        # app en desarrollo
pnpm test             # Vitest
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app   # -> src-tauri/target/release/bundle/macos/Types.app (arrastra al Dock)
```
Entorno: Node solo por nvm (`source ~/.nvm/nvm.sh`), Rust por rustup (`~/.cargo/bin`). Sin Xcode completo: solo Command Line Tools.

## 7. Decisiones tomadas por Claude (Diego puede cambiarlas)
- Workspace dentro del proyecto pero ignorado por git: `~/Documents/TYPES.nosync/espacios` (cambio pedido por Diego; antes estaba fuera del repo).
- Tiptap + Markdown como editor de notas `.md` (ya no es el formato de página nuevo; ver pizarra).
- Pizarra en formato JSON Canvas `.canvas` con bloques extra (`table`, `chart`, `timeline`, `decision`); los tipos desconocidos se conservan sin tocar.
- `@xyflow/react` en vez de tldraw (licencia). Su atribución está oculta vía `proOptions`: la licencia MIT lo permite, pero React Flow pide mantenerla visible si no se patrocina. Diego debe saberlo y puede cambiarlo.
- `recharts` para las gráficas.
- Fusión por bloque con el hook de merge de `useDocument` en vez de un conflicto de archivo completo, para que moverse un bloque y que Claude escriba otro no pierda nada.
- En un bloque `decision`, `chosen` se guarda por nombre de opción; un `chosen` huérfano se conserva y se avisa, nunca se borra en silencio.
- Agente embebido con `acceptEdits`; Bash/Skill/Agent/NotebookEdit se habilitaron después por decisión de Diego (ver Integración con Claude Code).
- Un proceso de Claude por mensaje con `--resume`, en lugar de un proceso vivo.
- Editor (`@tiptap/markdown` 3.x): al primer guardado normaliza la sintaxis (viñetas a `-`, tablas realineadas, sin salto de línea final); no se escribe nada hasta que Diego edita. Las páginas con YAML, comentarios HTML, bloques HTML o notas al pie se abren en solo lectura porque el editor las corrompería (Diego puede forzar la edición). Imágenes en disco: ruta relativa a la carpeta de la página (`adjuntos/a.png`, o `../adjuntos/a.png` en subcarpetas).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Grafo de los apuntes (espacios/)
`espacios/` está en `.gitignore`, así que graphify no la ve en sitio. Un job diario (launchd `com.diego.types-notas`, 22:00; si la Mac duerme corre al despertar) ejecuta `scripts/notas-grafo.sh`: espeja `espacios/` a `~/.local/share/types-notas/` (fuera de iCloud y del repo) y extrae con el backend `claude-cli` (usa el plan de Claude Code, sin API key; modelo sonnet). Es incremental: solo reprocesa notas nuevas o cambiadas. Log: `~/.cache/types-notas.log`.
- Consultar los apuntes: `graphify query "<pregunta>" --graph ~/.local/share/types-notas/graphify-out/graph.json` (también `path` y `explain`). El grafo del código sigue en `graphify-out/` del repo.
- Refresco manual: `scripts/notas-grafo.sh`. Si el grafo pudo quedar viejo (notas del mismo día), correrlo antes de consultar.
