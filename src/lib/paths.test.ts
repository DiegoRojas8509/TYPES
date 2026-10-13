import { describe, expect, it } from "vitest";
import { baseName, extOf, isWithin, joinRel, kindOf, parentOf, replacePrefix, spaceOf, titleOf } from "./paths";

describe("paths", () => {
  it("spaceOf returns the first segment", () => {
    expect(spaceOf("Ropa/a/b.md")).toBe("Ropa");
    expect(spaceOf("Ropa")).toBe("Ropa");
    expect(spaceOf("")).toBeNull();
  });

  it("extOf is lowercase without the dot", () => {
    expect(extOf("Ropa/Foto.JPG")).toBe("jpg");
    expect(extOf("Ropa/Notas")).toBe("");
    expect(extOf("Ropa.v2/Notas")).toBe("");
    expect(extOf("Ropa/.oculto")).toBe("");
  });

  it("kindOf classifies by extension", () => {
    expect(kindOf("a/b.md")).toBe("markdown");
    expect(kindOf("a/b.html")).toBe("html");
    expect(kindOf("a/b.png")).toBe("image");
    expect(kindOf("a/b.JPG")).toBe("image");
    expect(kindOf("a/b.csv")).toBe("other");
    expect(kindOf("a/Diseño otoño.md")).toBe("markdown");
  });

  it("joinRel handles the root", () => {
    expect(joinRel("", "Ropa")).toBe("Ropa");
    expect(joinRel("Ropa", "a.md")).toBe("Ropa/a.md");
  });

  it("parentOf and baseName", () => {
    expect(parentOf("Ropa/a/b.md")).toBe("Ropa/a");
    expect(parentOf("Ropa")).toBe("");
    expect(baseName("Ropa/a/b.md")).toBe("b.md");
  });

  it("isWithin matches the path itself and descendants only", () => {
    expect(isWithin("Ropa/a.md", "Ropa")).toBe(true);
    expect(isWithin("Ropa", "Ropa")).toBe(true);
    expect(isWithin("Ropa 2/a.md", "Ropa")).toBe(false);
  });

  it("replacePrefix remaps descendants", () => {
    expect(replacePrefix("Ropa/a/b.md", "Ropa", "Moda")).toBe("Moda/a/b.md");
    expect(replacePrefix("Ropa", "Ropa", "Moda")).toBe("Moda");
  });
});

describe("titleOf", () => {
  it("drops the extension of Markdown pages only", () => {
    expect(titleOf("Ropa/Daring Martin.md")).toBe("Daring Martin");
    expect(titleOf("Ropa/Notas.markdown")).toBe("Notas");
    expect(titleOf("Ropa/Dashboard.html")).toBe("Dashboard.html");
    expect(titleOf("Ropa/foto.png")).toBe("foto.png");
    expect(titleOf("CLAUDE.md")).toBe("CLAUDE");
    expect(titleOf("Ropa/a.md.md")).toBe("a.md");
  });
});
