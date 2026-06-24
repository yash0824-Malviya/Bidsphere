import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import type { PurchaseInvoice } from "../../types/erpnext";
import {
  addFootersToAllPages,
  BRAND,
  createDocument,
  drawInvoiceFooter,
  drawInvoiceHeader,
  drawMetaGrid,
  drawPaidWatermark,
  drawSectionTitle,
  formatPdfNumber,
  formatPdfDate,
  formatPdfCurrency,
  PAGE,
  sanitizeFilename,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo } from "./logo";

export function invoicePdfFilename(invoice: PurchaseInvoice): string {
  const name = invoice.name ?? "INVOICE";
  return `Invoice_${sanitizeFilename(name)}.pdf`;
}

function drawSummarySection(
  doc: jsPDF,
  startY: number,
  subtotal: number | undefined,
  tax: number | undefined,
  grandTotal: number | undefined,
  outstanding?: number
): number {
  const boxWidth = 78;
  const boxX = PAGE.width - PAGE.margin - boxWidth;
  let y = startY;

  const rows: Array<{ label: string; value: string; emphasis?: boolean }> = [
    {
      label: "Subtotal",
      value: formatPdfCurrency(subtotal),
    },
    {
      label: "Tax",
      value: formatPdfCurrency(tax ?? 0),
    },
    {
      label: "Grand Total",
      value: formatPdfCurrency(grandTotal),
      emphasis: true,
    },
  ];

  if ((outstanding ?? 0) > 0) {
    rows.push({
      label: "Outstanding",
      value: formatPdfCurrency(
        outstanding),
    });
  }

  const boxHeight = 10 + rows.length * 7 + 4;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.4);
  doc.setFillColor(...BRAND.white);
  doc.roundedRect(boxX, y, boxWidth, boxHeight, 2, 2, "FD");

  y += 7;
  const labelX = boxX + 5;
  const valueX = boxX + boxWidth - 5;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.emphasis) {
      doc.setFillColor(...BRAND.slate100);
      doc.rect(boxX + 0.5, y - 4.5, boxWidth - 1, 8, "F");
    }

    setPdfBodyFont(doc, row.emphasis ? "bold" : "normal");
    doc.setFontSize(row.emphasis ? 10 : 8.5);
    doc.setTextColor(...(row.emphasis ? BRAND.slate900 : BRAND.slate600));
    doc.text(row.label, labelX, y);
    doc.text(row.value, valueX, y, { align: "right" });

    if (i < rows.length - 1 && !rows[i + 1]?.emphasis) {
      doc.setDrawColor(...BRAND.slate200);
      doc.setLineWidth(0.15);
      doc.line(labelX, y + 2.5, valueX, y + 2.5);
    }

    y += 7;
  }

  return startY + boxHeight + 6;
}

export async function buildInvoicePdf(
  invoice: PurchaseInvoice,
  effectiveStatus: string
) {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const currency = invoice.currency ?? "USD";
  const invoiceName = invoice.name ?? "—";
  const isPaid = effectiveStatus === "Paid";

  let y = drawInvoiceHeader(
    doc,
    invoice.company ?? "Netlink",
    "PURCHASE INVOICE",
    invoiceName
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", invoice.supplier_name ?? invoice.supplier ?? "—"],
      ["Invoice Date", formatPdfDate(invoice.posting_date)],
      ["Due Date", formatPdfDate(invoice.due_date)],
      ["Bill Number", invoice.bill_no ?? "—"],
    ],
    [
      ["Company", invoice.company ?? "—"],
      ["Status", effectiveStatus],
      ["Currency", currency],
      ["Payable Account", invoice.credit_to ?? "—"],
    ]
  );

  y = drawSectionTitle(doc, y, "Line Items");

  const items = invoice.items ?? [];
  const tableMargin = {
    left: PAGE.margin,
    right: PAGE.margin,
    bottom: PAGE.footerReserve,
  };

  autoTable(doc, {
    startY: y,
    margin: tableMargin,
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
            item.uom ?? "—",
            formatPdfCurrency(item.rate),
            formatPdfCurrency(
              item.amount ?? (item.qty ?? 0) * (item.rate ?? 0)
            ),
          ])
        : [["—", "No line items on this invoice", "—", "—", "—", "—"]],
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
  const summaryHeight = 42;
  if (y + summaryHeight > pageHeight) {
    doc.addPage();
    y = PAGE.margin + 4;
    y = drawSectionTitle(doc, y, "Amount Summary");
  } else {
    y = drawSectionTitle(doc, y, "Amount Summary");
  }

  drawSummarySection(
    doc,
    y,
    invoice.net_total,
    invoice.total_taxes_and_charges ?? 0,
    invoice.grand_total,
    invoice.outstanding_amount
  );

  if (isPaid) {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      drawPaidWatermark(doc, { subtitle: "SETTLED" });
    }
  }

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

export async function downloadInvoicePdf(
  invoice: PurchaseInvoice,
  effectiveStatus: string
): Promise<void> {
  const doc = await buildInvoicePdf(invoice, effectiveStatus);
  doc.save(invoicePdfFilename(invoice));
}

export async function printInvoicePdf(
  invoice: PurchaseInvoice,
  effectiveStatus: string
): Promise<void> {
  const doc = await buildInvoicePdf(invoice, effectiveStatus);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
