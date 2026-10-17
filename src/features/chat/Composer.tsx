import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { getModel, MODELS, setModel } from "../../lib/model";
import type { PendingImage } from "./conversations";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface Chip extends PendingImage {
  key: number;
}

interface Props {
  running: boolean;
  onSend(text: string, images: PendingImage[]): Promise<boolean>;
  onStop(): void;
}

let chipSeq = 0;

function nameFor(file: File): string {
  if (file.name) return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  return `imagen.${ext}`;
}

/** Message box with image chips. The parent keys it by space, so each space keeps its own draft. */
export function Composer({ running, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [model, setModelState] = useState(getModel);

  const canSend = !running && (text.trim().length > 0 || chips.length > 0);

  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (files.length && !images.length) {
      setProblem("Por ahora solo puedo recibir imágenes.");
      return;
    }
    const added: Chip[] = [];
    const skipped: string[] = [];
    for (const f of images) {
      if (f.size > MAX_IMAGE_BYTES) {
        skipped.push(nameFor(f));
        continue;
      }
      added.push({ key: ++chipSeq, name: nameFor(f), bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    setProblem(skipped.length ? `Pesa más de 10 MB y no se adjuntó: ${skipped.join(", ")}.` : null);
    if (added.length) setChips((c) => [...c, ...added]);
  }

  async function submit() {
    if (!canSend) return;
    const sent = { text: text.trim(), images: chips };
    setText("");
    setChips([]);
    setProblem(null);
    const ok = await onSend(sent.text, sent.images);
    if (!ok) {
      // Nothing was sent: give the message back instead of losing it.
      setText((t) => t || sent.text);
      setChips((c) => (c.length ? c : sent.images));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void addFiles([...e.dataTransfer.files]);
  }

  return (
    <div
      className="composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      {chips.length > 0 && (
        <ul className="composer-chips" aria-label="Imágenes adjuntas">
          {chips.map((c) => (
            <li key={c.key} className="chip">
              <span className="chip-name">{c.name}</span>
              <button
                className="chip-remove"
                aria-label={`Quitar ${c.name}`}
                onClick={() => setChips((all) => all.filter((x) => x.key !== c.key))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="composer-problem" role="status">
          {problem}
        </p>
      )}
      <textarea
        className="composer-input"
        aria-label="Mensaje para Claude"
        placeholder="Escribe a Claude… (Enter envía, Shift+Enter salto de línea)"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div className="composer-bar">
        <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
          Adjuntar imagen
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <select
          className="btn"
          aria-label="Modelo de Claude"
          title="Modelo que usará el siguiente mensaje"
          value={model}
          onChange={(e) => {
            setModelState(e.target.value);
            setModel(e.target.value);
          }}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {running ? (
          <button className="btn" type="button" onClick={onStop}>
            Detener
          </button>
        ) : (
          <button className="btn btn-primary" type="button" disabled={!canSend} onClick={() => void submit()}>
            Enviar
          </button>
        )}
      </div>
    </div>
  );
}
