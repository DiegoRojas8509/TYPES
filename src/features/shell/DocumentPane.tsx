import { kindOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { BoardView } from "../board/BoardView";
import { FileFallback } from "../viewer/FileFallback";
import { HtmlViewer } from "../viewer/HtmlViewer";
import { ImageViewer } from "../viewer/ImageViewer";
import { MarkdownEditor } from "../editor/Editor";

/**
 * Middle pane: picks the renderer for `openPath` (workspace-relative) by file kind.
 * Each renderer is keyed by path so switching files never reuses state.
 */
export function DocumentPane() {
  const openPath = useApp((s) => s.openPath);
  const hasSpaces = useApp((s) => s.tree.some((n) => n.kind === "dir"));

  if (!openPath) {
    return (
      <div className="empty">
        <h2>{hasSpaces ? "Abre una pizarra" : "Empieza por un espacio"}</h2>
        <p>
          {hasSpaces
            ? "Elige una pizarra en la barra lateral, o crea una nueva con el botón + de un espacio."
            : "Crea un espacio en la barra lateral para tu primer negocio o proyecto. Dentro armarás pizarras y Claude trabajará sobre ellas."}
        </p>
      </div>
    );
  }

  switch (kindOf(openPath)) {
    case "markdown":
      return <MarkdownEditor key={openPath} path={openPath} />;
    case "canvas":
      return <BoardView key={openPath} path={openPath} />;
    case "html":
      return <HtmlViewer key={openPath} path={openPath} />;
    case "image":
      return <ImageViewer key={openPath} path={openPath} />;
    default:
      return <FileFallback key={openPath} path={openPath} />;
  }
}
