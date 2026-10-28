# Pizarra creativa: diseño

Fecha: 2026-10-14. Aprobado por Diego en plan mode (versión completa en `~/.claude/plans/es-que-ya-se-functional-peach.md`).

## Intención
Types se siente como un editor de texto. Diego quiere un espacio creativo para sintetizar información, tomar apuntes y decisiones: dicta con Wispr (fuera de la app) y pega o escribe en el chat, Claude arma los bloques gráficos en una pizarra, Diego también agrega bloques a mano, y Claude le ayuda con lo que hay y reorganiza la pizarra cuando se lo pide.

## Objetivos
- Pizarra libre (arrastrar, redimensionar, conectar) con bloques: nota, tabla, imagen, gráfica, línea de tiempo, decisión, zona.
- Claude lee y escribe la pizarra como archivo de texto; lo que escribe aparece en vivo.
- "Ordenar con Claude": reacomoda sin borrar ni cambiar contenido.

## No-objetivos
- Audio o dictado dentro de la app: Diego usa Wispr externo (decisión 2026-10-14).
- Multiusuario, colaboración en tiempo real, exportación (fase 3), tableros Trello (fase 2 queda absorbida).
- Convertir las páginas .md existentes: Diego las descarta (`Daring Martin.md` ya está en la papelera).

## Anti-objetivos (fallar aunque funcione)
- Perder o reescribir lo que Diego puso en un bloque.
- Que Claude no pueda leer o escribir lo que Diego ve.
- Que los datos queden en un formato que solo la app entiende.
- UI seca y genérica: debe tener carácter (sobrio, denso, paleta naranja quemado, tema claro y oscuro).

## Decisiones (de Diego)
Pizarra libre con fondo organizable por Claude; reemplaza a las páginas .md; bloques de v1: nota, tabla, imagen, gráfica, línea de tiempo, decisión; skills de diseño a usar: impeccable, refactoring-ui, taste-skill.

## Decisiones (de Claude, Diego puede cambiarlas)
- Formato `.canvas` = JSON Canvas (Obsidian) con tipos propios (`table`, `chart`, `timeline`, `decision`); tipos desconocidos se conservan y se muestran como card de solo lectura.
- `@xyflow/react` para la pizarra, `recharts` para gráficas.
- Conflictos con Claude escribiendo: merge por id de bloque; aviso solo si ambos tocaron el mismo bloque.
- Tiptap se queda para `CLAUDE.md` y para el texto dentro de las notas.

## Contrato `.canvas`
Ver tabla de tipos en el plan (`docs/superpowers/plans/2026-10-14-pizarra.md`, sección "Formato").
