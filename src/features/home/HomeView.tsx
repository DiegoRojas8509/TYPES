import { withoutClaudeFiles, countClaudeFiles } from "../../lib/claudeFiles";
import { useApp } from "../../store/app";
import { CardMenu } from "./CardMenu";
import { CreateCard } from "./CreateCard";
import { FileCard } from "./FileCard";
import { FolderCard } from "./FolderCard";
import { useContextFilesItem } from "./contextFilesItem";
import { gridKeyDown } from "./typing";
import { useNow } from "./useNow";

/** Inicio: one card per space (top-level folder). */
export function HomeView() {
  const allNodes = useApp((s) => s.tree);
  const loaded = useApp((s) => s.treeLoaded);
  const now = useNow();
  const showClaude = useApp((s) => s.showContextFiles);
  const contextItem = useContextFilesItem();

  const nodes = showClaude ? allNodes : withoutClaudeFiles(allNodes);
  const spaces = nodes.filter((n) => n.kind === "dir");
  const files = nodes.filter((n) => n.kind === "file");
  const hidden = countClaudeFiles(allNodes);
  const create = (name: string) => useApp.getState().createSpace(name);

  if (!loaded) return <div className="home" aria-busy="true" />;

  return (
    <div className="home" onKeyDown={gridKeyDown}>
      <header className="home-head">
        <h1>{spaces.length === 0 ? "Crea tu primer espacio" : "Espacios"}</h1>
        {hidden > 0 && (
          <CardMenu
            label="Opciones de Inicio"
            items={[contextItem]}
          />
        )}
      </header>
      {spaces.length === 0 && (
        <p className="home-hint">Un espacio es un negocio o proyecto. Ahí viven sus pizarras y lo que Claude genere.</p>
      )}
      <div className="card-grid" role="list" aria-label="Espacios">
        {spaces.map((n) => (
          <FolderCard key={n.path} node={n} now={now} />
        ))}
        <CreateCard label="Espacio" inputLabel="Nombre del espacio" onCreate={create} />
      </div>
      {files.length > 0 && (
        <section>
          <h2 className="home-section">Otros archivos</h2>
          <div className="card-grid" role="list" aria-label="Otros archivos">
            {files.map((n) => (
              <FileCard key={n.path} node={n} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
