import jsPDF from "jspdf";
import type { jsPDF as JsPDFType } from "jspdf";

import { getPurchaseInvoice } from "../../api/accounts";
import type { PaymentEntry, PaymentEntryReference } from "../../types/erpnext";
import { APP_NAME, COMPANY_NAME } from "../../config/branding";
import { getPaymentModeLabel } from "../usPaymentMethods";
import {
  BRAND,
  drawLogoArea,
  formatPdfCurrency,
  formatPdfDate,
  generationTimestamp,
  sanitizeFilename,
  setPdfFont,
} from "./common";
import { ensurePdfFont, setPdfBodyFont } from "./fonts";
import { ensurePdfLogo } from "./logo";

/* -------------------------------------------------------------------------- */
/*  US Letter layout (215.9 × 279.4 mm)                                       */
/* -------------------------------------------------------------------------- */

const LETTER = {
  margin: 18,
  width: 215.9,
  height: 279.4,
  get contentWidth() {
    return this.width - this.margin * 2;
  },
};

interface PaymentFinancials {
  invoiceRef?: string;
  invoiceAmount: number;
  amountPaid: number;
  remainingBalance: number;
  statusLabel: string;
}

async function resolvePaymentFinancials(
  payment: PaymentEntry
): Promise<PaymentFinancials> {
  const paidAmt = payment.received_amount ?? payment.paid_amount ?? 0;
  const invRef = (payment.references ?? []).find(
    (r) =>
      r.reference_doctype === "Purchase Invoice" && r.reference_name
  ) as PaymentEntryReference | undefined;

  let invoiceAmount = invRef?.total_amount ?? 0;
  let amountPaid = invRef?.allocated_amount ?? paidAmt;
  let remainingBalance =
    invRef?.outstanding_amount ?? Math.max(0, invoiceAmount - amountPaid);

  if (invRef?.reference_name && !invoiceAmount) {
    try {
      const invoice = await getPurchaseInvoice(invRef.reference_name);
      invoiceAmount = invoice.grand_total ?? 0;
      remainingBalance = Math.max(0, invoiceAmount - amountPaid);
    } catch {
      /* use reference row values */
    }
  }

  return {
    invoiceRef: invRef?.reference_name,
    invoiceAmount,
    amountPaid,
    remainingBalance,
    statusLabel: paymentStatusLabel(payment, remainingBalance, amountPaid),
  };
}

function paymentStatusLabel(
  payment: PaymentEntry,
  remaining: number,
  paid: number
): string {
  const docstatus = payment.docstatus ?? 0;
  if (docstatus === 2) return "VOIDED";
  if (docstatus === 0) return "PENDING";
  if (paid > 0 && remaining > 0.01) return "PARTIALLY PAID";
  if (docstatus === 1 || payment.status === "Submitted") return "PAID";
  return (payment.status ?? "PENDING").toUpperCase();
}

function createLetterDocument(): JsPDFType {
  return new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
}

function drawRule(doc: JsPDFType, y: number, accent = false): number {
  const { margin, width } = LETTER;
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.35);
  doc.line(margin, y, width - margin, y);
  if (accent) {
    doc.setFillColor(...BRAND.primary);
    doc.rect(margin, y + 0.3, 48, 0.6, "F");
  }
  return y + (accent ? 8 : 6);
}

function drawSectionHeading(doc: JsPDFType, y: number, title: string): number {
  const { margin } = LETTER;
  setPdfFont(doc, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.primaryDark);
  doc.text(title.toUpperCase(), margin, y);
  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.25);
  doc.line(margin, y + 2, margin + LETTER.contentWidth, y + 2);
  return y + 9;
}

function drawField(
  doc: JsPDFType,
  y: number,
  label: string,
  value: string,
  opts?: { boldValue?: boolean; valueColor?: [number, number, number] }
): number {
  const { margin, contentWidth } = LETTER;
  const labelW = 52;

  setPdfFont(doc, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate500);
  doc.text(label, margin, y);

  setPdfFont(doc, opts?.boldValue ? "bold" : "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...(opts?.valueColor ?? BRAND.slate900));
  const lines = doc.splitTextToSize(value, contentWidth - labelW - 4);
  doc.text(lines, margin + labelW, y);

  return y + Math.max(6, lines.length * 4.8);
}

function drawHeader(doc: JsPDFType, companyName: string): number {
  const { margin, width } = LETTER;
  const top = 16;
  const logoHeight = 16;
  const { widthMm: logoWidth } = drawLogoArea(doc, margin, top, logoHeight);

  const textX = margin + logoWidth + 5;
  setPdfFont(doc, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.slate900);
  doc.text(companyName, textX, top + 5);

  setPdfFont(doc, "normal");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.primaryDark);
  doc.text("Payment Confirmation", textX, top + 11);

  const rightX = width - margin;
  setPdfFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate400);
  doc.text("Accounts Payable", rightX, top + 4, { align: "right" });

  return drawRule(doc, top + logoHeight + 10, true);
}

function drawSummaryStrip(
  doc: JsPDFType,
  y: number,
  payment: PaymentEntry,
  statusLabel: string
): number {
  let rowY = y;
  rowY = drawField(doc, rowY, "Payment Reference:", payment.name ?? "—", {
    boldValue: true,
    valueColor: BRAND.primaryDark,
  });
  rowY = drawField(doc, rowY + 1, "Status:", statusLabel, {
    boldValue: true,
    valueColor:
      statusLabel === "PAID" ? BRAND.success : BRAND.slate900,
  });
  rowY = drawField(
    doc,
    rowY + 1,
    "Payment Date:",
    formatPdfDate(payment.posting_date)
  );
  return drawRule(doc, rowY + 4);
}

function drawNotes(doc: JsPDFType, y: number): number {
  const { margin, contentWidth } = LETTER;
  let rowY = drawSectionHeading(doc, y, "Notes");

  setPdfFont(doc, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate600);
  const body =
    "This document serves as confirmation that payment has been successfully processed.";
  const lines = doc.splitTextToSize(body, contentWidth);
  doc.text(lines, margin, rowY);
  return rowY + lines.length * 4.8 + 8;
}

function drawDocumentFooter(doc: JsPDFType): void {
  const { margin, width, height } = LETTER;
  const y = height - 22;

  doc.setDrawColor(...BRAND.slate200);
  doc.setLineWidth(0.35);
  doc.line(margin, y - 4, width - margin, y - 4);

  setPdfFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  doc.text(`Generated By ${APP_NAME}`, margin, y);
  doc.text(`Generated On: ${generationTimestamp()}`, margin, y + 4.5);

  setPdfFont(doc, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.slate400);
  doc.text("Confidential — For supplier and finance use only", width - margin, y + 4.5, {
    align: "right",
  });
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export function paymentPdfFilename(payment: PaymentEntry): string {
  const name = payment.name ?? "PAYMENT";
  return `Payment_Confirmation_${sanitizeFilename(name)}.pdf`;
}

export async function buildPaymentReceiptPdf(payment: PaymentEntry) {
  const doc = createLetterDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  const fin = await resolvePaymentFinancials(payment);
  const supplier = payment.party_name ?? payment.party ?? "—";
  const companyName = payment.company ?? COMPANY_NAME;

  let y = drawHeader(doc, companyName);
  y = drawSummaryStrip(doc, y, payment, fin.statusLabel);

  y = drawSectionHeading(doc, y, "Supplier Information");
  y = drawField(doc, y, "Supplier Name:", supplier);
  y = drawField(
    doc,
    y + 1,
    "Invoice Reference:",
    fin.invoiceRef ?? "—"
  );
  y = drawRule(doc, y + 6);

  y = drawSectionHeading(doc, y, "Payment Details");
  y = drawField(
    doc,
    y,
    "Payment Method:",
    payment.mode_of_payment ? getPaymentModeLabel(payment.mode_of_payment) : "—"
  );
  y = drawField(
    doc,
    y + 1,
    "Reference Number:",
    payment.reference_no ?? "—"
  );
  y = drawField(
    doc,
    y + 1,
    "Reference Date:",
    formatPdfDate(payment.reference_date)
  );
  y = drawField(
    doc,
    y + 1,
    "Authorized By:",
    payment.owner ?? "—"
  );
  y = drawRule(doc, y + 6);

  y = drawSectionHeading(doc, y, "Financial Summary");
  y = drawField(
    doc,
    y,
    "Invoice Amount:",
    formatPdfCurrency(fin.invoiceAmount)
  );
  y = drawField(
    doc,
    y + 1,
    "Amount Paid:",
    formatPdfCurrency(fin.amountPaid),
    { boldValue: true, valueColor: BRAND.primaryDark }
  );
  y = drawField(
    doc,
    y + 1,
    "Remaining Balance:",
    formatPdfCurrency(fin.remainingBalance),
    {
      boldValue: true,
      valueColor:
        fin.remainingBalance <= 0.01 ? BRAND.success : BRAND.slate900,
    }
  );
  y = drawRule(doc, y + 6);

  drawNotes(doc, y);
  drawDocumentFooter(doc);

  return doc;
}

export async function downloadPaymentReceiptPdf(
  payment: PaymentEntry
): Promise<void> {
  const doc = await buildPaymentReceiptPdf(payment);
  doc.save(paymentPdfFilename(payment));
}

export async function printPaymentReceiptPdf(
  payment: PaymentEntry
): Promise<void> {
  const doc = await buildPaymentReceiptPdf(payment);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
