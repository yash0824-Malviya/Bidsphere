import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";

import type { Voucher } from "../../types/voucher";
import {
  addFootersToAllPages,
  BRAND,
  createDocument,
  drawInvoiceFooter,
  drawInvoiceHeader,
  drawMetaGrid,
  drawPaidWatermark,
  drawSectionTitle,
  formatPdfCurrency,
  formatPdfDate,
  formatPdfNumber,
  PAGE,
  sanitizeFilename,
  setPdfFont,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo } from "./logo";

/* -------------------------------------------------------------------------- */
/*  Filenames — `<PREFIX>-<NUMBER>.pdf`, never double-prefixed                */
/* -------------------------------------------------------------------------- */

function docFilename(prefix: string, id: string | undefined): string {
  const clean = sanitizeFilename(id || prefix);
  const upper = clean.toUpperCase();
  if (upper.startsWith(`${prefix}-`) || upper.startsWith(`${prefix}_`)) {
    return `${clean}.pdf`;
  }
  return `${prefix}-${clean}.pdf`;
}

export function voucherPdfFilename(voucher: Voucher): string {
  return docFilename("VCH", voucher.id);
}

export function voucherInvoicePdfFilename(voucher: Voucher): string {
  return docFilename("INV", voucher.invoice?.invoice_number ?? voucher.id);
}

export function voucherPaymentPdfFilename(voucher: Voucher): string {
  return docFilename("PAY", voucher.payment?.payment_id ?? voucher.id);
}

/* -------------------------------------------------------------------------- */
/*  Voucher PDF (Finance payment voucher issued to the supplier)              */
/* -------------------------------------------------------------------------- */

const VOUCHER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  invoice_raised: "Invoice Submitted",
  under_review: "Under Review",
  invoice_approved: "Invoice Approved",
  invoice_rejected: "Invoice Rejected",
  payment_confirmed: "Payment Released",
  payment_received: "Payment Received",
};

export async function buildVoucherPdf(voucher: Voucher): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  let y = drawInvoiceHeader(doc, "Netlink", "PAYMENT VOUCHER", voucher.id ?? "—");

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", voucher.supplier_name ?? voucher.supplier ?? "—"],
      ["Created", formatPdfDate(voucher.created_at)],
      ["Issued By", voucher.created_by ?? "—"],
      ["Payment Terms", voucher.payment_terms ?? "—"],
    ],
    [
      ["PO Reference", voucher.po_reference || "—"],
      ["GRN Reference", voucher.grn_reference || "—"],
      ["Due Date", formatPdfDate(voucher.due_date)],
      ["Status", VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status],
    ]
  );

  y = drawSectionTitle(doc, y, "Line Items");

  const items = voucher.items ?? [];
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
            item.uom ?? "—",
            formatPdfCurrency(item.rate),
            formatPdfCurrency(item.amount ?? (item.qty ?? 0) * (item.rate ?? 0)),
          ])
        : [["—", "No line items on this voucher", "—", "—", "—", "—"]],
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
        (data.column.index === 4 || data.column.index === 5) &&
        (data.section === "head" || data.section === "body")
      ) {
        data.cell.styles.halign = "right";
      }
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
    `Voucher Total: ${formatPdfCurrency(voucher.amount)}`,
    PAGE.width - PAGE.margin,
    y,
    { align: "right" }
  );

  if (voucher.notes) {
    y += 10;
    y = drawSectionTitle(doc, y, "Finance Notes");
    setPdfBodyFont(doc, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.slate600);
    const lines = doc.splitTextToSize(voucher.notes, PAGE.contentWidth);
    doc.text(lines, PAGE.margin, y);
  }

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

export async function downloadVoucherPdf(voucher: Voucher): Promise<void> {
  const doc = await buildVoucherPdf(voucher);
  doc.save(voucherPdfFilename(voucher));
}

/* -------------------------------------------------------------------------- */
/*  Invoice PDF (voucher-derived supplier invoice)                            */
/* -------------------------------------------------------------------------- */

function humanInvoiceStatus(voucher: Voucher): string {
  const s = voucher.invoice?.status ?? "submitted";
  if (s === "paid") return "Paid";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return "Submitted";
}

export async function buildVoucherInvoicePdf(voucher: Voucher): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const invoice = voucher.invoice;
  const invoiceNumber = invoice?.invoice_number ?? "—";
  const status = humanInvoiceStatus(voucher);
  const isPaid = status === "Paid";

  let y = drawInvoiceHeader(doc, "Netlink", "SUPPLIER INVOICE", invoiceNumber);

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", voucher.supplier_name ?? voucher.supplier ?? "—"],
      ["Invoice Date", formatPdfDate(invoice?.raised_at)],
      ["Due Date", formatPdfDate(invoice?.due_date)],
      ["Payment Terms", invoice?.payment_terms ?? "—"],
    ],
    [
      ["Voucher Ref", voucher.id ?? "—"],
      ["PO Reference", voucher.po_reference || "—"],
      ["GRN Reference", voucher.grn_reference || "—"],
      ["Status", status],
    ]
  );

  y = drawSectionTitle(doc, y, "Line Items");

  const items = voucher.items ?? [];
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
            item.uom ?? "—",
            formatPdfCurrency(item.rate),
            formatPdfCurrency(item.amount ?? (item.qty ?? 0) * (item.rate ?? 0)),
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
        (data.column.index === 4 || data.column.index === 5) &&
        (data.section === "head" || data.section === "body")
      ) {
        data.cell.styles.halign = "right";
      }
    },
    alternateRowStyles: { fillColor: BRAND.slate100 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  const tableEnd = doc.lastAutoTable?.finalY ?? y;
  y = tableEnd + 8;

  // Financial summary box (Subtotal / Tax / Total).
  const subtotal = invoice?.subtotal ?? voucher.amount ?? 0;
  const taxRate = invoice?.tax_rate ?? 0;
  const taxAmount = invoice?.tax_amount ?? 0;
  const total = invoice?.total ?? subtotal + taxAmount;

  const boxWidth = 78;
  const boxX = PAGE.width - PAGE.margin - boxWidth;
  const rows: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: "Subtotal", value: formatPdfCurrency(subtotal) },
    { label: `Tax (${formatPdfNumber(taxRate, 2)}%)`, value: formatPdfCurrency(taxAmount) },
    { label: "Total", value: formatPdfCurrency(total), emphasis: true },
  ];
  const boxHeight = 10 + rows.length * 7 + 2;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.4);
  doc.setFillColor(...BRAND.white);
  doc.roundedRect(boxX, y, boxWidth, boxHeight, 2, 2, "FD");

  let rowY = y + 7;
  const labelX = boxX + 5;
  const valueX = boxX + boxWidth - 5;
  for (const row of rows) {
    if (row.emphasis) {
      doc.setFillColor(...BRAND.slate100);
      doc.rect(boxX + 0.5, rowY - 4.5, boxWidth - 1, 8, "F");
    }
    setPdfBodyFont(doc, row.emphasis ? "bold" : "normal");
    doc.setFontSize(row.emphasis ? 10 : 8.5);
    doc.setTextColor(...(row.emphasis ? BRAND.slate900 : BRAND.slate600));
    doc.text(row.label, labelX, rowY);
    doc.text(row.value, valueX, rowY, { align: "right" });
    rowY += 7;
  }

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

export async function downloadVoucherInvoicePdf(voucher: Voucher): Promise<void> {
  const doc = await buildVoucherInvoicePdf(voucher);
  doc.save(voucherInvoicePdfFilename(voucher));
}

/* -------------------------------------------------------------------------- */
/*  Payment PDF (voucher-derived payment confirmation / advice)               */
/* -------------------------------------------------------------------------- */

export async function buildVoucherPaymentPdf(voucher: Voucher): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const payment = voucher.payment;
  const paymentNumber = payment?.payment_id ?? "—";
  const status = payment?.status ?? "Paid";

  let y = drawInvoiceHeader(
    doc,
    "Netlink",
    "PAYMENT CONFIRMATION",
    paymentNumber
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Supplier", voucher.supplier_name ?? voucher.supplier ?? "—"],
      ["Invoice Reference", voucher.invoice?.invoice_number ?? "—"],
      ["Voucher Reference", voucher.id ?? "—"],
      ["PO Reference", voucher.po_reference || "—"],
    ],
    [
      ["Payment Date", formatPdfDate(payment?.confirmed_at)],
      ["Payment Method", payment?.payment_method ?? "—"],
      ["Reference Number", payment?.reference_number ?? "—"],
      ["Status", status],
    ]
  );

  y = drawSectionTitle(doc, y, "Financial Summary");

  const boxWidth = 90;
  const boxX = PAGE.width - PAGE.margin - boxWidth;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.4);
  doc.setFillColor(...BRAND.slate100);
  doc.roundedRect(boxX, y, boxWidth, 16, 2, 2, "FD");
  setPdfBodyFont(doc, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.slate600);
  doc.text("Amount Paid", boxX + 5, y + 6);
  setPdfBodyFont(doc, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.success);
  doc.text(
    formatPdfCurrency(payment?.amount ?? voucher.amount ?? 0),
    boxX + boxWidth - 5,
    y + 11,
    { align: "right" }
  );

  y += 24;

  // Finance approval / authorization line.
  setPdfFont(doc, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.slate600);
  doc.text(
    `Payment released by Finance — authorized by ${
      payment?.confirmed_by ?? "—"
    }.`,
    PAGE.margin,
    y
  );
  if (voucher.invoice?.reviewed_by) {
    doc.text(
      `Invoice approved by ${voucher.invoice.reviewed_by}${
        voucher.invoice.reviewed_at
          ? ` on ${formatPdfDate(voucher.invoice.reviewed_at)}`
          : ""
      }.`,
      PAGE.margin,
      y + 5
    );
  }

  // Subtle PAID watermark to match the invoice when settled.
  drawPaidWatermark(doc, { subtitle: "CONFIRMED" });

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

export async function downloadVoucherPaymentPdf(voucher: Voucher): Promise<void> {
  const doc = await buildVoucherPaymentPdf(voucher);
  doc.save(voucherPaymentPdfFilename(voucher));
}
