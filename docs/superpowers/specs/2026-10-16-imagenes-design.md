# Repositorio de imágenes por carpeta + deshacer borrados: diseño

Fecha: 2026-10-16. Pedido y decidido por Diego en el chat.

## Intención
Las imágenes no deben verse como una carpeta más («adjuntos») sino como un repositorio estilo Canva: un panel desplegable en la pizarra con miniaturas que Diego arrastra al lienzo. Cada nivel de carpeta tiene su propio repositorio: una pizarra en `Ropa/` ve las imágenes de `Ropa`, no las de `Ropa/Maquileros/` ni `Ropa/Diseños/`. Además, Cmd+Z justo después de borrar algo debe regresarlo.

## Decisiones de Diego
- Panel de imágenes en la pizarra (botón con icono en la barra), con dos pestañas: «En esta pizarra» (las que usa) y «Todas» (el repositorio de la carpeta).
- Repositorio por nivel de carpeta, no recursivo.
- Borrar una imagen del panel que está en uso: avisar antes con cuántas pizarras la usan; si se borra, el bloque muestra «No encuentro la imagen» hasta que se deshaga.
- Lo que hay hoy en `adjuntos/` se manda a la papelera (no se migra).
- Cmd+Z / Ctrl+Z regresa lo último borrado.

## Decisiones de Claude (Diego puede cambiarlas)
- En disco: carpeta `Imágenes/` dentro de cada carpeta (archivos normales que Claude lee). Ruta en la pizarra: `Imágenes/x.png` (relativa a la carpeta de la pizarra, igual que antes).
- La carpeta `Imágenes` no aparece en la barra lateral; se muestra con el mismo interruptor que muestra los `CLAUDE.md`.
- Las imágenes que se sueltan o pegan en una pizarra se guardan en `Imágenes/` de la carpeta de esa pizarra. Las del chat, en `Imágenes/` del espacio.
- Arrastrar una imagen de otra carpeta o espacio a una pizarra la copia al repositorio de la carpeta de la pizarra (cada repositorio es independiente).
- Deshacer: se recuerda la ruta original y dónde quedó en la papelera (NSFileManager devuelve la ubicación); Cmd+Z fuera de un campo de texto la regresa. Solo el último borrado y solo durante la sesión.
- `create_space` ya no crea `adjuntos/`.
