// "/" menu for inserting blocks. Built on @tiptap/suggestion with a tiny
// plain-DOM popup (no extra UI dependency).
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string[];
  run(editor: Editor): void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: "Texto", hint: "Párrafo normal", keywords: ["texto", "parrafo", "p"], run: (e) => e.chain().focus().setParagraph().run() },
  { title: "Título 1", hint: "Encabezado grande", keywords: ["titulo", "h1", "encabezado"], run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { title: "Título 2", hint: "Encabezado mediano", keywords: ["titulo", "h2", "encabezado"], run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { title: "Título 3", hint: "Encabezado pequeño", keywords: ["titulo", "h3", "encabezado"], run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { title: "Lista", hint: "Con viñetas", keywords: ["lista", "viñetas", "bullet"], run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Lista numerada", hint: "1. 2. 3.", keywords: ["lista", "numerada", "ordenada"], run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Lista de tareas", hint: "Con casillas", keywords: ["tareas", "todo", "checklist", "casillas"], run: (e) => e.chain().focus().toggleTaskList().run() },
  {
    title: "Tabla",
    hint: "Para datos duros: precios, mermas",
    keywords: ["tabla", "datos", "table"],
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { title: "Bloque de código", hint: "Texto monoespaciado", keywords: ["codigo", "code"], run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: "Cita", hint: "Texto destacado", keywords: ["cita", "quote"], run: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Separador", hint: "Línea horizontal", keywords: ["separador", "linea", "hr"], run: (e) => e.chain().focus().setHorizontalRule().run() },
];

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterSlashItems(query: string): SlashItem[] {
  const q = fold(query.trim());
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => fold(i.title).includes(q) || i.keywords.some((k) => fold(k).startsWith(q)));
}

function renderMenu() {
  let el: HTMLDivElement | null = null;
  let items: SlashItem[] = [];
  let selected = 0;
  let command: ((item: SlashItem) => void) | null = null;

  function paint(props: SuggestionProps<SlashItem, SlashItem>) {
    if (!el) return;
    el.replaceChildren();
    if (items.length === 0) {
      const none = document.createElement("div");
      none.className = "slash-empty";
      none.textContent = "Sin resultados";
      el.append(none);
    }
    items.forEach((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "slash-item" + (i === selected ? " is-selected" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === selected));
      const t = document.createElement("span");
      t.className = "slash-title";
      t.textContent = item.title;
      const h = document.createElement("span");
      h.className = "slash-hint";
      h.textContent = item.hint;
      row.append(t, h);
      // mousedown, not click: keeps the editor focused and the "/" range alive.
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        command?.(item);
      });
      el!.append(row);
    });
    const rect = props.clientRect?.();
    if (rect) {
      el.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
      const below = rect.bottom + 4;
      const fitsBelow = below + 280 < window.innerHeight;
      el.style.top = fitsBelow ? `${below}px` : `${Math.max(8, rect.top - 4 - Math.min(280, el.offsetHeight || 280))}px`;
    }
  }

  return {
    onStart(props: SuggestionProps<SlashItem, SlashItem>) {
      el = document.createElement("div");
      el.className = "slash-menu";
      el.setAttribute("role", "listbox");
      document.body.append(el);
      items = props.items;
      selected = 0;
      command = props.command;
      paint(props);
    },
    onUpdate(props: SuggestionProps<SlashItem, SlashItem>) {
      items = props.items;
      selected = 0;
      command = props.command;
      paint(props);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (items.length === 0) return false;
      const redraw = () => {
        el?.querySelectorAll(".slash-item").forEach((n, i) => {
          n.classList.toggle("is-selected", i === selected);
          n.setAttribute("aria-selected", String(i === selected));
          if (i === selected) (n as HTMLElement).scrollIntoView?.({ block: "nearest" });
        });
      };
      if (event.key === "ArrowDown") {
        selected = (selected + 1) % items.length;
        redraw();
        return true;
      }
      if (event.key === "ArrowUp") {
        selected = (selected - 1 + items.length) % items.length;
        redraw();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command?.(items[selected]);
        return true;
      }
      return false;
    },
    onExit() {
      el?.remove();
      el = null;
    },
  };
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: renderMenu,
      }),
    ];
  },
});
