import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { createExtensions, type ExtensionOptions } from "./extensions";
import {
  pathFromAssetUrl,
  relativeSrc,
  resolveImageSrc,
  resolveWorkspacePath,
  unresolveImageSrc,
  unsupportedSyntax,
} from "./markdown";

/** Real Tiptap + @tiptap/markdown, headless: parse markdown, return what would be saved. */
function serialize(markdown: string, options?: ExtensionOptions) {
  const editor = new Editor({ extensions: createExtensions(options) });
  editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}

// What an agent would write: descriptive text, a numbers table, a task list, an image.
const AGENT_PAGE = `# Telas

Precios por metro, actualizados hoy.

| Tela | Precio por metro | Merma |
| --- | ---: | :--- |
| Algodón | 85.50 | 5% |
| Lino | 120 | 8% |

## Pendientes

- [ ] Pedir muestras
- [x] Confirmar precio del lino
  - [ ] Preguntar por mínimo de compra

![Muestra de lino](adjuntos/lino.png)

Texto final con **negrita** y [un enlace](https://example.com).
`;

describe("markdown round trip (real parser and serializer)", () => {
  it("roundtrip_table_and_image_is_stable", () => {
    const first = serialize(AGENT_PAGE);
    expect(serialize(first)).toBe(first);
    // Nothing semantic is lost.
    expect(first).toContain("![Muestra de lino](adjuntos/lino.png)");
    expect(first).toContain("- [ ] Pedir muestras");
    expect(first).toContain("- [x] Confirmar precio del lino");
    expect(first).toContain("  - [ ] Preguntar por mínimo de compra");
    expect(first).toMatch(/\| Algodón \| 85\.50\s+\| 5%\s+\|/);
    expect(first).toMatch(/\| Lino\s+\| 120\s+\| 8%\s+\|/);
  });

  it("is_stable_for_the_tricky_constructs_we_know_of", () => {
    for (const md of [
      "| a |\n|---|\n| ![y](adjuntos/b.png) |\n",
      "| a | b |\n|---|---|\n| l1<br>l2 | x \\| y |\n",
      "- a\n- b\n  - c\n\n1. x\n2. y\n",
      "```js\nlet a = 1;\n```\n\n> cita\n\n---\n\ntexto\n",
      "Precio 5 * 3 = 15 y snake_case\n",
      "![x](<adjuntos/mi foto.png>)\n",
    ]) {
      const first = serialize(md);
      expect(serialize(first), JSON.stringify(md)).toBe(first);
    }
  });

  it("documents_the_known_normalisations", () => {
    // Each line: [input, expected output]. This pins what the report lists.
    const cases: Array<[string, string]> = [
      ["texto\n", "texto"], // no final newline
      ["* a\n* b\n", "- a\n- b"], // bullet marker
      ["1. a\n1. b\n", "1. a\n2. b"], // list numbering
      ["__b__ _i_\n", "**b** *i*"], // emphasis markers
      ["T\n===\n", "# T"], // setext headings
      ["~~~\nx\n~~~\n", "```\nx\n```"], // fence marker
      ["* [X] t\n", "- [x] t"], // task marker
      ["a<b & c\n", "a&lt;b &amp; c"], // entities
      ["3 * 4\n", "3 \\* 4"], // escaping
      ["a\n\n\n\nb\n", "a\n\n\n\nb"], // extra blank lines survive
      ["- a\n\t- b\n", "- a\n  - b"], // tab indentation
    ];
    for (const [input, expected] of cases) {
      expect(serialize(input), JSON.stringify(input)).toBe(expected);
    }
  });

  it("table_is_realigned_and_gets_blank_lines_around_it", () => {
    const out = serialize("# T\n\n| Tela | Precio |\n|---|---|\n| A | 1 |\n\ntexto\n");
    expect(out).toBe("# T\n\n\n| Tela | Precio |\n| ---- | ------ |\n| A    | 1      |\n\n\ntexto");
  });

  it("does_not_append_a_trailing_empty_paragraph", () => {
    // A trailing-node plugin would make every page ending in a table/list grow.
    expect(serialize("- a\n")).toBe("- a");
    expect(serialize("# H\n")).toBe("# H");
  });

  it("emitting_no_update_events_while_loading_content", () => {
    const onUpdate = vi.fn();
    const editor = new Editor({
      extensions: createExtensions(),
      content: AGENT_PAGE,
      contentType: "markdown",
      onUpdate,
    });
    editor.commands.setContent("# Otro\n\n| a |\n|---|\n| 1 |\n", { contentType: "markdown", emitUpdate: false });
    expect(onUpdate).not.toHaveBeenCalled();
    editor.commands.insertContent("x");
    expect(onUpdate).toHaveBeenCalledTimes(1); // real edits still do
    editor.destroy();
  });

  it("image_src_stays_relative_on_disk", () => {
    const options: ExtensionOptions = {
      resolveSrc: (src) => resolveImageSrc("Ropa/Telas.md", src, "/Users/d/TYPES-espacios", (p) => `asset://localhost/${encodeURIComponent(p)}`),
      toDiskSrc: (src) => unresolveImageSrc("Ropa/Telas.md", src, "/Users/d/TYPES-espacios", pathFromAssetUrl),
    };
    const out = serialize("![x](adjuntos/a.png)\n", options);
    expect(out).toBe("![x](adjuntos/a.png)");

    // Display gets the asset URL, the document keeps the relative path.
    const editor = new Editor({ extensions: createExtensions(options) });
    editor.commands.setContent("![x](adjuntos/a.png)\n", { contentType: "markdown", emitUpdate: false });
    const html = editor.getHTML();
    expect(html).toContain(`src="asset://localhost/${encodeURIComponent("/Users/d/TYPES-espacios/Ropa/adjuntos/a.png")}"`);
    expect(editor.getMarkdown()).toBe("![x](adjuntos/a.png)");
    editor.destroy();
  });

  it("an_asset_url_that_leaks_into_the_document_is_written_back_as_relative", () => {
    const root = "/Users/d/TYPES-espacios";
    const url = `asset://localhost/${encodeURIComponent(`${root}/Ropa/adjuntos/a.png`)}`;
    const out = serialize(`![x](${url})\n`, {
      toDiskSrc: (src) => unresolveImageSrc("Ropa/Telas.md", src, root, pathFromAssetUrl),
    });
    expect(out).toBe("![x](adjuntos/a.png)");
  });

  it("image_with_spaces_is_written_percent_encoded", () => {
    expect(serialize("![x](<adjuntos/mi foto (1).png>)\n")).toBe("![x](adjuntos/mi%20foto%20%281%29.png)");
  });
});

describe("image paths", () => {
  it("resolves_relative_to_the_page_folder", () => {
    expect(resolveWorkspacePath("Ropa/Telas.md", "adjuntos/a.png")).toBe("Ropa/adjuntos/a.png");
    expect(resolveWorkspacePath("Ropa/Telas/Lino.md", "../adjuntos/a.png")).toBe("Ropa/adjuntos/a.png");
    expect(resolveWorkspacePath("Ropa/Telas.md", "adjuntos/mi%20foto.png")).toBe("Ropa/adjuntos/mi foto.png");
    expect(resolveWorkspacePath("Ropa/Telas.md", "../../fuera.png")).toBeNull();
    expect(resolveWorkspacePath("Ropa/Telas.md", "https://x.com/a.png")).toBeNull();
    expect(resolveWorkspacePath("Ropa/Telas.md", "/etc/hosts")).toBeNull();
  });

  it("writes_the_relative_form_for_nested_pages", () => {
    expect(relativeSrc("Ropa/Telas.md", "Ropa/adjuntos/a.png")).toBe("adjuntos/a.png");
    expect(relativeSrc("Ropa/Telas/Lino.md", "Ropa/adjuntos/a.png")).toBe("../adjuntos/a.png");
    expect(relativeSrc("Ropa/A/B/c.md", "Ropa/adjuntos/a b.png")).toBe("../../adjuntos/a%20b.png");
  });

  it("resolve_and_unresolve_are_inverse", () => {
    const root = "/Users/d/Mis Espacios/";
    const toUrl = (p: string) => `asset://localhost/${encodeURIComponent(p)}`;
    for (const [page, src] of [
      ["Ropa/Telas.md", "adjuntos/a.png"],
      ["Ropa/Telas/Lino.md", "../adjuntos/mi%20foto.png"],
    ]) {
      const url = resolveImageSrc(page, src, root, toUrl);
      expect(url).toMatch(/^asset:/);
      expect(unresolveImageSrc(page, url, root, pathFromAssetUrl)).toBe(src);
    }
    expect(resolveImageSrc("Ropa/a.md", "adjuntos/a.png", null, toUrl)).toBe("adjuntos/a.png");
  });

  it("drops_every_src_that_is_not_a_workspace_file_so_a_note_cannot_make_a_request", () => {
    const root = "/Users/d/TYPES-espacios";
    const toUrl = (p: string) => `asset://localhost/${encodeURIComponent(p)}`;
    for (const src of [
      "https://attacker.example/p.png?d=1",
      "http://attacker.example/p.png",
      "//attacker.example/p.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "../../x.png",
      "/etc/hosts",
      "asset://localhost/" + encodeURIComponent("/Users/d/otra-carpeta/x.png"),
      "",
    ]) {
      expect(resolveImageSrc("Ropa/Telas.md", src, root, toUrl), src).toBe("");
      expect(resolveImageSrc("Ropa/Telas.md", src, null, toUrl), `${src} (no root)`).toBe("");
    }
    // an asset URL that points inside the workspace is ours and still displays
    const inside = toUrl(`${root}/Ropa/adjuntos/a.png`);
    expect(resolveImageSrc("Ropa/Telas.md", inside, root, toUrl)).toBe(inside);
  });

  it("an_external_image_renders_without_a_src_attribute_but_keeps_its_alt_and_stays_in_the_file", () => {
    const options: ExtensionOptions = {
      resolveSrc: (src) => resolveImageSrc("Ropa/Telas.md", src, "/Users/d/TYPES-espacios", (p) => `asset://localhost/${encodeURIComponent(p)}`),
      toDiskSrc: (src) => unresolveImageSrc("Ropa/Telas.md", src, "/Users/d/TYPES-espacios", pathFromAssetUrl),
    };
    const md = "![mi foto](https://attacker.example/p.png?d=1)\n";
    const editor = new Editor({ extensions: createExtensions(options) });
    editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
    const html = editor.getHTML();
    expect(html).not.toContain("attacker.example");
    expect(html).not.toMatch(/<img[^>]*\ssrc=/);
    expect(html).toContain('alt="mi foto"');
    // nothing is rewritten: the file still says what Diego's note said
    expect(editor.getMarkdown()).toBe("![mi foto](https://attacker.example/p.png?d=1)");
    editor.destroy();
  });
});

describe("unsupportedSyntax", () => {
  it("flags what the serializer would drop or corrupt", () => {
    expect(unsupportedSyntax("---\ntitle: x\n---\n\n# H")).toEqual(["encabezado YAML"]);
    expect(unsupportedSyntax("<!-- nota -->\n\ntexto")).toEqual(["comentarios HTML"]);
    expect(unsupportedSyntax("<details>\n<summary>x</summary>\n</details>")).toEqual(["bloques HTML"]);
    expect(unsupportedSyntax("texto[^1]\n\n[^1]: nota")).toEqual(["notas al pie"]);
  });

  it("lets ordinary pages through", () => {
    expect(unsupportedSyntax(AGENT_PAGE)).toEqual([]);
    expect(unsupportedSyntax("| a |\n|---|\n| l1<br>l2 |\n\n---\n\nfin")).toEqual([]);
    expect(unsupportedSyntax("```html\n<div>ok</div>\n<!-- c -->\n```\n")).toEqual([]);
  });
});
