import { spaceOf, titleOf } from "../../lib/paths";
import { useChats } from "../chat/conversations";

/** Fixed request: Claude may move blocks and add zones, never touch their content. */
export function orderPrompt(name: string): string {
  return `Reorganiza la pizarra "${name}": agrupa por tema con zonas (group), alinea y deja espacio entre bloques. No borres ni cambies el contenido de ningún bloque; solo x, y, width, height y las zonas nuevas.`;
}

/**
 * Asks Claude, through the chat, to tidy this board. It only sends a message: the
 * board file is changed by Claude and arrives like any other external edit.
 */
export function OrderButton({ path, editable }: { path: string; editable: boolean }) {
  // A root-level file belongs to no space, so there is no conversation to send it to.
  const space = path.includes("/") ? spaceOf(path) : null;
  const running = useChats((s) => space !== null && s.conversations[space]?.running === true);

  const reason = !editable
    ? "La pizarra no se puede editar"
    : space === null
      ? "La pizarra no está dentro de un espacio"
      : running
        ? "Claude está trabajando; espera a que termine"
        : null;
  const label = "Ordenar con Claude";

  return (
    <button
      type="button"
      className="btn"
      disabled={reason !== null}
      aria-label={label}
      title={reason ?? label}
      onClick={() => {
        if (reason === null && space !== null) void useChats.getState().send(space, orderPrompt(titleOf(path)), []);
      }}
    >
      Ordenar con Claude
    </button>
  );
}
