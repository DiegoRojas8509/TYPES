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
| Imágenes | Repositorio `Imágenes/` por carpeta, panel de imágenes en la pizarra, deshacer borrados, escala tipográfica mayor y sidebar colapsable (rama `feat/pizarra`) | Código completo (pruebas verdes), `Types.app` compila y firmada. **Falta la prueba real con la ventana abierta** (se cubre junto con la de la pizarra): ver `docs/superpowers/specs/2026-10-16-imagenes-design.md` |
| Pizarra | Pizarras `.canvas` (JSON Canvas + bloques extra) como página principal; el "+" crea pizarras; Claude sabe cuál está abierta y la puede ordenar | Código completo (tareas 1-9, pruebas verdes), `Types.app` compila. **Falta la prueba real con la ventana abierta**: ver `docs/superpowers/plans/2026-10-14-pizarra.md` (Tarea 10) |
| Tarjetas | Navegación por tarjetas (Inicio / carpeta / pizarra) con miniaturas, hora y autor, y sidebar plegada por defecto (rama `feat/pizarra`) | Código completo (pruebas verdes). **Falta la prueba real con la ventana abierta**: ver `docs/superpowers/plans/2026-10-19-tarjetas.md` |
| Memoria | Memoria automática por espacio (cronista, fuera del repo) + en Types: estado, panel de lectura, «Cerrar tema» y medidor de contexto (rama `feat/pizarra`) | Código completo (pruebas verdes), `Types.app` compila. **Falta la prueba real con la ventana abierta** (incluye el camino real app → `python3` → `claude`, sin verificar): ver `docs/superpowers/plans/` y `.superpowers/sdd/2026-10-20-memoria/` |
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
    Imágenes/          imágenes de esta carpeta (se crea al subir la primera); cada subcarpeta tiene la suya
```
- Una pizarra es un `.canvas`: JSON Canvas (`{nodes, edges}`; todo nodo lleva `id, type, x, y, width, height, color?`) más bloques extra. Tipos: `text` (nota Markdown), `file` (imagen, ruta relativa a la carpeta del `.canvas`, normalmente en la `Imágenes/` de esa misma carpeta, p. ej. `Imágenes/x.png`), `group` (zona), `table`, `chart`, `timeline`, `decision`; un tipo desconocido se conserva intacto. Campo opcional en cualquier nodo: `archived: {at: "AAAA-MM-DD", reason: string, by?: "claude"|"tu"}` (capa de historial; `archivedOf` en `lib/canvas.ts` lo valida y uno malformado se ignora). Un nodo archivado se oculta en la pizarra y se lista en el panel «Historial» (restaurable); sus aristas se guardan pero no se dibujan. Campos de cada tipo: plan `docs/superpowers/plans/2026-10-14-pizarra.md`, sección "Formato `.canvas`".
- El "+" (del sidebar y de la vista de carpeta) crea pizarras. Los `.md` siguen abriéndose y guardándose en el editor Tiptap, pero ya no se crean desde la app. Sin formato propietario ni base de datos: ambos son texto plano legible fuera de la app.
- Los HTML que genera Claude deben ser autocontenidos (CSS y JS inline), porque el visor los muestra aislados.
- El sistema de archivos es la única fuente de verdad. La app no guarda copia del contenido.

### Backend (Rust, `src-tauri/src/`)
| Módulo | Responsabilidad |
|--------|-----------------|
| `workspace.rs` | Raíz del workspace, árbol, leer/escribir, crear/renombrar/borrar (a la papelera), importar archivos, `create_board` (crea un `.canvas` vacío sin pisar nombres), repositorio de imágenes por carpeta (`save_image`/`list_images` sobre `<carpeta>/Imágenes/`, `save_attachment` para el chat), `TreeNode.modified` (mtime en ms), `delete_entry` (devuelve `{original, trashed}`) y `restore_entry` (deshacer), y la migración de arranque de los CLAUDE.md viejos. Toda ruta se valida contra la raíz. |
| `templates.rs` | Plantillas de los CLAUDE.md del workspace y de cada espacio, incluida la sección `## Pizarras` y las líneas viejas de `adjuntos/` que la migración reemplaza (reglas del `.canvas` para Claude; se agrega al CLAUDE.md raíz existente sin tocar el resto). |
| `preview.rs` | Comando `board_preview`: miniatura ligera (bloques) de un `.canvas`, con caché; solo lectura. |
| `activity.rs` | Registro de actividad (`activity`; evento `activity-changed`) en `actividad.json` dentro del directorio de config de la app, **fuera del workspace**. Clasifica quién modificó cada archivo (ver §5). |
| `memory.rs` | Comandos `memory_status` (índice de `MEMORY.md` + conteo de datos/decisiones + mtime) y `memory_read` (solo `MEMORY.md` o `cronista-*.md` planos, sin symlinks, máx. 200 KB). Calcula la carpeta de memoria con el mismo `slug` que el cronista (todo carácter no alfanumérico -> `-`). Solo lectura. |
| `memory_close.rs` | Comando `memory_close_topic`: ejecuta `cronista.py --now` sobre el transcript de la sesión, en su propio grupo de procesos (se mata completo al vencer), timeout 150 s, uno a la vez (`CloseState`). Devuelve los cambios con diff de líneas; fallos y timeouts vuelven como `ok:false`, no como rechazo. PATH propio para lanzarse desde la app GUI. |
| `watcher.rs` | Vigila el workspace y emite el evento `fs-changed` al frontend. |
| `claude.rs` | Localiza el binario de Claude Code, lo lanza en la carpeta del espacio y retransmite su salida como eventos `claude-event`. |
| `settings.rs` | Ajustes persistentes (raíz del workspace, ruta manual del binario). |

### Memoria automática (cronista)
- **Qué es:** tras cada respuesta de Claude en una sesión cuyo cwd cuelga de `~/Documents/TYPES.nosync/espacios`, un hook Stop del plugin `sistema` (v1.2.0, **fuera de este repo**: `~/Documents/CLAUDE/repositorio/plugins/sistema/scripts/cronista.py`, entrada `cronista.sh`, hook en `hooks/hooks.json`) lanza en segundo plano una corrida de Haiku que escribe datos duraderos (precios, tarifas, decisiones, relaciones, preferencias, con fechas e historial) en la memoria **nativa** de Claude para ese espacio: `~/.claude/projects/<slug>/memory/`, archivos `cronista-*.md` + un bloque marcado en `MEMORY.md`. Los accesos `~/Documents/CLAUDE/memorias/<proyecto>` son symlinks a esa misma carpeta.
- **Límites:** ≥400 caracteres nuevos, una corrida cada 5 min por sesión, ≤$0.10 por corrida, modelo confinado con `--restricted` y trabajando en una carpeta de paso (`~/.cache/cronista/work/`; el script aplica solo `cronista-*.md` válidos y el bloque de `MEMORY.md`, jamás otro archivo; lo ajeno solo se registra). Redacta secretos antes y después. Lista de alcance extra (una ruta por línea): `~/Documents/CLAUDE/cronista-alcance.txt` (opcional, hoy no existe). Log: `~/Documents/CLAUDE/cronista.log`.
- **Apagar:** quitar la entrada `Stop` de `hooks.json` del plugin y `claude plugin update sistema@bastian`; o `CRONISTA_RUNNING=1` en el entorno.
- **Lo que añade Types** (`src/features/chat/`): comandos `memory_status` / `memory_read` / `memory_close_topic`; `MemoryBadge` (estado, solo en el chat vacío, el panel y el diálogo), `MemoryPanel` (lista y contenido, **solo lectura**), diálogo «Cerrar tema» (`CloseTopic`: guarda lo pendiente, muestra los cambios y ofrece abrir conversación nueva), `ContextMeter` (tokens de contexto de la última respuesta, `contextTokens` por conversación; avisa desde 100k y marca alto por encima de 200k, y ofrece «Cerrar tema») y `MemoryRefresher` (refresca el estado 8 s y 30 s después de que termina una corrida). Diego edita los archivos de memoria fuera de la app.

### Frontend (`src/`)
`lib/api.ts` (única puerta a `invoke` y eventos) · `lib/useDocument.ts` (máquina de estados de un archivo abierto, compartida por notas y pizarras) · `store/` (`app.ts` + `browseSlice.ts`) · `lib/headerSlot.tsx` (ranura de la cabecera compartida: las features inyectan controles con `HeaderControls`) · `features/sidebar` · `features/home` (tarjetas) · `features/editor` (notas `.md`) · `features/board` (pizarra y sus bloques; lógica de formato en `lib/canvas.ts`) · `features/viewer` · `features/chat` · `features/shell` (router de documentos `DocumentPane` —cabecera con migas de pan sobre Inicio, carpeta o archivo abierto—, avisos, iconos y paneles).
Cada feature es dueña de sus componentes y su lógica. Se comunican por los stores de zustand: importar el módulo de STORE de otra feature (p. ej. `features/chat/conversations`) es el canal permitido; importar sus componentes no. `features/shell` es el router: es el único lugar que puede montar los componentes de entrada de las features (`DocumentPane` monta editor, pizarra y visores), y sus iconos son piezas compartidas que cualquier feature puede importar.

### Integración con Claude Code
- Binario, en este orden: ruta manual en ajustes → `claude` en el PATH del shell de login → la extensión de VS Code más reciente en `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude`. (En esta Mac hoy solo existe la tercera.)
- Un proceso por mensaje: `claude -p <texto> --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools Read Write Edit Glob Grep WebSearch WebFetch Bash Skill Agent NotebookEdit [--model <alias>] [--resume <session_id>]`, con `cwd` = carpeta del espacio.
- Una conversación por espacio; el `session_id` se guarda para continuarla.
- Si hay una pizarra `.canvas` abierta dentro del espacio, el prompt empieza con `Pizarra abierta: <ruta relativa al espacio>` (parámetro `board` de `claude_send`). El botón "Ordenar con Claude" de la pizarra solo envía un mensaje por el chat; nunca escribe el `.canvas`.
- Las imágenes del chat se guardan en `<espacio>/Imágenes/` (`save_attachment`) y se le pasan a Claude como rutas en el mensaje.
- Bash, Skill, Agent y NotebookEdit permitidos al agente embebido (decisión de Diego, 2026-10-13: mismos accesos que Claude Code en su terminal). En modo no interactivo no hay forma de aprobar permisos, así que van sin restricción. Riesgo aceptado: una nota o página web con instrucciones maliciosas podría hacerle ejecutar comandos. Si hace falta, diseñar una interfaz de permisos o restringir con `Bash(patrón)`.
- Selector de modelo en el compositor (`src/lib/model.ts`, se guarda en localStorage); se pasa como `--model` por mensaje. "Predeterminado" = el modelo por defecto del Claude Code instalado.

#### Navegación por tarjetas
- Tres vistas en el panel central bajo una cabecera común con migas de pan: **Inicio** (espacios), **carpeta** (`currentDir`) y el archivo abierto (`openPath`). `DocumentPane` ya no tiene estado vacío propio: sin archivo ni carpeta muestra `HomeView`.
- Estado en `store/browseSlice.ts`: `currentDir`, `seen` (cuándo abrió Diego cada archivo; localStorage `types.seen`), `activity` (espejo del comando `activity`) y `showContextFiles`.
- Tarjetas en `features/home/`: `BoardCard` (miniatura perezosa con `board_preview`), `FolderCard`, `FileCard`, `CardMenu`. Teclado: flechas, Enter, F2 (renombrar), Supr/Backspace (a la papelera), Esc y Cmd/Ctrl+[ (volver).
- El sidebar con el árbol sigue, pero **arranca plegado** (`types.sidebarCollapsed.v2`; Cmd/Ctrl+\ lo alterna, el riel «Mostrar barra lateral» lo reabre).

#### Control remoto desde el cel (`remote.rs`, `features/chat/RemoteButton.tsx`)
- Botón «Cel» en la cabecera del chat: lanza `claude remote-control --name Types --permission-mode acceptEdits` con cwd = **raíz del workspace** (`espacios/`), y la app de Claude del cel (pestaña Code) maneja esa sesión. «Detener» envía SIGINT al grupo de procesos (SIGKILL tras ~3 s); también se detiene al cerrar Types.
- Mientras está activo corre `caffeinate -i -w <pid>` para que la Mac no se duerma.
- `--spawn=same-dir` evita la pregunta interactiva del modo de sesión, y el proceso arranca con `GIT_CEILING_DIRECTORIES` = carpeta padre de la raíz: `espacios/` está dentro del repo del código y sin esto Claude lo trataría como ese repo (rama `feat/...`); así las sesiones del cel no tocan su git.
- Primera vez: la carpeta no está confiada y el comando sale con «Workspace not trusted». El botón ofrece «Abrir Terminal» (script `confiar-control-remoto.command` en el directorio de datos de la app): se responde `y` a «Trust» y a «Enable Remote Control?», se espera «Connected» y se cierra con Ctrl+C. Después funciona solo.
- Riesgo: quien tenga la sesión en el cel tiene los permisos de Claude sobre esa carpeta (los de Bash se aprueban desde el cel). Recomendado activar «Dispositivos de confianza» en la cuenta de Claude.

## 5. Reglas de implementación
- **Nunca perder texto de Diego.** Guardado automático con espera de 800 ms. Si un archivo abierto cambia en disco: sin cambios locales pendientes se recarga solo; con cambios pendientes se avisa y Diego elige.
- **No reescribir lo que no se editó.** Abrir una página o pizarra no la guarda. Solo se escribe a disco cuando Diego modifica algo.
- **Pizarras:** una edición parchea el dato crudo solo del bloque tocado; nunca reescribe bloques que Diego no tocó (conserva campos extra/desconocidos y entradas que no son objeto). Un `.canvas` inválido o vacío se abre en solo lectura y nunca se sobrescribe. Los cambios de Diego y los de Claude se fusionan por bloque (hook de merge de `useDocument`), no por archivo completo. Las notas cuyo Markdown el editor no puede conservar quedan en solo lectura.
- **Historial de pizarras:** archivar NUNCA borra: solo agrega `archived` al nodo (conserva todos sus demás campos) y restaurar quita solo ese campo. `hidden` (estado de React Flow) se deriva de `archived` y NO se persiste. Para la mezcla por bloque, archivar/restaurar cuenta como cualquier edición del nodo (`mergeCanvasText` compara nodos completos). Claude aprende estas reglas de la sección `## Pizarras vivas` del `CLAUDE.md` raíz del workspace (`templates.rs` + `ensure_living_boards_section`, se agrega al final sin tocar el resto).
- **Accesibilidad de bloques:** el estado de un bloque (p. ej. hecho/en curso/pendiente, opción elegida) se distingue sin depender solo del color, y todo control es alcanzable con teclado.
- **El texto de la memoria se muestra SIEMPRE como texto plano** (nunca HTML ni Markdown renderizado): puede venir de contenido hostil.
- **El cronista solo escribe `cronista-*.md` y su bloque marcado en `MEMORY.md`**; nunca toca otros archivos de la memoria.
- **«Cerrar tema» nunca reinicia la conversación tras un guardado fallido** sin una segunda confirmación explícita («Abrir nueva sin guardar»).
- **Nada de la memoria se escribe dentro de `espacios/`** (ni copias ni caché): vive en `~/.claude/projects/`.
- **Rutas seguras.** Ningún comando acepta rutas que salgan de la raíz del workspace (`..`, absolutas, symlinks hacia afuera).
- **La actividad nunca vive dentro de `espacios/`** (son datos de negocio y Claude lee esa carpeta): `actividad.json` está en el directorio de config de la app. Claves normalizadas a NFC.
- **Atribución de actividad** (`by`: `tu` / `claude` / `claude-cel` / `fuera`): las escrituras de la app se registran como `tu` y su eco del watcher se ignora durante 2 s (reloj inyectable en las pruebas); lo que cambia mientras corre un chat de ese espacio, o en los 1,5 s siguientes a que termine, es `claude`; si no, `claude-cel` cuando el control remoto está activo, y `fuera` en el resto. Claude escribiendo dentro de una carpeta recién creada o importada en 2 s degrada a `tu`, nunca al revés. Las tarjetas de carpeta derivan su actividad de los archivos que contienen (las entradas de carpeta, si existen, se ignoran). «claude-cel» es heurística (control remoto activo y ningún chat corriendo): la UI lo avisa con un tooltip. Si el `modified` de un archivo supera en más de 2 s a su entrada del registro (editado con la app cerrada), la tarjeta muestra solo la hora, sin autor ni punto (`changeOf` en `src/lib/browse.ts`).
- **Punto de no visto:** una tarjeta lo lleva si `by` ∈ {claude, claude-cel} y `at > seen[ruta]`. `seen` solo se fija al abrir el archivo; uno que Diego está mirando cuenta como visto.
- **Borrar manda a la papelera** de macOS (`NSFileManager.trashItemAtURL`, sin pasar por Finder ni pedir permiso de Automatización), nunca elimina definitivo. Cmd/Ctrl+Z restaura lo último borrado, solo fuera de campos de texto (input, textarea, select, contenteditable) para no pisar el deshacer del texto.
- **Migración de CLAUDE.md:** al arrancar, solo en el CLAUDE.md raíz y en el de cada espacio de primer nivel, reemplaza únicamente las líneas idénticas byte a byte a las plantillas viejas que mencionaban `adjuntos/`; cualquier otra línea (incluso editada por Diego) se respeta. Es idempotente y nunca bloquea el arranque.
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
Firma: el build firma con el certificado propio «Types Local Signing» (llavero de inicio de sesión, creado 2026-10-16; `bundle.macOS.signingIdentity`). Así macOS conserva el permiso de Documentos entre builds; si el certificado falta, el build falla: recrearlo o quitar esa clave. Si el build falla buscando `~/Documents/TYPES/...`, es caché vieja de antes de la mudanza: `cargo clean --manifest-path src-tauri/Cargo.toml --release -p tauri`.

## 7. Decisiones tomadas por Claude (Diego puede cambiarlas)
- Workspace dentro del proyecto pero ignorado por git: `~/Documents/TYPES.nosync/espacios` (cambio pedido por Diego; antes estaba fuera del repo).
- Tiptap + Markdown como editor de notas `.md` (ya no es el formato de página nuevo; ver pizarra).
- Pizarra en formato JSON Canvas `.canvas` con bloques extra (`table`, `chart`, `timeline`, `decision`); los tipos desconocidos se conservan sin tocar.
- `@xyflow/react` en vez de tldraw (licencia). Su atribución está oculta vía `proOptions`: la licencia MIT lo permite, pero React Flow pide mantenerla visible si no se patrocina. Diego debe saberlo y puede cambiarlo.
- `recharts` para las gráficas.
- Fusión por bloque con el hook de merge de `useDocument` en vez de un conflicto de archivo completo, para que moverse un bloque y que Claude escriba otro no pierda nada.
- En un bloque `decision`, `chosen` se guarda por nombre de opción; un `chosen` huérfano se conserva y se avisa, nunca se borra en silencio.
- Memoria: vive en los archivos nativos de Claude por espacio (no en una base propia de Types). El cronista empieza acotado a `espacios/`; ampliar con la lista de alcance solo tras medir el costo. El grafo (graphify) NO está en el camino de cada respuesta.
- El medidor de contexto empuja a cerrar temas porque las conversaciones largas son el costo real de tokens: medido, una sesión de Ropa llegó a 262 respuestas y 418k de contexto.
- Agente embebido con `acceptEdits`; Bash/Skill/Agent/NotebookEdit se habilitaron después por decisión de Diego (ver Integración con Claude Code).
- Un proceso de Claude por mensaje con `--resume`, en lugar de un proceso vivo.
- Editor (`@tiptap/markdown` 3.x): al primer guardado normaliza la sintaxis (viñetas a `-`, tablas realineadas, sin salto de línea final); no se escribe nada hasta que Diego edita. Las páginas con YAML, comentarios HTML, bloques HTML o notas al pie se abren en solo lectura porque el editor las corrompería (Diego puede forzar la edición). Imágenes en disco: ruta relativa a la carpeta de la página (`Imágenes/a.png`, o `../Imágenes/a.png` si la imagen está en la carpeta superior).
- Imágenes: una carpeta `Imágenes/` por cada nivel de carpeta (reemplaza al `adjuntos/` único por espacio). El sidebar las oculta junto con los CLAUDE.md salvo que se active el interruptor de «mostrar archivos de Claude» (se guarda en localStorage).
- Panel de imágenes de la pizarra (botón de la barra): pestañas «En esta pizarra» (imágenes de sus bloques `file`) y «Todas» (las de la carpeta de la pizarra); se arrastran al lienzo, «+ Subir» y borrar.
- Al borrar una imagen desde el panel, el aviso de uso cuenta las pizarras `.canvas` de la misma carpeta que la usan (no bloques ni otras carpetas).
- Deshacer = solo lo último borrado, por sesión (`lastDeleted` en memoria; no sobrevive al cierre de la app).
- Escala tipográfica ~12 % mayor, solo vía tokens `--text-*` en `src/styles/tokens.css`.
- Las tarjetas reemplazan al árbol como navegación principal; cada una muestra miniatura, hora del último cambio y quién lo hizo (tú / Claude / cel / fuera). Miniaturas de pizarra vía `board_preview` perezoso (solo las visibles) para no leer todos los `.canvas`.
- Sidebar izquierdo colapsable con Cmd/Ctrl+\, **plegado por defecto**; clave nueva `types.sidebarCollapsed.v2` para ignorar preferencias viejas que lo mantendrían abierto.
- Pizarras vivas (2026-10-21): el historial es una capa escondida dentro del mismo `.canvas` (campo `archived`), no un archivo aparte, para que Claude y la app compartan una sola fuente de verdad. Claude archiva solo lo que un dato nuevo REEMPLAZA o lo que Diego descartó (motivo = qué lo reemplazó, `by:"claude"`); lo que solo parece viejo o repetido lo propone y espera el sí de Diego. Las decisiones pendientes (`decision`) se quedan visibles. Plan: `docs/superpowers/plans/2026-10-21-pizarras-vivas.md`.

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
