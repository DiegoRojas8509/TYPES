import { describe, expect, it } from "vitest";
import { planTreeDrop } from "./treeDrop";

describe("planTreeDrop", () => {
  it("links an image already in the board folder's Imágenes", () => {
    expect(planTreeDrop("Ropa/pizarra.canvas", "Ropa/Imágenes/codigo.png")).toEqual({ kind: "link", file: "Imágenes/codigo.png" });
  });
  it("links in a subfolder board only from that subfolder's Imágenes", () => {
    expect(planTreeDrop("Ropa/Maquila/p.canvas", "Ropa/Maquila/Imágenes/a.png")).toEqual({ kind: "link", file: "Imágenes/a.png" });
  });
  it("compares the folder name NFC, so a Finder (NFD) name still links", () => {
    const nfd = "Imágenes".normalize("NFD");
    expect(nfd).not.toBe("Imágenes");
    expect(planTreeDrop("Ropa/p.canvas", `Ropa/${nfd}/a.png`)).toEqual({ kind: "link", file: `${nfd}/a.png` });
  });
  it("keeps spaces and parentheses plain", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/Imágenes/foto (1) a.png")).toEqual({ kind: "link", file: "Imágenes/foto (1) a.png" });
  });
  it("copies an image of the same space but another folder into the board's folder", () => {
    expect(planTreeDrop("Ropa/Maquila/p.canvas", "Ropa/Imágenes/a.png")).toEqual({ kind: "copy", destDir: "Ropa/Maquila" });
  });
  it("copies an image that sits next to the board, outside Imágenes", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/a.png")).toEqual({ kind: "copy", destDir: "Ropa" });
  });
  it("copies an image from a nested folder inside Imágenes", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/Imágenes/sub/a.png")).toEqual({ kind: "copy", destDir: "Ropa" });
  });
  it("copies an image from another space into the board's folder", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Otro/Imágenes/a.png")).toEqual({ kind: "copy", destDir: "Ropa" });
  });
  it("rejects non-images", () => {
    expect(planTreeDrop("Ropa/p.canvas", "Ropa/Notas.md")).toEqual({ kind: "reject", reason: "not-image" });
  });
  it("rejects a board outside a space", () => {
    expect(planTreeDrop("p.canvas", "Ropa/Imágenes/a.png")).toEqual({ kind: "reject", reason: "no-space" });
  });
});
