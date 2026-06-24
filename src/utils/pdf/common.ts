import jsPDF from "jspdf";
import { APP_NAME, COMPANY_NAME } from "../../config/branding";
import { DEFAULT_CURRENCY } from "../format";
import { drawPdfLogo } from "./logo";

/** BidSphere brand palette (RGB). */
export const BRAND = {
  primary: [74, 144, 217] as [number, number, number],
  primaryDark: [44, 82, 130] as [number, number, number],
  primaryLight: [239, 246, 255] as [number, number, number],
  slate900: [15, 23, 42] as [number, number, number],
  slate700: [51, 65, 85] as [number, number, number],
  slate600: [71, 85, 105] as [number, number, number],
  slate500: [100, 116, 139] as [number, number, number],
  slate400: [148, 163, 184] as [number, number, number],
  slate200: [226, 232, 240] as [number, number, number],
  slate100: [241, 245, 249] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  success: [22, 163, 74] as [number, number, number],
  successLight: [220, 252, 231] as [number, number, number],
};

export const PAGE = {
  margin: 14,
  width: 210,
  height: 297,
  contentWidth: 182,
  footerReserve: 26,
};

export function createDocument(): jsPDF {
  return new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
}

/** Prefer Roboto when embedded; fall back to Helvetica. */
export function pdfFontFamily(doc: jsPDF): string {
  const fonts = doc.getFontList();
  return fonts.Roboto ? "Roboto" : "helvetica";
}

export function setPdfFont(
  doc: jsPDF,
  style: "normal" | "bold" | "italic" = "normal"
): void {
  doc.setFont(pdfFontFamily(doc), style);
}

/** Strip invisible Unicode spaces that cause jsPDF to render digits with gaps. */
export function stripPdfUnsafeSpaces(value: string): string {
  return value.replace(/[\u00A0\u202F\u2009\u2007\uFEFF]/g, "");
}

/** US-style number for PDF output (avoids narrow no-break spaces from Intl). */
export function formatPdfNumber(
  value: number | string | undefined | null,
  fractionDigits = 2
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return stripPdfUnsafeSpaces(
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(n)
  );
}

/** USD currency string for PDF output. */
export function formatPdfCurrency(
  amount: number | string | undefined | null
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return "—";
  return stripPdfUnsafeSpaces(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  );
}

export function formatPdfDate(value?: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function generationTimestamp(): string {
  return new Date().toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Draw Netlink logo in PDF headers (call `ensurePdfLogo()` first). */
export function drawLogoArea(
  doc: jsPDF,
  x: number,
  y: number,
  size = 18
): { widthMm: number; heightMm: number } {
  return drawPdfLogo(doc, x, y, size);
}

/** ERP-style invoice header with logo area and bold document number. */
export function drawInvoiceHeader(
  doc: jsPDF,
  companyName: string,
  documentLabel: string,
  documentNumber: string
): number {
  const { margin, width } = PAGE;
  const headerTop = 10;
  const logoHeight = 18;
  const { widthMm: logoWidth } = drawLogoArea(doc, margin, headerTop, logoHeight);

  const brandX = margin + logoWidth + 4;
  doc.setTextColor(...BRAND.slate900);
  setPdfFont(doc, "bold");
  doc.setFontSize(20);
  doc.text(APP_NAME, brandX, headerTop + 7);

  setPdfFont(doc, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.slate500);
  doc.text("Procure-to-Pay Platform", brandX, headerTop + 12);

  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate600);
  doc.text(companyName, brandX, headerTop + 17);

  const rightX = width - margin;
  setPdfFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  doc.text(documentLabel, rightX, headerTop + 5, { align: "right" });

  setPdfFont(doc, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.slate900);
  doc.text(documentNumber, rightX, headerTop + 12, { align: "right" });

  const dividerY = headerTop + logoHeight + 6;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.5);
  doc.line(margin, dividerY, width - margin, dividerY);

  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, dividerY + 0.5, 36, 0.8, "F");

  return dividerY + 10;
}

/** Draw branded header band (used by payment receipts). */
export function drawBrandedHeader(
  doc: jsPDF,
  documentLabel: string,
  documentNumber: string
): number {
  const { margin, width } = PAGE;

  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, width, 28, "F");

  doc.setFillColor(...BRAND.primaryDark);
  doc.rect(0, 28, width, 1.2, "F");

  const logoHeight = 18;
  const { widthMm: logoWidth } = drawLogoArea(doc, margin, 5, logoHeight);

  doc.setTextColor(...BRAND.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(APP_NAME, margin + logoWidth + 4, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Procure-to-Pay Platform", margin + logoWidth + 4, 17);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(documentLabel, width - margin, 11, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(documentNumber, width - margin, 17, { align: "right" });

  return 38;
}

/** Two-column metadata block with ERP card styling. */
export function drawMetaGrid(
  doc: jsPDF,
  startY: number,
  left: Array<[string, string]>,
  right: Array<[string, string]>
): number {
  const { margin, width } = PAGE;
  const colWidth = (width - margin * 2) / 2 - 4;
  let y = startY;

  const rowHeight = 9;
  const maxRows = Math.max(left.length, right.length);

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.setFillColor(...BRAND.slate100);
  doc.roundedRect(margin, y - 2, PAGE.contentWidth, maxRows * rowHeight + 6, 1.5, 1.5, "FD");

  y += 2;

  for (let i = 0; i < maxRows; i++) {
    if (left[i]) {
      drawMetaField(doc, margin + 4, y, colWidth, left[i][0], left[i][1]);
    }
    if (right[i]) {
      drawMetaField(
        doc,
        margin + colWidth + 8,
        y,
        colWidth,
        right[i][0],
        right[i][1]
      );
    }
    y += rowHeight;
  }

  return y + 8;
}

function drawMetaField(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
): void {
  setPdfFont(doc, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.slate400);
  doc.text(label.toUpperCase(), x, y);

  setPdfFont(doc, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate900);
  const safe = stripPdfUnsafeSpaces(value || "—");
  const lines = doc.splitTextToSize(safe, width);
  doc.text(lines, x, y + 4.5);
}

export function drawSectionTitle(doc: jsPDF, y: number, title: string): number {
  const { margin } = PAGE;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.setFillColor(...BRAND.slate100);
  doc.rect(margin, y, PAGE.contentWidth, 8, "FD");
  setPdfFont(doc, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.slate700);
  doc.text(title.toUpperCase(), margin + 3, y + 5.5);
  return y + 12;
}

/** Standard footer (payment receipts). */
export function drawFooter(doc: jsPDF): void {
  const { margin, width, height } = PAGE;
  const footerY = height - 12;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 3, width - margin, footerY - 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.slate400);
  doc.text(`${APP_NAME} by ${COMPANY_NAME} · Confidential`, margin, footerY);
  doc.text(`Generated ${generationTimestamp()}`, width - margin, footerY, {
    align: "right",
  });
}

/** Invoice-specific three-line footer. */
export function drawInvoiceFooter(doc: jsPDF): void {
  const { margin, width, height } = PAGE;
  const baseY = height - 20;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.line(margin, baseY - 4, width - margin, baseY - 4);

  setPdfFont(doc, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.slate500);

  const lines = [
    `Generated by ${APP_NAME}`,
    `Generated On: ${generationTimestamp()}`,
    "This is a computer generated document.",
  ];

  let y = baseY;
  for (const line of lines) {
    doc.text(line, width / 2, y, { align: "center" });
    y += 4;
  }
}

export function addFootersToAllPages(
  doc: jsPDF,
  footerFn: (doc: jsPDF) => void = drawFooter
): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    footerFn(doc);
  }
}

/** Diagonal green PAID watermark (5–10% opacity). */
export function drawPaidWatermark(
  doc: jsPDF,
  opts?: { opacity?: number; subtitle?: string }
): void {
  const cx = PAGE.width / 2;
  const cy = PAGE.height / 2;
  const opacity = opts?.opacity ?? 0.08;

  doc.saveGraphicsState();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const GState = (doc as any).GState;
    if (GState) {
      doc.setGState(new GState({ opacity }));
    }
  } catch {
    // opacity not supported — watermark still drawn
  }

  setPdfFont(doc, "bold");
  doc.setTextColor(...BRAND.success);
  doc.setFontSize(80);
  doc.text("PAID", cx, cy, { align: "center", angle: 35 });

  if (opts?.subtitle) {
    doc.setFontSize(14);
    doc.text(opts.subtitle, cx, cy + 14, { align: "center", angle: 35 });
  }

  doc.restoreGraphicsState();
}

/** Payment receipt footer with audit metadata. */
export function drawPaymentReceiptFooter(
  doc: jsPDF,
  authorizedBy: string,
  documentStatus: string
): void {
  const { margin, width, height } = PAGE;
  const baseY = height - 24;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.line(margin, baseY - 4, width - margin, baseY - 4);

  setPdfFont(doc, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.slate500);

  const lines = [
    `Generated by ${APP_NAME}`,
    `Generated On: ${generationTimestamp()}`,
    `Authorized By: ${authorizedBy || "—"}`,
    `Document Status: ${documentStatus}`,
  ];

  let y = baseY;
  for (const line of lines) {
    doc.text(line, width / 2, y, { align: "center" });
    y += 4;
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}

export function printPdf(doc: jsPDF): void {
  doc.autoPrint();
  const blob = doc.output("bloburl");
  const win = window.open(blob, "_blank");
  if (!win) {
    doc.save("document.pdf");
  }
}
