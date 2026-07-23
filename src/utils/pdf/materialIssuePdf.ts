import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";

import {
  addFootersToAllPages,
  BRAND,
  createDocument,
  drawInvoiceFooter,
  drawInvoiceHeader,
  drawMetaGrid,
  drawSectionTitle,
  formatPdfDate,
  formatPdfNumber,
  PAGE,
  sanitizeFilename,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo } from "./logo";
import { cleanBusinessWarehouseRemarks } from "../materialIssueRemarksDisplay";

export interface MaterialIssuePdfLine {
  item_code: string;
  item_name: string;
  required_qty: number;
  issued_qty: number;
  remaining_qty: number;
  uom?: string;
}

export interface MaterialIssuePdfData {
  issue_number: string;
  mr_name: string;
  department: string;
  warehouse: string;
  issued_by: string;
  receiver: string;
  issue_date: string;
  issue_type: string;
  remarks?: string;
  items: MaterialIssuePdfLine[];
  temporary?: boolean;
}

export function materialIssuePdfFilename(
  data: Pick<MaterialIssuePdfData, "issue_number">,
): string {
  const clean = sanitizeFilename(data.issue_number || "Material-Issue");
  return `${clean}.pdf`;
}

export async function buildMaterialIssuePdf(
  data: MaterialIssuePdfData,
): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  let y = drawInvoiceHeader(
    doc,
    "Netlink",
    data.temporary ? "MATERIAL ISSUE SLIP (PREVIEW)" : "MATERIAL ISSUE SLIP",
    data.issue_number || "—",
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Material Request", data.mr_name || "—"],
      ["Department", data.department || "—"],
      ["Warehouse", data.warehouse || "—"],
      ["Issue Type", data.issue_type || "—"],
    ],
    [
      ["Issued By", data.issued_by || "—"],
      ["Receiver", data.receiver || "—"],
      ["Issue Date", formatPdfDate(data.issue_date)],
      ["Status", data.temporary ? "Preview" : "Completed"],
    ],
  );

  y = drawSectionTitle(doc, y, "Items Issued");

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerReserve },
    tableWidth: PAGE.contentWidth,
    head: [["#", "Item", "Required", "Issued", "Remaining", "UOM"]],
    body:
      data.items.length > 0
        ? data.items.map((item, idx) => [
            String(idx + 1),
            item.item_name && item.item_name !== item.item_code
              ? `${item.item_code} — ${item.item_name}`
              : item.item_code,
            formatPdfNumber(item.required_qty, 2),
            formatPdfNumber(item.issued_qty, 2),
            formatPdfNumber(item.remaining_qty, 2),
            item.uom || "Nos",
          ])
        : [["—", "No items", "—", "—", "—", "—"]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: {
      fillColor: BRAND.primaryDark,
      textColor: BRAND.white,
      fontStyle: "bold",
    },
  });

  // @ts-expect-error lastAutoTable injected by jspdf-autotable
  y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  y += 8;

  const businessRemarks = cleanBusinessWarehouseRemarks(data.remarks);
  if (businessRemarks) {
    y = drawSectionTitle(doc, y, "Warehouse Remarks");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.slate700);
    for (const bullet of businessRemarks.split(/\r?\n/).filter(Boolean)) {
      const lines = doc.splitTextToSize(`• ${bullet}`, PAGE.contentWidth);
      doc.text(lines, PAGE.margin, y);
      y += lines.length * 4 + 1;
    }
    y += 4;
  }

  y = Math.max(y + 10, 230);
  doc.setDrawColor(...BRAND.slate200);
  doc.line(PAGE.margin, y, PAGE.margin + 70, y);
  doc.line(PAGE.margin + 100, y, PAGE.margin + 170, y);
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  doc.text("Warehouse Manager", PAGE.margin, y + 5);
  doc.text("Receiver", PAGE.margin + 100, y + 5);

  drawInvoiceFooter(doc);
  addFootersToAllPages(doc);
  return doc;
}

export async function downloadMaterialIssuePdf(
  data: MaterialIssuePdfData,
): Promise<void> {
  const doc = await buildMaterialIssuePdf(data);
  doc.save(materialIssuePdfFilename(data));
}

export async function printMaterialIssuePdf(
  data: MaterialIssuePdfData,
): Promise<void> {
  const doc = await buildMaterialIssuePdf(data);
  const url = doc.output("bloburl");
  const win = window.open(url, "_blank");
  if (!win) doc.save(materialIssuePdfFilename(data));
  else {
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        /* ignore */
      }
    }, 400);
  }
}
