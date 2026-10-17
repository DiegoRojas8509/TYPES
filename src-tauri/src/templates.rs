//! Spanish CLAUDE.md templates created by the app inside the workspace.

pub const ROOT_CLAUDE_MD: &str = r#"# Reglas de formato del espacio de trabajo

Esta carpeta es la mesa de trabajo de Diego. Cada carpeta de primer nivel es un espacio (un negocio o proyecto) con su propio `CLAUDE.md` de contexto. Lee ese archivo antes de trabajar en un espacio.

## Cómo se guarda la información
- La superficie principal de trabajo son las pizarras (`.canvas`): ahí van las notas, tablas, gráficas, líneas de tiempo y decisiones. Su formato está en la sección «Pizarras» de este archivo.
- Las páginas son archivos Markdown (GFM) con extensión `.md`: texto descriptivo para explicar, y tablas para los datos duros (precios, medidas, cantidades).
- Las salidas visuales (dashboards, reportes, previews de moldes) se entregan como archivos `.html` autocontenidos: CSS y JavaScript dentro del mismo archivo, sin depender de internet ni de otros archivos.
- Las imágenes viven en la carpeta `Imágenes/` de cada carpeta (cada nivel tiene la suya, junto a las pizarras y páginas que las usan). Referéncialas con rutas relativas a la carpeta del archivo, por ejemplo `![molde](Imágenes/molde.png)`.
- No uses formatos propietarios ni bases de datos: todo debe poder abrirse con un editor de texto.

## Cómo trabajar
- En todo cálculo muestra las fórmulas y los supuestos que usaste, para que Diego pueda revisarlos y corregirlos.
- Nunca borres ni reescribas texto de Diego sin que lo pida. Para agregar o corregir, hazlo en una sección nueva o señala el cambio.
- Escribe en español, claro y conciso.
- Trabaja solo dentro del espacio indicado; no leas ni modifiques otras carpetas.
"#;

pub const SPACE_CLAUDE_MD: &str = r#"# Contexto de este negocio

Completa estas secciones. Claude las lee antes de analizar, costear o generar reportes. Sigue también las reglas de formato del `CLAUDE.md` de la carpeta superior: la información vive sobre todo en pizarras (`.canvas`, ver la sección «Pizarras» de ese archivo) y, para texto largo, en páginas en Markdown con tablas para los datos, salidas visuales en HTML autocontenido, imágenes en `Imágenes/` de la misma carpeta, y fórmulas y supuestos visibles en cada cálculo.

## Qué es este negocio


## Proveedores y tarifas


## Mermas y supuestos


## Márgenes objetivo


## Cómo quiero los reportes

"#;

/// Byte for byte what the frontend's `serializeCanvas` writes for an empty board
/// (2-space indent, trailing newline), so the first edit does not reformat the file.
pub const EMPTY_CANVAS: &str = "{\n  \"nodes\": [],\n  \"edges\": []\n}\n";

pub const BOARDS_SECTION: &str = r#"## Pizarras

Una pizarra es un archivo `.canvas` (formato JSON Canvas): un archivo de texto con JSON que Diego ve como un lienzo con bloques. Lo lees y lo modificas con Read y Edit, como cualquier otro archivo de texto.

Estructura:

```json
{ "nodes": [ ... ], "edges": [ {"id": "a1b2c3d4", "fromNode": "id1", "toNode": "id2", "label": "opcional"} ] }
```

Todo nodo lleva `id` (texto), `type`, `x`, `y`, `width`, `height` (números) y opcionalmente `color` (texto).

| type | campos | se ve como |
|------|--------|-----------|
| `text` | `text`: Markdown | Nota (el primer `#` es el título) |
| `file` | `file`: ruta relativa a la carpeta del `.canvas` | Imagen |
| `group` | `label` | Zona para agrupar |
| `table` | `title?`, `columns`: texto[], `rows`: texto[][] | Tabla editable |
| `chart` | `title`, `kind`: `"bar"`, `"line"` o `"pie"`, `labels`: texto[], `series`: `{name, values: número[]}`[] | Gráfica |
| `timeline` | `title`, `items`: `{date, title, detail?, status: "hecho"/"en curso"/"pendiente"}`[] | Línea de tiempo |
| `decision` | `question`, `options`: `{name, pros: texto[], cons: texto[]}`[], `chosen?`, `rationale?` | Decisión |

Cuándo usar cada bloque:
- `text` (nota): ideas, avances, observaciones.
- `table`: datos duros como precios, medidas o cantidades.
- `chart`: comparar números (costos, ventas, márgenes).
- `timeline`: avances y fechas.
- `decision`: opciones con pros y contras, y qué se eligió y por qué.
- `file` (imagen): archivos de la carpeta `Imágenes/` junto a la pizarra.

Reglas:
- Cada `id` es único en la pizarra (8 caracteres alfanuméricos, por ejemplo `a1b2c3d4`).
- El JSON debe ser válido siempre: revísalo antes de terminar. Un JSON roto deja la pizarra inservible.
- Las imágenes viven en la carpeta `Imágenes/` de la propia carpeta de la pizarra (no en la de un nivel superior) y se referencian con ruta relativa a esa carpeta, por ejemplo `Imágenes/molde.png`.
- Nunca borres ni cambies el contenido de los bloques de Diego. Para agregar información, crea bloques nuevos.
- Para ORGANIZAR una pizarra solo cambia `x`, `y`, `width` y `height`, y crea nodos `group` para agrupar. No toques el contenido.
- Diego puede estar editando la misma pizarra: mantén tus cambios mínimos y edita solo los nodos necesarios, sin reescribir el archivo completo.
"#;
