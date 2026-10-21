import { timeAgo } from "../../lib/timeAgo";
import { useMemoryUi } from "./memoryUi";
import { useMemoryStatus } from "./useMemoryStatus";

/** Makes continuity visible: what a new conversation in this space already knows. */
export function MemoryBadge({ space, withButton = true }: { space: string; withButton?: boolean }) {
  const { status, failed } = useMemoryStatus(space);
  if (!status) {
    return failed ? <p className="memory-badge memory-muted">No se pudo leer la memoria de {space}.</p> : null;
  }
  const empty = !status.exists || status.facts === 0;
  return (
    <div className="memory-badge" data-empty={empty}>
      <p>
        {empty
          ? `Aún no hay memoria de ${space}. Se irá llenando sola mientras trabajas.`
          : `Memoria de ${space} cargada: ${status.facts} datos · ${status.decisions} decisiones${
              status.updated !== null ? ` · actualizada ${timeAgo(status.updated, Date.now())}` : ""
            }`}
      </p>
      {withButton && !empty && (
        <button className="btn" onClick={() => useMemoryUi.getState().openPanel()}>
          Ver qué recuerda
        </button>
      )}
    </div>
  );
}
