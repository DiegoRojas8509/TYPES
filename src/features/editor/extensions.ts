import type { AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { Image } from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { encodeSrc } from "./markdown";

export interface ExtensionOptions {
  /** Maps the relative `src` kept in the document to the URL shown on screen. */
  resolveSrc?: (src: string) => string;
  /** Maps a `src` back to the relative form written to disk (inverse of resolveSrc). */
  toDiskSrc?: (src: string) => string;
}

/**
 * The single extension set used both by the editor and by the headless
 * round-trip tests, so tests exercise the real parser and serializer.
 */
export function createExtensions(options: ExtensionOptions = {}): AnyExtension[] {
  const resolveSrc = options.resolveSrc ?? ((s: string) => s);
  const toDiskSrc = options.toDiskSrc ?? ((s: string) => s);
  const DisplayImage = Image.extend({
    // The document (and therefore the Markdown on disk) keeps the relative
    // path; only the rendered <img> gets the display URL.
    renderMarkdown(node) {
      const src = encodeSrc(toDiskSrc(String(node.attrs?.src ?? "")));
      const alt = String(node.attrs?.alt ?? "");
      const title = node.attrs?.title ? String(node.attrs.title) : "";
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    },
    renderHTML({ HTMLAttributes }) {
      const src = typeof HTMLAttributes.src === "string" ? resolveSrc(HTMLAttributes.src) : undefined;
      return ["img", { ...this.options.HTMLAttributes, ...HTMLAttributes, src }];
    },
  });
  return [
    StarterKit.configure({ trailingNode: false, link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    DisplayImage,
    Markdown,
  ];
}
