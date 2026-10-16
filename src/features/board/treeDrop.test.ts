import { describe, expect, it } from "vitest";
import { planTreeDrop } from "./treeDrop";

describe("planTreeDrop", () => {
  it("links an image of the same space, relative to a top-level board", () => {
    expect(planTreeDrop("Ropa/pizarra.canvas", "Ropa/adjuntos/codigo.png")).toEqual({ kind: "link", file: "adjuntos/codigo.png" });
  });
  it("links relative to a board in a subfolder", () => {
    expect(planTreeDrop("Ropa/sub/p.canvas", "Ropa/adjuntos/codigo.png")).toEqual({ kind: "link", file: "../adjuntos/codigo.png" });
  });
  it("keeps spaces and parentheses plain", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/adjuntos/foto (1) a.png")).toEqual({ kind: "link", file: "adjuntos/foto (1) a.png" });
  });
  it("copies an image from another space into the board's adjuntos", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Otro/adjuntos/a.png")).toEqual({ kind: "copy", destDir: "Ropa/adjuntos" });
  });
  it("rejects non-images", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/Notas.md")).toEqual({ kind: "reject", reason: "not-image" });
  });
  it("rejects a board outside a space", () => {
    expect(planTreeDrop("p.canvas", "Ropa/adjuntos/a.png")).toEqual({ kind: "reject", reason: "no-space" });
  });
});
