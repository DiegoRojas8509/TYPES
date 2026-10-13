import { describe, expect, it } from "vitest";
import { canonPath, describeTool, relativeTo, workspacePath } from "./describeTool";

describe("describe_tool_labels", () => {
  it("labels the allowed tools in Spanish", () => {
    expect(describeTool("Read", { file_path: "/w/Ropa/a.md" })).toBe("Leyendo /w/Ropa/a.md");
    expect(describeTool("Write", { file_path: "/w/Ropa/a.md" })).toBe("Escribiendo /w/Ropa/a.md");
    expect(describeTool("Edit", { file_path: "/w/Ropa/a.md" })).toBe("Editando /w/Ropa/a.md");
    expect(describeTool("Glob", { pattern: "*.md" })).toBe("Buscando «*.md»…");
    expect(describeTool("Grep", {})).toBe("Buscando…");
    expect(describeTool("WebSearch", { query: "tela de algodón" })).toBe("Buscando en la web: tela de algodón");
    expect(describeTool("WebFetch", { url: "https://x.mx" })).toBe("Leyendo la web: https://x.mx");
    expect(describeTool("Bash", { command: "ls" })).toBe("Ejecutando un comando");
    expect(describeTool("Mystery", {})).toBe("Usando Mystery");
  });

  it("shows paths relative to the space and falls back when input is not there yet", () => {
    expect(describeTool("Read", { file_path: "/w/Ropa/Telas/a.md" }, "/w/Ropa")).toBe("Leyendo Telas/a.md");
    expect(describeTool("Read", { file_path: "/w/Otro/a.md" }, "/w/Ropa")).toBe("Leyendo /w/Otro/a.md");
    expect(describeTool("Read", { file_path: "Telas/a.md" }, "/w/Ropa")).toBe("Leyendo Telas/a.md");
    expect(describeTool("Write", {})).toBe("Escribiendo un archivo…");
  });
});

describe("path helpers", () => {
  it("normalises macOS /private aliases, dots and unicode", () => {
    expect(canonPath("/private/var/x/./y/../z")).toBe("/var/x/z");
    expect(canonPath("/private/other/x")).toBe("/private/other/x");
    expect(relativeTo("/private/tmp/w/a.md", "/tmp/w")).toBe("a.md");
    expect(relativeTo("/tmp/w2/a.md", "/tmp/w")).toBeNull();
    expect(workspacePath("/w/Diseño otoño.md".normalize("NFD"), "/w")).toBe("Diseño otoño.md");
  });
});
