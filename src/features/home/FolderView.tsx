import { findNode } from "../../lib/browse";
import { countClaudeFiles, isClaudeFile, isImagesDir } from "../../lib/claudeFiles";
import { kindOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { IconBoard, IconFolderPlus } from "../shell/icons";
import { BoardCard } from "./BoardCard";
import { CardMenu } from "./CardMenu";
import { CreateCard } from "./CreateCard";
import { FileCard } from "./FileCard";
import { FolderCard } from "./FolderCard";
import { useContextFilesItem } from "./contextFilesItem";
import { gridKeyDown } from "./typing";
import { useNow } from "./useNow";

/** The cards inside one folder: boards, subfolders, and any other files. */
export function FolderView({ dir }: { dir: string }) {
  const tree = useApp((s) => s.tree);
  const loaded = useApp((s) => s.treeLoaded);
  const now = useNow();
  const showClaude = useApp((s) => s.showContextFiles);
  const contextItem = useContextFilesItem();

  const node = findNode(tree, dir);
  if (!node || node.kind !== "dir") {
    return <div className="home" aria-busy={!loaded}>{loaded && <p className="home-hint">Esta carpeta ya no existe.</p>}</div>;
  }

  const visible = showClaude ? node.children : node.children.filter((n) => !isClaudeFile(n) && !isImagesDir(n));
  const folders = visible.filter((n) => n.kind === "dir");
  const boards = visible.filter((n) => n.kind === "file" && kindOf(n.path) === "canvas");
  const others = visible.filter((n) => n.kind === "file" && kindOf(n.path) !== "canvas");
  const hidden = countClaudeFiles(node.children);
  const app = useApp.getState;

  return (
    <div className="home" onKeyDown={gridKeyDown}>
      <header className="home-head">
        <h1>{node.name}</h1>
        {hidden > 0 && (
          <CardMenu
            label={`Opciones de ${node.name}`}
            items={[contextItem]}
          />
        )}
      </header>

      <section>
        <h2 className="home-section">Pizarras</h2>
        <div className="card-grid" role="list" aria-label="Pizarras">
          {boards.map((n) => (
            <BoardCard key={n.path} node={n} now={now} />
          ))}
          <CreateCard label="Pizarra" inputLabel="Nombre de la pizarra" icon={<IconBoard />} onCreate={(name) => app().createBoard(dir, name)} />
        </div>
      </section>

      <section>
        <h2 className="home-section">Carpetas</h2>
        <div className="card-grid" role="list" aria-label="Carpetas">
          {folders.map((n) => (
            <FolderCard key={n.path} node={n} now={now} />
          ))}
          <CreateCard label="Carpeta" inputLabel="Nombre de la carpeta" icon={<IconFolderPlus />} onCreate={(name) => app().createFolder(dir, name)} />
        </div>
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="home-section">Otros archivos</h2>
          <div className="card-grid" role="list" aria-label="Otros archivos">
            {others.map((n) => (
              <FileCard key={n.path} node={n} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
