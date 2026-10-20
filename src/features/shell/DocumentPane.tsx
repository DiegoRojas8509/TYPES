import { kindOf, parentOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { BoardView } from "../board/BoardView";
import { Breadcrumb } from "../home/Breadcrumb";
import { FolderView } from "../home/FolderView";
import { HomeView } from "../home/HomeView";
import { useBrowseShortcuts } from "../home/useBrowseShortcuts";
import { FileFallback } from "../viewer/FileFallback";
import { HtmlViewer } from "../viewer/HtmlViewer";
import { ImageViewer } from "../viewer/ImageViewer";
import { MarkdownEditor } from "../editor/Editor";

/**
 * Middle pane: a breadcrumb header over either the cards (Inicio or a folder) or the renderer
 * for `openPath` (workspace-relative) picked by file kind. Renderers are keyed by path so
 * switching files never reuses state.
 */
export function DocumentPane() {
  const openPath = useApp((s) => s.openPath);
  const currentDir = useApp((s) => s.currentDir);
  useBrowseShortcuts();

  return (
    <div className="doc-pane">
      <Breadcrumb dir={openPath ? parentOf(openPath) || null : currentDir} file={openPath} />
      <div className="doc-body">{openPath ? renderFile(openPath) : currentDir === null ? <HomeView /> : <FolderView dir={currentDir} />}</div>
    </div>
  );
}

function renderFile(openPath: string) {
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
