//! Spanish CLAUDE.md templates created by the app inside the workspace.

pub const ROOT_CLAUDE_MD: &str = r#"# Reglas de formato del espacio de trabajo

Esta carpeta es la mesa de trabajo de Diego. Cada carpeta de primer nivel es un espacio (un negocio o proyecto) con su propio `CLAUDE.md` de contexto. Lee ese archivo antes de trabajar en un espacio.

## Cómo se guarda la información
- Las páginas son archivos Markdown (GFM) con extensión `.md`: texto descriptivo para explicar, y tablas para los datos duros (precios, medidas, cantidades).
- Las salidas visuales (dashboards, reportes, previews de moldes) se entregan como archivos `.html` autocontenidos: CSS y JavaScript dentro del mismo archivo, sin depender de internet ni de otros archivos.
- Las imágenes y archivos adjuntos viven en la carpeta `adjuntos/` de cada espacio. Referéncialos con rutas relativas, por ejemplo `![molde](adjuntos/molde.png)`.
- No uses formatos propietarios ni bases de datos: todo debe poder abrirse con un editor de texto.

## Cómo trabajar
- En todo cálculo muestra las fórmulas y los supuestos que usaste, para que Diego pueda revisarlos y corregirlos.
- Nunca borres ni reescribas texto de Diego sin que lo pida. Para agregar o corregir, hazlo en una sección nueva o señala el cambio.
- Escribe en español, claro y conciso.
- Trabaja solo dentro del espacio indicado; no leas ni modifiques otras carpetas.
"#;

pub const SPACE_CLAUDE_MD: &str = r#"# Contexto de este negocio

Completa estas secciones. Claude las lee antes de analizar, costear o generar reportes. Sigue también las reglas de formato del `CLAUDE.md` de la carpeta superior: páginas en Markdown con tablas para los datos, salidas visuales en HTML autocontenido, adjuntos en `adjuntos/`, y fórmulas y supuestos visibles en cada cálculo.

## Qué es este negocio


## Proveedores y tarifas


## Mermas y supuestos


## Márgenes objetivo


## Cómo quiero los reportes

"#;
