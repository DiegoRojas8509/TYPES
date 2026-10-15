import "@xyflow/react/dist/style.css";
import "./board.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { api, errorMessage } from "../../lib/api";
import { mergeCanvasText, newId, parseCanvas, serializeCanvas, type CanvasNode } from "../../lib/canvas";
import { spaceOf, titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";
import { relativeSrc } from "../editor/markdown";
import { useDocument, type DocStatus } from "../editor/useDocument";
import { defaultNode, type BlockKind } from "./addMenu";
import { BlockMenu } from "./BlockMenu";
import { BoardActionsContext, type BoardActions } from "./boardActions";
import {
  FALLBACK_TYPE,
  fromFlow,
  isUserEdit,
  patchFlowNode,
  roundChanges,
  toFlowEdge,
  toFlowNode,
  visibleEdges,
  type FlowEdge,
  type FlowNode,
} from "./boardModel";
import { FallbackNode } from "./FallbackNode";
import { nodeTypes } from "./nodes";

// Module level: React Flow needs a stable identity for `nodeTypes`.
const NODE_TYPES: NodeTypes = { ...nodeTypes, [FALLBACK_TYPE]: FallbackNode };
const isKnown = (type: string) => Object.prototype.hasOwnProperty.call(nodeTypes, type);
const DELETE_KEYS = ["Backspace", "Delete"];
const FIT_VIEW = { padding: 0.2, maxZoom: 1 };
const PRO_OPTIONS = { hideAttribution: true };

const STATUS_LABEL: Record<DocStatus, string> = {
  loading: "Abriendo…",
  clean: "Guardado",
  dirty: "Sin guardar",
  saving: "Guardando…",
  conflict: "Claude cambió esta pizarra",
  error: "",
};

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

type MenuState = { left: number; top: number; flow: { x: number; y: number }; centered: boolean };

/** `.canvas` whiteboard: React Flow on top of `useDocument`. Mount with `key={path}`. */
export function BoardView({ path }: { path: string }) {
  return (
    <ReactFlowProvider>
      <Board path={path} />
    </ReactFlowProvider>
  );
}

function Board({ path }: { path: string }) {
  const doc = useDocument(path, mergeCanvasText);
  const notify = useApp((s) => s.notify);
  const rf = useReactFlow<FlowNode, FlowEdge>();

  const rootRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const mounted = useRef(true);
  // Live copy of `editable`, set during render with the parse result. Anything
  // that can resume after an await (image saves) must read this, never a stale
  // closure, so an unreadable board is never overwritten.
  const editableRef = useRef(false);

  // The board lives in React state for rendering, mirrored in refs that are
  // updated synchronously so every edit serializes the CURRENT board, never a
  // stale closure (async image saves, merges and resets all go through them).
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The flow mounts only once the first parse has been applied, so its initial
  // fitView sees the real nodes instead of an empty board.
  const [loaded, setLoaded] = useState(false);

  // Only parsed when the document replaces its content (`revision`).
  const parsed = useMemo(
    () => (doc.content === null ? null : parseCanvas(doc.content)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.revision],
  );
  const invalid = parsed !== null && !parsed.ok ? parsed.reason : null;
  const editable = parsed?.ok === true && doc.status !== "error";
  editableRef.current = editable;

  const apply = useCallback((n: FlowNode[], e: FlowEdge[]) => {
    nodesRef.current = n;
    edgesRef.current = e;
    setNodes(n);
    setEdges(e);
  }, []);

  /** Writes the current board through the document: the ONLY path to `onChange`. */
  const persist = useCallback((n: FlowNode[], e: FlowEdge[]) => {
    if (!editableRef.current) return;
    docRef.current.onChange(serializeCanvas(fromFlow(n, e)));
  }, []);

  // (Re)load whenever the document replaces its content. Never calls onChange.
  useLayoutEffect(() => {
    if (!parsed) return;
    setMenu(null);
    if (parsed.ok) {
      apply(
        parsed.doc.nodes.map((n) => toFlowNode(n, isKnown)),
        parsed.doc.edges.map(toFlowEdge),
      );
      setLoaded(true);
    } else {
      apply([], []);
    }
  }, [parsed, apply]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (!editableRef.current) return;
      const next = applyNodeChanges(roundChanges(changes), nodesRef.current);
      const removed = new Set(changes.flatMap((c) => (c.type === "remove" ? [c.id] : [])));
      const nextEdges =
        removed.size > 0
          ? edgesRef.current.filter((e) => !removed.has(e.source) && !removed.has(e.target))
          : edgesRef.current;
      apply(next, nextEdges);
      if (changes.some(isUserEdit)) persist(next, nextEdges);
    },
    [apply, persist],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (!editableRef.current) return;
      const next = applyEdgeChanges(changes, edgesRef.current);
      apply(nodesRef.current, next);
      if (changes.some((c) => c.type === "remove")) persist(nodesRef.current, next);
    },
    [apply, persist],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editableRef.current) return;
      const next = [...edgesRef.current, toFlowEdge({ id: newId(), fromNode: c.source, toNode: c.target })];
      apply(nodesRef.current, next);
      persist(nodesRef.current, next);
    },
    [apply, persist],
  );

  const addNodes = useCallback(
    (added: CanvasNode[]) => {
      if (!editableRef.current) return;
      const next = [
        ...nodesRef.current.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...added.map((n) => ({ ...toFlowNode(n, isKnown), selected: true })),
      ];
      apply(next, edgesRef.current);
      persist(next, edgesRef.current);
    },
    [apply, persist],
  );

  const actions = useMemo<BoardActions>(
    () => ({
      update(id, patch) {
        const target = nodesRef.current.find((n) => n.id === id);
        if (!target || !editableRef.current) return;
        const next = nodesRef.current.map((n) => (n.id === id ? patchFlowNode(n, patch, isKnown) : n));
        apply(next, edgesRef.current);
        persist(next, edgesRef.current);
      },
    }),
    [apply, persist],
  );

  /** Centre of the visible board, in flow coordinates. */
  const viewportCentre = useCallback(() => {
    const r = flowRef.current?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 0) / 2, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 });
  }, [rf]);

  function openMenuAt(clientX: number, clientY: number) {
    const root = rootRef.current?.getBoundingClientRect();
    const left = clientX - (root?.left ?? 0);
    const top = clientY - (root?.top ?? 0);
    setMenu({ left, top, flow: rf.screenToFlowPosition({ x: clientX, y: clientY }), centered: false });
  }

  function openMenuFromButton(e: React.MouseEvent<HTMLButtonElement>) {
    if (menu) return setMenu(null);
    const root = rootRef.current?.getBoundingClientRect();
    const btn = e.currentTarget.getBoundingClientRect();
    setMenu({
      left: btn.left - (root?.left ?? 0),
      top: btn.bottom - (root?.top ?? 0) + 4,
      flow: viewportCentre(),
      centered: true,
    });
  }

  function pickBlock(kind: BlockKind) {
    if (!menu) return;
    const probe = defaultNode(kind, 0, 0);
    // From the button the block lands centred on the view; from a double click its corner sits on the click.
    const x = menu.centered ? menu.flow.x - probe.width / 2 : menu.flow.x;
    const y = menu.centered ? menu.flow.y - probe.height / 2 : menu.flow.y;
    setMenu(null);
    addNodes([{ ...probe, x: finite(x), y: finite(y) }]);
  }

  const onPaneDoubleClick = (e: React.MouseEvent) => {
    if (!editable) return;
    if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
    openMenuAt(e.clientX, e.clientY);
  };

  const insertImages = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const space = spaceOf(path);
      if (!path.includes("/") || !space) {
        notify("Las imágenes se guardan dentro de un espacio. Mueve esta pizarra a uno para pegar imágenes.");
        return;
      }
      let origin = at ?? viewportCentre();
      for (const file of files) {
        try {
          const ext = IMAGE_EXT[file.type] ?? "png";
          const name = file.name || `imagen.${ext}`;
          const saved = await api.saveAttachment(space, name, new Uint8Array(await file.arrayBuffer()));
          if (!mounted.current) return;
          const node = defaultNode("image", finite(origin.x - 150), finite(origin.y - 110));
          addNodes([{ ...node, file: plainRelative(path, saved) }]);
          origin = { x: origin.x + 24, y: origin.y + 24 };
        } catch (e) {
          notify(`No se pudo guardar la imagen: ${errorMessage(e)}`);
        }
      }
    },
    [path, notify, viewportCentre, addNodes],
  );

  // Paste: window-level so it works once the board has been clicked, but never
  // while Diego is typing in a note or table cell.
  useEffect(() => {
    if (!editable) return;
    function onPaste(e: ClipboardEvent) {
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      const files = imageFiles(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      void insertImages(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editable, insertImages]);

  function onDragOver(e: React.DragEvent) {
    if (editable && e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    const files = imageFiles(e.dataTransfer.files);
    if (!editable || files.length === 0) return;
    e.preventDefault();
    void insertImages(files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  const shown = useMemo(() => visibleEdges(nodes, edges), [nodes, edges]);

  return (
    <div className="board" ref={rootRef}>
      <div className="pane-header">
        <span className="pane-title" title={path}>
          {titleOf(path)}
        </span>
        <span className="board-bar">
          {doc.status !== "error" && (
            <span className={`save-status is-${doc.status}`} role="status">
              {STATUS_LABEL[doc.status]}
            </span>
          )}
          {editable && (
            <button
              type="button"
              className="btn board-add"
              aria-label="Agregar bloque"
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              title="Agregar bloque"
              onClick={openMenuFromButton}
            >
              +
            </button>
          )}
        </span>
      </div>
      {doc.status === "conflict" && (
        <div className="banner banner-warn" role="alert">
          <span>Esta pizarra cambió en el disco mientras la editabas. ¿Qué versión quieres conservar?</span>
          <button type="button" className="btn" onClick={doc.reloadFromDisk}>
            Reemplazar con lo del disco
          </button>
          <button type="button" className="btn" onClick={doc.keepMine}>
            Mantener lo mío
          </button>
        </div>
      )}
      {invalid !== null && (
        <div className="banner banner-warn" role="alert">
          <span>Esta pizarra no se puede abrir: {invalid}. La dejé intacta para no perder nada.</span>
        </div>
      )}
      {doc.status === "error" ? (
        <div className="empty" role="status">
          <h2>No se puede mostrar esta pizarra</h2>
          <p>{doc.error}</p>
        </div>
      ) : !editable || !loaded ? (
        <div className="pane-body board-loading" aria-busy={doc.content === null} />
      ) : (
        <BoardActionsContext.Provider value={actions}>
          <div className="board-flow" ref={flowRef} onDragOver={onDragOver} onDrop={onDrop}>
            <ReactFlow<FlowNode, FlowEdge>
              nodes={nodes}
              edges={shown}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDoubleClick={onPaneDoubleClick}
              onPaneClick={() => setMenu(null)}
              deleteKeyCode={DELETE_KEYS}
              zoomOnDoubleClick={false}
              panOnScroll
              elevateNodesOnSelect={false}
              minZoom={0.1}
              maxZoom={2}
              fitView
              fitViewOptions={FIT_VIEW}
              proOptions={PRO_OPTIONS}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {nodes.length === 0 && (
              <p className="board-empty">Doble clic para agregar un bloque, o cuéntale a Claude en el chat.</p>
            )}
          </div>
        </BoardActionsContext.Provider>
      )}
      {menu && editable && <BlockMenu left={menu.left} top={menu.top} onPick={pickBlock} onClose={() => setMenu(null)} />}
    </div>
  );
}

function finite(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function imageFiles(list: FileList | undefined | null): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Path of `saved` relative to the board's folder, written plainly (no %20) as the `.canvas` format expects. */
function plainRelative(boardPath: string, saved: string): string {
  return relativeSrc(boardPath, saved).replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")");
}
