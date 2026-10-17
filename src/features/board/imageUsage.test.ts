import { describe, expect, it } from "vitest";
import { boardImageFiles, countBoardsUsing, usesImage } from "./imageUsage";

const board = (files: string[]) =>
  JSON.stringify({ nodes: files.map((f, i) => ({ id: `n${i}`, type: "file", x: 0, y: 0, width: 10, height: 10, file: f })), edges: [] });

describe("boardImageFiles", () => {
  it("keeps image file nodes only, resolved to workspace paths, deduped, in order", () => {
    const nodes = [
      { type: "file", file: "Imágenes/b.png" },
      { type: "text", file: "Imágenes/x.png" },
      { type: "file", file: "Imágenes/a.png" },
      { type: "file", file: "Imágenes/b.png" },
      { type: "file", file: "notas.md" },
      { type: "file", file: "https://x.com/a.png" },
      { type: "file", file: "" },
    ];
    expect(boardImageFiles("Ropa/p.canvas", nodes)).toEqual(["Ropa/Imágenes/b.png", "Ropa/Imágenes/a.png"]);
  });
});

describe("usesImage / countBoardsUsing", () => {
  it("compares NFC and relative to the board's folder", () => {
    const nfd = "Imágenes".normalize("NFD");
    expect(usesImage("Ropa/p.canvas", board([`${nfd}/a.png`]), "Ropa/Imágenes/a.png")).toBe(true);
    expect(usesImage("Ropa/p.canvas", board(["Imágenes/b.png"]), "Ropa/Imágenes/a.png")).toBe(false);
    expect(usesImage("Ropa/p.canvas", "no json", "Ropa/Imágenes/a.png")).toBe(false);
  });
  it("counts boards, not blocks", () => {
    const texts = { "Ropa/a.canvas": board(["Imágenes/x.png", "Imágenes/x.png"]), "Ropa/b.canvas": board(["Imágenes/y.png"]) };
    expect(countBoardsUsing(Object.entries(texts), "Ropa/Imágenes/x.png")).toBe(1);
  });
});
