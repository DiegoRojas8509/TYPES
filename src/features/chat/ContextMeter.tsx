import { useMemoryUi } from "./memoryUi";

/** Context size thresholds (tokens). Single source of truth. */
export const CONTEXT_WARN = 100_000;
export const CONTEXT_HIGH = 200_000;

export type ContextLevel = "normal" | "warning" | "high";

export function contextLevel(tokens: number): ContextLevel {
  return tokens > CONTEXT_HIGH ? "high" : tokens >= CONTEXT_WARN ? "warning" : "normal";
}

export function formatTokens(tokens: number | null): string {
  return tokens === null ? "—" : `${Math.round(tokens / 1000)}k`;
}

const MARK: Record<ContextLevel, string> = { normal: "", warning: "⚠ ", high: "⛔ " };
const LEVEL_TEXT: Record<ContextLevel, string> = { normal: "", warning: " (largo)", high: " (muy largo)" };

interface Props {
  tokens: number | null;
  /** Reason «Cerrar tema» is unavailable, or null. */
  blocker: string | null;
}

export function ContextMeter({ tokens, blocker }: Props) {
  const level = tokens === null ? "normal" : contextLevel(tokens);
  return (
    <div className="context-meter" data-level={level}>
      <span
        className="context-meter-value"
        title="Contexto: lo que Claude tiene en mente en esta conversación; cuanto más crece, más lento y caro es cada mensaje."
      >
        <span aria-hidden="true">{MARK[level]}</span>
        Contexto {formatTokens(tokens)}
        <span className="sr-only">{LEVEL_TEXT[level]}</span>
      </span>
      {level !== "normal" && (
        <>
          <span className="context-meter-hint">
            Conversación larga: cierra el tema y abre una nueva; la memoria ya tiene lo importante.
          </span>
          <button
            className="btn"
            disabled={blocker !== null}
            title={blocker ?? undefined}
            onClick={() => useMemoryUi.getState().openClose()}
          >
            Cerrar tema
          </button>
        </>
      )}
    </div>
  );
}
