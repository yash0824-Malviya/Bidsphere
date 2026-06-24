import autoTable from "jspdf-autotable";
import type { PurchaseReceipt } from "../../types/erpnext";
import {
  addFootersToAllPages,
  BRAND,
  createDocument,
  drawInvoiceFooter,
  drawInvoiceHeader,
  drawMetaGrid,
  drawSectionTitle,
  formatPdfCurrency,
  formatPdfDate,
  formatPdfNumber,
  PAGE,
  sanitizeFilename,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo } from "./logo";
import {
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
} from "../supplierPortalUtils";

export function grnPdfFilename(grn: PurchaseReceipt): string {
  const clean = sanitizeFilename(grn.name ?? "GRN");
  const upper = clean.toUpperCase();
  if (upper.startsWith("GRN-") || upper.startsWith("GRN_")) {
    return `${clean}.pdf`;
  }
  return `GRN-${clean}.pdf`;
}

export async function buildGrnPdf(grn: PurchaseReceipt, statusLabel: string) {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const poRef = primaryPOFromReceipt(grn);
  const warehouse = primaryWarehouseFromReceipt(grn);

  let y = drawInvoiceHeader(
    doc,
    grn.company ?? "Netlink",
    "GOODS RECEIPT NOTE",
    grn.name ?? "—"
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", grn.supplier_name ?? grn.supplier ?? "—"],
      ["Posting Date", formatPdfDate(grn.posting_date)],
      ["Warehouse", warehouse ?? "—"],
      ["Status", statusLabel],
    ],
    [
      ["Company", grn.company ?? "—"],
      ["Related PO", poRef ?? "—"],
      ["GRN Number", grn.name ?? "—"],
      ["Currency", grn.currency ?? "USD"],
    ]
  );

  y = drawSectionTitle(doc, y, "Items Received");

  const items = grn.items ?? [];
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerReserve },
    tableWidth: PAGE.contentWidth,
    head: [["#", "Item", "PO", "Received Qty", "UOM", "Rate", "Amount"]],
    body:
      items.length > 0
        ? items.map((item, idx) => [
            String(idx + 1),
            item.item_name && item.item_name !== item.item_code
              ? `${item.item_code} — ${item.item_name}`
              : item.item_code,
            item.purchase_order ?? "—",
            formatPdfNumber(item.qty ?? 0, 2),
            item.uom ?? item.stock_uom ?? "—",
            formatPdfCurrency(item.rate),
            formatPdfCurrency(item.amount),
          ])
        : [["—", "No line items on this GRN", "—", "—", "—", "—", "—"]],
    styles: {
      font: "Roboto",
      fontSize: 8,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      lineColor: BRAND.slate200,
      lineWidth: 0.1,
      textColor: BRAND.slate900,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: BRAND.slate700,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 8,
      font: "Roboto",
    },
    alternateRowStyles: { fillColor: BRAND.slate100 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  const tableEnd = doc.lastAutoTable?.finalY ?? y;
  y = tableEnd + 8;

  setPdfBodyFont(doc, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.slate900);
  doc.text(
    `Grand Total: ${formatPdfCurrency(grn.grand_total)}`,
    PAGE.width - PAGE.margin,
    y,
    { align: "right" }
  );

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

export async function downloadGrnPdf(
  grn: PurchaseReceipt,
  statusLabel: string
): Promise<void> {
  const doc = await buildGrnPdf(grn, statusLabel);
  doc.save(grnPdfFilename(grn));
}

export async function printGrnPdf(
  grn: PurchaseReceipt,
  statusLabel: string
): Promise<void> {
  const doc = await buildGrnPdf(grn, statusLabel);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
