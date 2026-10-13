import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { baseName } from "../../lib/paths";
import { useApp } from "../../store/app";
import { Composer } from "./Composer";
import { startChatEvents, useChats } from "./conversations";
import { Markdown } from "./Markdown";
import { type ChatItem, initialChat, MSG_NOT_FOUND } from "./reducer";

const EMPTY = initialChat();
const STEP_MARK: Record<string, string> = { done: "✓", error: "no se pudo", stopped: "interrumpido" };

function Step({ item }: { item: Extract<ChatItem, { type: "step" }> }) {
  const open = useApp((s) => s.open);
  const body = (
    <>
      <span className="step-icon" data-status={item.status} aria-hidden="true" />
      <span className="step-label">{item.label}</span>
      {item.status !== "running" && (
        <span className="step-mark" data-status={item.status}>
          {STEP_MARK[item.status]}
        </span>
      )}
    </>
  );
  const status = item.status === "running" ? "en curso" : item.status === "done" ? "listo" : STEP_MARK[item.status];
  return item.path ? (
    <button
      className="step step-link"
      data-status={item.status}
      title={`Abrir ${item.path} (${status})`}
      onClick={() => open(item.path!)}
    >
      {body}
    </button>
  ) : (
    <div className="step" data-status={item.status} title={status}>
      {body}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  const open = useApp((s) => s.open);
  switch (item.type) {
    case "user":
      return (
        <div className="msg msg-user">
          {item.text && <p>{item.text}</p>}
          {item.attachments.length > 0 && (
            <ul className="msg-attachments">
              {item.attachments.map((p) => (
                <li key={p}>
                  <button className="chip chip-link" title={`Abrir ${p}`} onClick={() => open(p)}>
                    {baseName(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "assistant":
      return (
        <div className="msg msg-assistant">
          <Markdown>{item.text}</Markdown>
        </div>
      );
    case "step":
      return <Step item={item} />;
    case "error":
      return (
        <div className="msg msg-error" role="alert">
          {item.text}
        </div>
      );
    case "notice":
      return <div className="msg msg-notice">{item.text}</div>;
  }
}

export function ChatPanel() {
  const space = useApp((s) => s.activeSpace);

  if (!space) {
    return (
      <div className="empty">
        <h2>Chat con Claude</h2>
        <p>El chat trabaja dentro de un espacio. Elige uno en la barra lateral o crea uno nuevo para empezar a pedirle cosas a Claude.</p>
      </div>
    );
  }
  return <SpaceChat key={space} space={space} />;
}

function SpaceChat({ space }: { space: string }) {
  const conv = useChats((s) => s.conversations[space]) ?? EMPTY;
  const claudeMissing = useChats((s) => s.claudeMissing);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  useLayoutEffect(() => {
    useChats.getState().ensure(space);
  }, [space]);

  useEffect(() => {
    void startChatEvents().catch(() => {});
    void useChats.getState().checkClaude();
  }, []);

  // Follow the newest item only while Diego is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [conv.items, conv.thinking, conv.running]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const last = conv.items[conv.items.length - 1];
  const busyStep = last?.type === "step" && last.status === "running";
  const status = !conv.running ? null : conv.thinking ? "Pensando…" : busyStep ? null : "Trabajando…";

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <span className="chat-space" title={space}>
          {space}
        </span>
        <button
          className="btn"
          disabled={conv.running || (!conv.items.length && !conv.sessionId)}
          onClick={() => useChats.getState().reset(space)}
        >
          Nueva conversación
        </button>
      </div>
      <div className="chat-scroll" ref={scroller} onScroll={onScroll} role="log" aria-live="polite">
        {!conv.items.length && !conv.running && (
          <p className="chat-hint">
            Pídele a Claude que analice, costee o genere un reporte con los archivos de <strong>{space}</strong>. Verás
            cada paso que da y podrás abrir lo que escriba.
          </p>
        )}
        {conv.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {status && <div className="chat-status">{status}</div>}
      </div>
      {claudeMissing && (
        <p className="chat-banner" role="alert">
          {MSG_NOT_FOUND}
        </p>
      )}
      <Composer
        running={conv.running}
        onSend={(text, images) => useChats.getState().send(space, text, images)}
        onStop={() => useChats.getState().stop(space)}
      />
    </div>
  );
}
