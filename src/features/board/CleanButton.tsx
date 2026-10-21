import { spaceOf, titleOf } from "../../lib/paths";
import { useChats } from "../chat/conversations";

/** Fixed request: Claude proposes what to archive and waits for approval before touching the file. */
export function cleanPrompt(name: string): string {
  return `Revisa la pizarra "${name}" y dime qué bloques archivarías y por qué: datos reemplazados por uno más nuevo, escenarios o suposiciones descartados y bloques repetidos. Haz una lista corta. No cambies nada hasta que yo diga que sí. Cuando apruebe, archívalos agregando el campo "archived" (at, reason, by: "claude") sin borrar nada.`;
}

/**
 * Asks Claude, through the chat, which blocks of this board to archive. Like OrderButton it
 * only sends a message; any change to the board arrives as an ordinary external edit.
 */
export function CleanButton({ path, editable }: { path: string; editable: boolean }) {
  const space = path.includes("/") ? spaceOf(path) : null;
  const running = useChats((s) => space !== null && s.conversations[space]?.running === true);

  const reason = !editable
    ? "La pizarra no se puede editar"
    : space === null
      ? "La pizarra no está dentro de un espacio"
      : running
        ? "Claude está trabajando; espera a que termine"
        : null;
  const label = "Limpiar con Claude";

  return (
    <button
      type="button"
      className="btn"
      disabled={reason !== null}
      aria-label={label}
      title={reason ?? label}
      onClick={() => {
        if (reason === null && space !== null) void useChats.getState().send(space, cleanPrompt(titleOf(path)), []);
      }}
    >
      {label}
    </button>
  );
}
