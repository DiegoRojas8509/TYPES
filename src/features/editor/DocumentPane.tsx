import { kindOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { MarkdownEditor } from "./Editor";

/**
 * Middle pane. The markdown branch is the Tiptap editor (Task 5); Task 6 replaces
 * the html/image/other placeholders with the viewers.
 * Read `openPath` (workspace-relative) from the store; use `kindOf(openPath)` to
 * pick the renderer; watch `fsChange` to react to disk changes. Keep the empty state.
 */
export function DocumentPane() {
  const openPath = useApp((s) => s.openPath);
  const hasSpaces = useApp((s) => s.tree.some((n) => n.kind === "dir"));

  if (!openPath) {
    return (
      <div className="empty">
        <h2>{hasSpaces ? "Abre una página" : "Empieza por un espacio"}</h2>
        <p>
          {hasSpaces
            ? "Elige una página en la barra lateral, o crea una nueva con el botón + de un espacio."
            : "Crea un espacio en la barra lateral para tu primer negocio o proyecto. Dentro escribirás páginas y Claude trabajará sobre ellas."}
        </p>
      </div>
    );
  }

  if (kindOf(openPath) === "markdown") return <MarkdownEditor key={openPath} path={openPath} />;

  return (
    <div className="empty" data-testid="document-placeholder" data-kind={kindOf(openPath)}>
      <h2>{openPath}</h2>
      <p>Aquí irá el visor de este archivo ({kindOf(openPath)}).</p>
    </div>
  );
}
