import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { burnTypedSignatureIntoPdf, type LegalPdfFontProvider } from "./legalPdfSignature";

const fontBytes = () => readFile(new URL("../../public/fonts/Roboto-Regular.ttf", import.meta.url));
const embedded: LegalPdfFontProvider = async pdf => {
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontBytes(), { subset: true });
  return { signature: font, regular: font };
};
const placement = { page: 2, xNorm: .73, yNorm: .88, widthNorm: .4, heightNorm: .11 };
const at = new Date("2026-09-28T10:30:00Z");
async function original() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595.28, 841.89]).drawText("Approved original source terms", { font: regular });
  pdf.addPage([595.28, 841.89]);
  return pdf.save({ useObjectStreams: false });
}
function content(pdf: PDFDocument, index: number) {
  const contents = pdf.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
  return streams.filter((value): value is PDFRawStream => value instanceof PDFRawStream).map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
}
function runs(pdf: PDFDocument, index: number) {
  const fonts = pdf.getPage(index).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map<string, Map<string, string>>();
  for (const [name, ref] of fonts.entries()) {
    const mapping = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("ToUnicode")), characters = new Map<string, string>();
    if (mapping instanceof PDFRawStream) {
      const cmap = Buffer.from(decodePDFRawStream(mapping).decode()).toString("latin1");
      for (const match of (/beginbfchar([\s\S]*?)endbfchar/.exec(cmap)?.[1] || "").matchAll(/<([a-f0-9]+)>\s*<([a-f0-9]+)>/gi)) characters.set(match[1].toUpperCase(), Buffer.from(match[2], "hex").swap16().toString("utf16le"));
    }
    maps.set(name.asString().slice(1), characters);
  }
  return [...content(pdf, index).matchAll(/BT\s+([\s\S]*?)ET/g)].flatMap(block => {
    const font = /\/([^\s]+)\s+([\d.]+)\s+Tf/.exec(block[1]), word = /<([a-f0-9]+)>\s*Tj/i.exec(block[1])?.[1], point = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(block[1]);
    if (!word || !font || !point) return [];
    const characters = maps.get(font[1]);
    const text = characters?.size ? (word.match(/.{4}/g) || []).map(code => characters.get(code.toUpperCase()) || "�").join("") : Buffer.from(word, "hex").toString("latin1");
    return [{ text, size: Number(font[2]), x: Number(point[1]), y: Number(point[2]) }];
  });
}

describe("existing signature overlay with optional embedded Contract fonts", () => {
  it("preserves the RFQ default fonts, text and coordinates when no provider is supplied", async () => {
    const bytes = await burnTypedSignatureIntoPdf(Uint8Array.from(await original()).buffer, "RFQ Legal Reviewer", "Legal Manager", at, placement);
    const pdf = await PDFDocument.load(bytes), fonts = pdf.getPage(1).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    expect(fonts.entries().map(([, ref]) => String(pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("BaseFont"))))).toEqual(expect.arrayContaining(["/Times-Italic", "/Helvetica"]));
    const text = runs(pdf, 1);
    expect(text[0]).toMatchObject({ text: "RFQ Legal Reviewer", size: 16 });
    expect(text[1]).toMatchObject({ text: "Legal Manager", size: 8 });
    expect(text[0].y - text[1].y).toBeCloseTo(14);
    expect(text[1].y - text[2].y).toBeCloseTo(12);
  });

  it("embeds the approved font for the Contract name and audit labels without changing source pages", async () => {
    const source = await original(), before = await PDFDocument.load(source);
    const bytes = await burnTypedSignatureIntoPdf(Uint8Array.from(source).buffer, "Élodie Martin", "Legal Manager | SIGNED | v2.0", at, placement, embedded);
    const pdf = await PDFDocument.load(bytes);
    expect(content(pdf, 0)).toBe(content(before, 0));
    expect(runs(pdf, 1).map(row => row.text)).toEqual(expect.arrayContaining(["Élodie Martin", "Legal Manager | SIGNED | v2.0"]));
    const fonts = pdf.getPage(1).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    for (const [, ref] of fonts.entries()) {
      const font = pdf.context.lookup(ref, PDFDict);
      expect(font.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Type0"));
      const descendant = font.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      expect(descendant.lookup(PDFName.of("FontDescriptor"), PDFDict).lookup(PDFName.of("FontFile2"))).toBeInstanceOf(PDFRawStream);
    }
  });

  it("wraps a long adopted name completely within its reserved box, above the role and timestamp", async () => {
    const name = "Alexandria Catherine Elizabeth Josephine Montgomery Richardson Wellington";
    const pdf = await PDFDocument.load(await burnTypedSignatureIntoPdf(Uint8Array.from(await original()).buffer, name, "Legal Manager | SIGNED | v2.0", at, placement, embedded));
    pdf.registerFontkit(fontkit); const measure = await pdf.embedFont(await fontBytes());
    const text = runs(pdf, 1), names = text.slice(0, -2), role = text.at(-2)!;
    expect(names.length).toBeGreaterThan(1);
    expect(names.map(row => row.text).join(" ")).toBe(name);
    const { width, height } = pdf.getPage(1).getSize();
    const left = width * (placement.xNorm - placement.widthNorm / 2), right = width * (placement.xNorm + placement.widthNorm / 2);
    const top = height * (1 - placement.yNorm + placement.heightNorm / 2);
    for (const line of names) {
      expect(line.size).toBeGreaterThanOrEqual(10); expect(line.x).toBeGreaterThan(left);
      expect(line.x + measure.widthOfTextAtSize(line.text, line.size)).toBeLessThan(right - 10);
      expect(line.y + measure.heightAtSize(line.size, { descender: false })).toBeLessThan(top - 10);
      expect(line.y).toBeGreaterThan(role.y + 9);
    }
  });

  it.each(["保留原签名", "W".repeat(160)])("rejects unsupported or unrenderable signatures without substitution: %s", async name => {
    await expect(burnTypedSignatureIntoPdf(Uint8Array.from(await original()).buffer, name, "Legal Manager", at, placement, embedded)).rejects.toThrow(/cannot render|does not fit/);
  });
});
