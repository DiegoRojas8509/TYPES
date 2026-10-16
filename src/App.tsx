import { useEffect, useState } from "react";
import { ChatPanel } from "./features/chat/ChatPanel";
import { DocumentPane } from "./features/shell/DocumentPane";
import { IconPanel } from "./features/shell/icons";
import { Notice } from "./features/shell/Notice";
import { ResizeHandle } from "./features/shell/ResizeHandle";
import { Sidebar } from "./features/sidebar/Sidebar";
import { startSync, useApp } from "./store/app";

const LIMITS = { sidebar: [200, 480], chat: [300, 640] } as const;
const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(v)));

function storedWidth(key: string, fallback: number, limits: readonly [number, number]): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v ? clamp(v, limits) : fallback;
  } catch {
    return fallback;
  }
}

function usePaneWidth(key: string, fallback: number, limits: readonly [number, number]) {
  const [width, setWidth] = useState(() => storedWidth(key, fallback, limits));
  const set = (v: number) => {
    const next = clamp(v, limits);
    setWidth(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* storage unavailable: width just won't persist */
    }
  };
  return [width, set] as const;
}

function App() {
  const chatCollapsed = useApp((s) => s.chatCollapsed);
  const toggleChat = useApp((s) => s.toggleChat);
  const [sidebarW, setSidebarW] = usePaneWidth("types.sidebarWidth", 260, LIMITS.sidebar);
  const [chatW, setChatW] = usePaneWidth("types.chatWidth", 380, LIMITS.chat);

  useEffect(() => {
    void useApp.getState().init();
    const unlisten = startSync();
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="app">
      <aside className="pane pane-sidebar" style={{ width: sidebarW }}>
        <Sidebar />
      </aside>
      <ResizeHandle label="Ancho de la barra lateral" direction={1} width={sidebarW} onResize={setSidebarW} />

      <main className="pane pane-doc">
        <DocumentPane />
      </main>

      {!chatCollapsed && (
        <ResizeHandle label="Ancho del chat" direction={-1} width={chatW} onResize={setChatW} />
      )}
      <aside className="pane pane-chat" style={{ width: chatW }} hidden={chatCollapsed} aria-label="Chat con Claude">
        <div className="pane-header">
          <span>Claude</span>
          <button className="icon-btn" aria-label="Ocultar chat" title="Ocultar chat" onClick={toggleChat}>
            <IconPanel />
          </button>
        </div>
        <div className="pane-body">
          <ChatPanel />
        </div>
      </aside>
      {chatCollapsed && (
        <div className="chat-rail">
          <button className="icon-btn" aria-label="Mostrar chat" title="Mostrar chat" onClick={toggleChat}>
            <IconPanel />
          </button>
        </div>
      )}

      <Notice />
    </div>
  );
}

export default App;
