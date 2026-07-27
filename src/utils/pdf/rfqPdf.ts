/**
 * Client-side Request for Quotation PDF.
 *
 * Generates a clean A4 portrait business document from structured RFQ data.
 * Never uses window.print() / DOM capture — layout chrome (sidebar, nav,
 * chatbot, etc.) is never included.
 */

import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";

import { APP_NAME, COMPANY_NAME } from "../../config/branding";
import {
  BRAND,
  PAGE,
  createDocument,
  formatPdfCurrency,
  formatPdfDate,
  formatPdfNumber,
  generationTimestamp,
  sanitizeFilename,
  setPdfFont,
  stripPdfUnsafeSpaces,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo, drawPdfLogo } from "./logo";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface RfqPdfItem {
  item_code: string;
  item_name?: string;
  qty: number;
  uom?: string;
  unit_price?: number | null;
  total?: number | null;
  /** Included only when RFQ show-to-supplier flag is ON (external docs). */
  target_price?: number | null;
}

export interface RfqPdfAiRecommendation {
  recommended_supplier?: string | null;
  confidence?: number | null;
  summary?: string | null;
  risk_level?: string | null;
  savings?: number | null;
}

export interface RfqPdfApprovalRow {
  approver: string;
  status: string;
  date?: string | null;
  remarks?: string | null;
}

export interface RfqPdfData {
  rfq_number: string;
  title?: string | null;
  status?: string | null;
  company?: string | null;
  department?: string | null;
  buyer?: string | null;
  owner?: string | null;
  currency?: string | null;
  created_date?: string | null;
  valid_till?: string | null;
  material_request?: string | null;
  selected_supplier?: string | null;
  award_value?: number | null;
  delivery_date?: string | null;
  purchase_order_status?: string | null;
  purchase_order_name?: string | null;
  items: RfqPdfItem[];
  /** When true, Target Price column is rendered (supplier-visible / external). */
  include_target_price?: boolean;
  ai?: RfqPdfAiRecommendation | null;
  approvals?: RfqPdfApprovalRow[];
  terms?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

export function rfqPdfFilename(data: Pick<RfqPdfData, "rfq_number">): string {
  return `RFQ_${sanitizeFilename(data.rfq_number || "RequestForQuotation")}.pdf`;
}

function hasText(value?: string | null): boolean {
  const v = (value ?? "").trim();
  return v.length > 0 && v !== "—" && v.toLowerCase() !== "n/a";
}

function hasNumber(value?: number | null): boolean {
  return value != null && !Number.isNaN(Number(value));
}

function pairFields(
  fields: Array<[string, string]>,
): [Array<[string, string]>, Array<[string, string]>] {
  const left: Array<[string, string]> = [];
  const right: Array<[string, string]> = [];
  fields.forEach((field, i) => {
    if (i % 2 === 0) left.push(field);
    else right.push(field);
  });
  return [left, right];
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const limit = PAGE.height - PAGE.footerReserve;
  if (y + needed <= limit) return y;
  doc.addPage();
  return PAGE.margin + 4;
}

function drawBlueSectionTitle(doc: jsPDF, y: number, title: string): number {
  const { margin } = PAGE;
  doc.setFillColor(...BRAND.primaryLight);
  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(0.35);
  doc.rect(margin, y, PAGE.contentWidth, 8, "FD");

  // Left accent bar
  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, y, 1.2, 8, "F");

  setPdfFont(doc, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.primaryDark);
  doc.text(title.toUpperCase(), margin + 4, y + 5.5);
  return y + 12;
}

function drawMetaField(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
): void {
  setPdfFont(doc, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.slate400);
  doc.text(label.toUpperCase(), x, y);

  setPdfFont(doc, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate900);
  const lines = doc.splitTextToSize(stripPdfUnsafeSpaces(value), width);
  doc.text(lines, x, y + 4.5);
}

function drawMetaSection(
  doc: jsPDF,
  startY: number,
  fields: Array<[string, string]>,
): number {
  if (fields.length === 0) return startY;
  const [left, right] = pairFields(fields);
  const { margin, width } = PAGE;
  const colWidth = (width - margin * 2) / 2 - 4;
  const rowHeight = 9;
  const maxRows = Math.max(left.length, right.length);
  let y = startY;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.setFillColor(...BRAND.white);
  doc.roundedRect(
    margin,
    y - 2,
    PAGE.contentWidth,
    maxRows * rowHeight + 6,
    1.2,
    1.2,
    "FD",
  );

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
        right[i][1],
      );
    }
    y += rowHeight;
  }
  return y + 8;
}

function drawStatusBadge(
  doc: jsPDF,
  x: number,
  y: number,
  status: string,
): number {
  const label = status.trim() || "Draft";
  setPdfFont(doc, "bold");
  doc.setFontSize(8);
  const padX = 2.5;
  const textW = doc.getTextWidth(label);
  const w = textW + padX * 2;
  const h = 5.5;

  doc.setFillColor(...BRAND.primaryLight);
  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(0.25);
  doc.roundedRect(x - w, y - 4, w, h, 1, 1, "FD");
  doc.setTextColor(...BRAND.primaryDark);
  doc.text(label, x - padX, y - 0.4, { align: "right" });
  return w;
}

function drawRfqHeader(doc: jsPDF, data: RfqPdfData): number {
  const { margin, width } = PAGE;
  const headerTop = 10;
  const logoHeight = 16;
  const { widthMm: logoWidth } = drawPdfLogo(doc, margin, headerTop, logoHeight);

  const brandX = margin + logoWidth + 4;
  setPdfFont(doc, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.slate900);
  doc.text(`${COMPANY_NAME} Procurement`, brandX, headerTop + 6);

  setPdfFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  doc.text("Request for Quotation", brandX, headerTop + 11.5);

  const rightX = width - margin;
  setPdfFont(doc, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.slate500);
  doc.text("RFQ Number", rightX, headerTop + 4, { align: "right" });

  setPdfFont(doc, "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.slate900);
  doc.text(data.rfq_number || "—", rightX, headerTop + 10, { align: "right" });

  if (hasText(data.status)) {
    drawStatusBadge(doc, rightX, headerTop + 17.5, data.status!);
  }

  let y = headerTop + logoHeight + 8;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.45);
  doc.line(margin, y, width - margin, y);
  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, y + 0.4, 40, 0.9, "F");
  y += 8;

  const title =
    hasText(data.title) && data.title !== data.rfq_number
      ? data.title!
      : "Request for Quotation";

  setPdfFont(doc, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.slate900);
  const titleLines = doc.splitTextToSize(title, PAGE.contentWidth - 2);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 5.5 + 2;

  setPdfFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  doc.text(`Generation Date: ${generationTimestamp()}`, margin, y);
  y += 8;

  return y;
}

function drawRfqFooter(doc: jsPDF, page: number, total: number): void {
  const { margin, width, height } = PAGE;
  const baseY = height - 16;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.3);
  doc.line(margin, baseY - 4, width - margin, baseY - 4);

  setPdfFont(doc, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.slate500);

  doc.text(`Generated by ${APP_NAME}`, margin, baseY);
  doc.text(generationTimestamp(), width / 2, baseY, { align: "center" });
  doc.text(`Page ${page} of ${total}`, width - margin, baseY, {
    align: "right",
  });
}

function addRfqFooters(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawRfqFooter(doc, i, pageCount);
  }
}

function hasAiContent(ai?: RfqPdfAiRecommendation | null): boolean {
  if (!ai) return false;
  return (
    hasText(ai.recommended_supplier) ||
    hasText(ai.summary) ||
    hasNumber(ai.confidence) ||
    hasText(ai.risk_level) ||
    hasNumber(ai.savings)
  );
}

const TABLE_STYLES = {
  styles: {
    font: "Roboto",
    fontSize: 8,
    cellPadding: { top: 2.8, right: 2.5, bottom: 2.8, left: 2.5 },
    lineColor: BRAND.slate200,
    lineWidth: 0.1,
    textColor: BRAND.slate900,
    overflow: "linebreak" as const,
  },
  headStyles: {
    fillColor: BRAND.primaryDark,
    textColor: BRAND.white,
    fontStyle: "bold" as const,
    fontSize: 8,
    halign: "left" as const,
    font: "Roboto",
  },
  alternateRowStyles: { fillColor: BRAND.slate100 },
  showHead: "everyPage" as const,
  rowPageBreak: "avoid" as const,
  margin: {
    left: PAGE.margin,
    right: PAGE.margin,
    bottom: PAGE.footerReserve,
  },
  tableWidth: PAGE.contentWidth,
};

/* -------------------------------------------------------------------------- */
/*  Builder                                                                   */
/* -------------------------------------------------------------------------- */

export async function buildRfqPdf(data: RfqPdfData): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  let y = drawRfqHeader(doc, data);

  // ── Section 1: RFQ Information ───────────────────────────────────────────
  const infoFields: Array<[string, string]> = [];
  if (hasText(data.rfq_number)) infoFields.push(["RFQ Number", data.rfq_number]);
  if (hasText(data.company)) infoFields.push(["Company", data.company!]);
  if (hasText(data.department)) infoFields.push(["Department", data.department!]);
  if (hasText(data.buyer)) infoFields.push(["Buyer", data.buyer!]);
  if (hasText(data.owner)) infoFields.push(["Owner", data.owner!]);
  if (hasText(data.currency)) infoFields.push(["Currency", data.currency!]);
  if (hasText(data.created_date)) {
    infoFields.push(["Created Date", formatPdfDate(data.created_date)]);
  }
  if (hasText(data.valid_till)) {
    infoFields.push(["Valid Till", formatPdfDate(data.valid_till)]);
  }

  if (infoFields.length > 0) {
    y = ensureSpace(doc, y, 28);
    y = drawBlueSectionTitle(doc, y, "1. RFQ Information");
    y = drawMetaSection(doc, y, infoFields);
  }

  // ── Section 2: Procurement Details ───────────────────────────────────────
  const procFields: Array<[string, string]> = [];
  if (hasText(data.material_request)) {
    procFields.push(["Material Request", data.material_request!]);
  }
  if (hasText(data.selected_supplier)) {
    procFields.push(["Selected Supplier", data.selected_supplier!]);
  }
  if (hasNumber(data.award_value)) {
    procFields.push(["Award Value", formatPdfCurrency(data.award_value)]);
  }
  if (hasText(data.delivery_date)) {
    procFields.push(["Delivery Date", formatPdfDate(data.delivery_date)]);
  }
  if (hasText(data.purchase_order_status)) {
    const poLabel = hasText(data.purchase_order_name)
      ? `${data.purchase_order_status} (${data.purchase_order_name})`
      : data.purchase_order_status!;
    procFields.push(["Purchase Order Status", poLabel]);
  }

  if (procFields.length > 0) {
    y = ensureSpace(doc, y, 28);
    y = drawBlueSectionTitle(doc, y, "2. Procurement Details");
    y = drawMetaSection(doc, y, procFields);
  }

  // ── Section 3: Items Table ───────────────────────────────────────────────
  y = ensureSpace(doc, y, 36);
  y = drawBlueSectionTitle(doc, y, "3. Items");

  const items = data.items ?? [];
  const showTarget = !!data.include_target_price;
  const itemHead = showTarget
    ? ["Item Code", "Item Name", "Quantity", "UOM", "Target Price", "Unit Price", "Total"]
    : ["Item Code", "Item Name", "Quantity", "UOM", "Unit Price", "Total"];
  autoTable(doc, {
    startY: y,
    ...TABLE_STYLES,
    head: [itemHead],
    body:
      items.length > 0
        ? items.map((item) => {
            const base = [
              item.item_code || "—",
              item.item_name || item.item_code || "—",
              formatPdfNumber(item.qty ?? 0, 2),
              item.uom || "—",
            ];
            if (showTarget) {
              base.push(
                hasNumber(item.target_price)
                  ? formatPdfCurrency(item.target_price)
                  : "—",
              );
            }
            base.push(
              hasNumber(item.unit_price)
                ? formatPdfCurrency(item.unit_price)
                : "—",
              hasNumber(item.total) ? formatPdfCurrency(item.total) : "—",
            );
            return base;
          })
        : [itemHead.map((_, i) => (i === 1 ? "No line items on this RFQ" : "—"))],
    columnStyles: showTarget
      ? {
          0: { cellWidth: 24 },
          1: { cellWidth: "auto", minCellWidth: 32 },
          2: { cellWidth: 18, halign: "right" },
          3: { cellWidth: 14, halign: "center" },
          4: { cellWidth: 24, halign: "right" },
          5: { cellWidth: 24, halign: "right" },
          6: { cellWidth: 24, halign: "right", fontStyle: "bold" },
        }
      : {
          0: { cellWidth: 28 },
          1: { cellWidth: "auto", minCellWidth: 40 },
          2: { cellWidth: 22, halign: "right" },
          3: { cellWidth: 16, halign: "center" },
          4: { cellWidth: 28, halign: "right" },
          5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
        },
    didParseCell(cellData) {
      if (
        cellData.section === "head" &&
        (cellData.column.index === 2 ||
          cellData.column.index === 4 ||
          cellData.column.index === 5)
      ) {
        cellData.cell.styles.halign = "right";
      }
      if (cellData.section === "head" && cellData.column.index === 3) {
        cellData.cell.styles.halign = "center";
      }
    },
  });

  y = (doc.lastAutoTable?.finalY ?? y) + 10;

  // ── Section 4: AI Recommendation (only if data exists) ───────────────────
  if (hasAiContent(data.ai)) {
    const ai = data.ai!;
    y = ensureSpace(doc, y, 36);
    y = drawBlueSectionTitle(doc, y, "4. AI Recommendation");

    const aiFields: Array<[string, string]> = [];
    if (hasText(ai.recommended_supplier)) {
      aiFields.push(["Recommended Supplier", ai.recommended_supplier!]);
    }
    if (hasNumber(ai.confidence)) {
      aiFields.push(["Confidence", `${Math.round(Number(ai.confidence))}%`]);
    }
    if (hasText(ai.risk_level)) {
      aiFields.push(["Risk Level", ai.risk_level!]);
    }
    if (hasNumber(ai.savings)) {
      aiFields.push(["Estimated Savings", formatPdfCurrency(ai.savings)]);
    }
    y = drawMetaSection(doc, y, aiFields);

    if (hasText(ai.summary)) {
      y = ensureSpace(doc, y, 20);
      setPdfFont(doc, "normal");
      doc.setFontSize(7);
      doc.setTextColor(...BRAND.slate400);
      doc.text("SUMMARY", PAGE.margin, y);
      y += 4;
      setPdfFont(doc, "normal");
      doc.setFontSize(9);
      doc.setTextColor(...BRAND.slate700);
      const lines = doc.splitTextToSize(ai.summary!.trim(), PAGE.contentWidth);
      const blockH = lines.length * 4.2 + 4;
      y = ensureSpace(doc, y, blockH);
      doc.text(lines, PAGE.margin, y);
      y += blockH + 4;
    }
  }

  // ── Section 5: Approval History ─────────────────────────────────────────
  const approvals = (data.approvals ?? []).filter(
    (row) => hasText(row.approver) || hasText(row.status),
  );
  if (approvals.length > 0) {
    y = ensureSpace(doc, y, 36);
    y = drawBlueSectionTitle(doc, y, "5. Approval History");
    autoTable(doc, {
      startY: y,
      ...TABLE_STYLES,
      head: [["Approver", "Status", "Date", "Remarks"]],
      body: approvals.map((row) => [
        row.approver || "—",
        row.status || "—",
        hasText(row.date) ? formatPdfDate(row.date) : "—",
        hasText(row.remarks) ? row.remarks! : "—",
      ]),
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 28 },
        2: { cellWidth: 28 },
        3: { cellWidth: "auto", minCellWidth: 40 },
      },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  }

  // ── Section 6: Terms & Conditions ────────────────────────────────────────
  if (hasText(data.terms)) {
    y = ensureSpace(doc, y, 28);
    y = drawBlueSectionTitle(doc, y, "6. Terms & Conditions");
    setPdfFont(doc, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.slate700);
    const lines = doc.splitTextToSize(data.terms!.trim(), PAGE.contentWidth);
    const pageLimit = PAGE.height - PAGE.footerReserve;
    let cursor = 0;
    while (cursor < lines.length) {
      const room = Math.max(1, Math.floor((pageLimit - y) / 4.2));
      const chunk = lines.slice(cursor, cursor + room);
      doc.text(chunk, PAGE.margin, y);
      cursor += chunk.length;
      if (cursor < lines.length) {
        doc.addPage();
        y = PAGE.margin + 4;
      } else {
        y += chunk.length * 4.2 + 4;
      }
    }
  }

  addRfqFooters(doc);
  return doc;
}

export async function downloadRfqPdf(data: RfqPdfData): Promise<void> {
  const doc = await buildRfqPdf(data);
  doc.save(rfqPdfFilename(data));
}

export async function printRfqPdf(data: RfqPdfData): Promise<void> {
  const doc = await buildRfqPdf(data);
  doc.autoPrint();
  const blob = doc.output("bloburl");
  const win = window.open(blob, "_blank");
  if (!win) {
    doc.save(rfqPdfFilename(data));
  }
}
