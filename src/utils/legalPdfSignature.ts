import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { DEFAULT_SIGNATURE_BOX, type LegalEsignPlacement } from "../types/legalEsign";

/** Optional document-specific fonts; existing RFQ callers keep their current appearance. */
export type LegalPdfFontProvider = (pdf: PDFDocument) => Promise<{ signature: PDFFont; regular: PDFFont }>;

function embeddedSignatureLines(font: PDFFont, value: string, width: number, boxHeight: number) {
  const supported = new Set(font.getCharacterSet());
  if ([...value].some(char => char !== "\n" && char !== "\r" && !supported.has(char.codePointAt(0)!))) throw new Error("The approved Contract font cannot render this signature. Enter a supported typed signature before confirming.");
  for (let size = 16; size >= 10; size -= .5) {
    const lines: string[] = [];
    for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/ +/)) {
        if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width) { line = line ? `${line} ${word}` : word; continue; }
        if (line) { lines.push(line); line = ""; }
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      if (line) lines.push(line);
    }
    const leading = size * 1.1, top = boxHeight - 13 - font.heightAtSize(size, { descender: false });
    if (lines.length && 40 + (lines.length - 1) * leading <= top) return { lines, size, leading, firstBaseline: lines.length === 1 ? 42 : 40 + (lines.length - 1) * leading };
  }
  throw new Error("This typed signature does not fit the reserved Contract signature area. Enter a shorter signature and explicitly adopt it before confirming.");
}

export async function burnTypedSignatureIntoPdf(
  source: ArrayBuffer,
  typedName: string,
  roleLabel: string,
  signedAt: Date,
  placement: LegalEsignPlacement,
  embedFonts?: LegalPdfFontProvider,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const pages = pdf.getPages();
  const pageIndex = Math.max(0, Math.min(pages.length - 1, placement.page - 1));
  const page = pages[pageIndex];
  const { width, height } = page.getSize();

  const embedded = embedFonts ? await embedFonts(pdf) : undefined;
  const font = embedded?.signature || await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const fontRegular = embedded?.regular || await pdf.embedFont(StandardFonts.Helvetica);
  const dateStr = signedAt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = signedAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const boxW = Math.min(
    width * 0.9,
    Math.max(80, (placement.widthNorm || DEFAULT_SIGNATURE_BOX.widthNorm) * width),
  );
  const boxH = Math.min(
    height * 0.4,
    Math.max(40, (placement.heightNorm || DEFAULT_SIGNATURE_BOX.heightNorm) * height),
  );
  const x = Math.max(
    8,
    Math.min(width - boxW - 8, placement.xNorm * width - boxW / 2),
  );
  // PDF coordinates: bottom-left origin. Our yNorm is top-origin.
  const yTop = placement.yNorm * height;
  const y = Math.max(8, Math.min(height - boxH - 8, height - yTop - boxH / 2));

  page.drawRectangle({
    x,
    y,
    width: boxW,
    height: boxH,
    borderColor: rgb(0.15, 0.2, 0.3),
    borderWidth: 0.8,
    color: rgb(1, 1, 1),
    opacity: 0.92,
  });

  const lineY1 = y + boxH - 10;
  const lineY2 = y + 10;
  page.drawLine({
    start: { x: x + 10, y: lineY1 },
    end: { x: x + boxW - 10, y: lineY1 },
    thickness: 0.6,
    color: rgb(0.55, 0.58, 0.62),
  });
  page.drawLine({
    start: { x: x + 10, y: lineY2 },
    end: { x: x + boxW - 10, y: lineY2 },
    thickness: 0.6,
    color: rgb(0.55, 0.58, 0.62),
  });

  if (embedded) {
    const signature = embeddedSignatureLines(font, typedName, boxW - 28, boxH);
    const labelCharacters = new Set(fontRegular.getCharacterSet());
    const timestamp = `${dateStr}  ·  ${timeStr}`;
    for (const label of [roleLabel, timestamp]) {
      if ([...label].some(char => !labelCharacters.has(char.codePointAt(0)!)) || fontRegular.widthOfTextAtSize(label, 8) > boxW - 28) throw new Error("The Contract signature metadata cannot fit its reserved area. Review the signature configuration before confirming.");
    }
    signature.lines.forEach((line, index) => page.drawText(line, { x: x + 14, y: y + signature.firstBaseline - index * signature.leading, size: signature.size, font, color: rgb(0.08, 0.12, 0.2) }));
  } else page.drawText(typedName, {
    x: x + 14,
    y: y + 42,
    size: 16,
    font,
    color: rgb(0.08, 0.12, 0.2),
    maxWidth: boxW - 28,
  });
  page.drawText(roleLabel, {
    x: x + 14,
    y: y + 28,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.38, 0.42),
  });
  page.drawText(`${dateStr}  ·  ${timeStr}`, {
    x: x + 14,
    y: y + 16,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.38, 0.42),
  });

  return pdf.save({ useObjectStreams: false });
}
