import autoTable from "jspdf-autotable";
import type { PaymentEntry } from "../types/erpnext";
import {
  createDocument,
  drawBrandedHeader,
  drawInvoiceFooter,
  formatPdfDate,
  formatPdfCurrency,
  PAGE,
  sanitizeFilename,
} from "./pdf/common";
import {
  mapPaymentUiStatus,
  paymentAmount,
} from "./paymentUtils";
import { APP_NAME } from "../config/branding";
import { ensurePdfLogo } from "./pdf/logo";
import { getPaymentModeLabel } from "./usPaymentMethods";

export function exportPaymentsCsv(rows: PaymentEntry[]): void {
  const headers = [
    "Payment Number",
    "Supplier",
    "Date",
    "Payment Method",
    "Reference",
    "Status",
    "Amount",
  ];
  const lines = rows.map((p) => [
    p.name ?? "",
    p.party_name ?? p.party ?? "",
    p.posting_date ?? "",
    getPaymentModeLabel(p.mode_of_payment) || "",
    p.reference_no ?? "",
    mapPaymentUiStatus(p),
    String(paymentAmount(p)),
  ]);
  const csv = [headers, ...lines]
    .map((row) =>
      row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Payments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportPaymentsPdf(rows: PaymentEntry[]): Promise<void> {
  const doc = createDocument();
  await ensurePdfLogo();
  let y = drawBrandedHeader(doc, "PAYMENTS REPORT", APP_NAME);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Generated ${formatPdfDate(new Date().toISOString())}`, PAGE.margin, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head: [
      [
        "Payment #",
        "Supplier",
        "Date",
        "Method",
        "Status",
        "Amount",
      ],
    ],
    body: rows.map((p) => [
      p.name ?? "—",
      p.party_name ?? p.party ?? "—",
      formatPdfDate(p.posting_date),
      p.mode_of_payment ? getPaymentModeLabel(p.mode_of_payment) : "—",
      mapPaymentUiStatus(p),
      formatPdfCurrency(paymentAmount(p)),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  drawInvoiceFooter(doc);
  doc.save(`Payments_Report_${sanitizeFilename(new Date().toISOString().slice(0, 10))}.pdf`);
}
