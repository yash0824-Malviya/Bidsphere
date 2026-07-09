import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import type { PurchaseOrder } from "../../types/erpnext";
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

/**
 * Client-side Purchase Order PDF.
 *
 * ERPNext's `frappe.utils.print_format.download_pdf` fails on this deployment
 * because wkhtmltopdf cannot fetch print CSS/assets (ContentNotFoundError →
 * "PDF generation failed because of broken image links"). Invoice/GRN already
 * use jsPDF; PO follows the same reliable path so BidSphere never depends on
 * the broken server-side PDF pipeline.
 */
export function poPdfFilename(po: Pick<PurchaseOrder, "name">): string {
  return `PO_${sanitizeFilename(po.name ?? "PurchaseOrder")}.pdf`;
}

function drawSummarySection(
  doc: jsPDF,
  startY: number,
  netTotal: number | undefined,
  tax: number | undefined,
  grandTotal: number | undefined,
): number {
  const boxWidth = 78;
  const boxX = PAGE.width - PAGE.margin - boxWidth;
  let y = startY;

  const rows: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: "Net Total", value: formatPdfCurrency(netTotal) },
    { label: "Taxes", value: formatPdfCurrency(tax ?? 0) },
    {
      label: "Grand Total",
      value: formatPdfCurrency(grandTotal),
      emphasis: true,
    },
  ];

  const boxHeight = 10 + rows.length * 7 + 4;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.4);
  doc.setFillColor(...BRAND.white);
  doc.roundedRect(boxX, y, boxWidth, boxHeight, 2, 2, "FD");

  y += 7;
  const labelX = boxX + 5;
  const valueX = boxX + boxWidth - 5;

  for (const row of rows) {
    if (row.emphasis) {
      doc.setFillColor(...BRAND.slate100);
      doc.rect(boxX + 0.5, y - 4.5, boxWidth - 1, 8, "F");
    }
    setPdfBodyFont(doc, row.emphasis ? "bold" : "normal");
    doc.setFontSize(row.emphasis ? 9 : 8);
    doc.setTextColor(...(row.emphasis ? BRAND.slate900 : BRAND.slate600));
    doc.text(row.label, labelX, y);
    doc.text(row.value, valueX, y, { align: "right" });
    y += 7;
  }

  return startY + boxHeight + 6;
}

export async function buildPurchaseOrderPdf(po: PurchaseOrder) {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const status = po.status ?? (po.docstatus === 1 ? "Submitted" : "Draft");

  let y = drawInvoiceHeader(
    doc,
    po.company ?? "Netlink",
    "PURCHASE ORDER",
    po.name ?? "—",
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", po.supplier_name ?? po.supplier ?? "—"],
      ["PO Date", formatPdfDate(po.transaction_date)],
      ["Required By", formatPdfDate(po.schedule_date)],
      ["Status", status],
    ],
    [
      ["Company", po.company ?? "—"],
      ["Currency", po.currency ?? "USD"],
      ["Price List", po.buying_price_list ?? "—"],
      ["PO Number", po.name ?? "—"],
    ],
  );

  y = drawSectionTitle(doc, y, "Line Items");

  const items = po.items ?? [];
  autoTable(doc, {
    startY: y,
    margin: {
      left: PAGE.margin,
      right: PAGE.margin,
      bottom: PAGE.footerReserve,
    },
    tableWidth: PAGE.contentWidth,
    head: [["#", "Item Description", "Qty", "UOM", "Rate", "Amount"]],
    body:
      items.length > 0
        ? items.map((item, idx) => [
            String(idx + 1),
            item.item_name && item.item_name !== item.item_code
              ? `${item.item_code} — ${item.item_name}`
              : item.item_code,
            formatPdfNumber(item.qty ?? 0, 2),
            item.uom ?? item.stock_uom ?? "—",
            formatPdfCurrency(item.rate),
            formatPdfCurrency(
              item.amount ?? (item.qty ?? 0) * (item.rate ?? 0),
            ),
          ])
        : [["—", "No line items on this purchase order", "—", "—", "—", "—"]],
    styles: {
      font: "Roboto",
      fontSize: 8,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      lineColor: BRAND.slate200,
      lineWidth: 0.1,
      textColor: BRAND.slate900,
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      1: { cellWidth: "auto", minCellWidth: 48 },
      2: { cellWidth: 18, halign: "right" },
      3: { cellWidth: 14, halign: "center" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
    headStyles: {
      fillColor: BRAND.slate700,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 8,
      halign: "left",
      font: "Roboto",
    },
    didParseCell(data) {
      if (
        data.section === "head" &&
        (data.column.index === 4 || data.column.index === 5)
      ) {
        data.cell.styles.halign = "right";
      }
      if (
        data.section === "body" &&
        (data.column.index === 4 || data.column.index === 5)
      ) {
        data.cell.styles.halign = "right";
      }
    },
    alternateRowStyles: { fillColor: BRAND.slate100 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  const tableEnd = doc.lastAutoTable?.finalY ?? y;
  y = tableEnd + 10;

  const pageHeight = PAGE.height - PAGE.footerReserve;
  if (y + 42 > pageHeight) {
    doc.addPage();
    y = PAGE.margin + 4;
  }
  y = drawSectionTitle(doc, y, "Amount Summary");
  drawSummarySection(
    doc,
    y,
    po.net_total ?? po.total,
    po.total_taxes_and_charges ?? 0,
    po.grand_total ?? po.rounded_total,
  );

  if (po.terms?.trim()) {
    let termsY = (doc.lastAutoTable?.finalY ?? y) + 50;
    if (termsY + 30 > pageHeight) {
      doc.addPage();
      termsY = PAGE.margin + 4;
    }
    termsY = drawSectionTitle(doc, termsY, "Terms and Conditions");
    setPdfBodyFont(doc, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.slate700);
    const lines = doc.splitTextToSize(po.terms.trim(), PAGE.contentWidth);
    doc.text(lines, PAGE.margin, termsY);
  }

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

export async function downloadPurchaseOrderPdf(po: PurchaseOrder): Promise<void> {
  const doc = await buildPurchaseOrderPdf(po);
  doc.save(poPdfFilename(po));
}

export async function printPurchaseOrderPdf(po: PurchaseOrder): Promise<void> {
  const doc = await buildPurchaseOrderPdf(po);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
