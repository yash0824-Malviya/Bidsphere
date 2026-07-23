/**
 * Material Issue Receipt PDF — enterprise layout with dual signatures + QR.
 */
import autoTable from "jspdf-autotable";
import type { jsPDF } from "jspdf";
import QRCode from "qrcode";

import type { MaterialIssueReceipt } from "../../types/materialIssueReceipt";
import {
  ACCEPTANCE_CHECKLIST_LABELS,
} from "../../types/materialIssueReceipt";
import { receiptVerificationUrl } from "../../api/materialIssueReceipt";
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
import { splitMaterialIssueRemarksForDisplay } from "../materialIssueRemarksDisplay";

export function materialIssueReceiptPdfFilename(
  receipt: Pick<MaterialIssueReceipt, "issue_number">,
): string {
  return `${sanitizeFilename(receipt.issue_number || "Material-Issue-Receipt")}-Receipt.pdf`;
}

async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 160,
    errorCorrectionLevel: "M",
  });
}

function drawSignatureBlock(
  doc: jsPDF,
  x: number,
  y: number,
  title: string,
  sig?: MaterialIssueReceipt["warehouse_signature"],
): number {
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate900);
  doc.text(title, x, y);
  y += 4;

  if (sig?.signature_data_url && sig.signature_type === "drawn") {
    try {
      doc.addImage(sig.signature_data_url, "PNG", x, y, 50, 18);
      y += 20;
    } catch {
      y += 4;
    }
  } else if (sig?.typed_name || sig?.signer_name) {
    doc.setFontSize(14);
    doc.setTextColor(...BRAND.primaryDark);
    doc.text(sig.typed_name || sig.signer_name, x, y + 8);
    y += 14;
  } else {
    doc.setDrawColor(...BRAND.slate200);
    doc.line(x, y + 12, x + 60, y + 12);
    y += 16;
  }

  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate500);
  const lines = [
    `Signer: ${sig?.signer_name || "—"}`,
    `Date/Time: ${sig?.signed_at || "—"}`,
    `SHA256: ${sig?.sha256_hash ? `${sig.sha256_hash.slice(0, 20)}…` : "—"}`,
    `Status: ${sig?.verification_status || "pending"}`,
  ];
  for (const line of lines) {
    doc.text(line, x, y);
    y += 3.5;
  }
  return y;
}

export async function buildMaterialIssueReceiptPdf(
  receipt: MaterialIssueReceipt,
): Promise<jsPDF> {
  const doc = createDocument();
  await Promise.all([ensurePdfFont(doc), ensurePdfLogo()]);
  setPdfBodyFont(doc);

  let y = drawInvoiceHeader(
    doc,
    "Netlink",
    "MATERIAL ISSUE RECEIPT",
    receipt.issue_number || "—",
  );

  y = drawMetaGrid(
    doc,
    y,
    [
      ["Issue Number", receipt.issue_number || "—"],
      ["Material Request", receipt.mr_name || "—"],
      ["Stock Entry", receipt.stock_entry || "—"],
      ["Department", receipt.department || "—"],
    ],
    [
      ["Warehouse", receipt.warehouse || "—"],
      ["Issue Date", formatPdfDate(receipt.issue_date)],
      ["Issued By", receipt.issued_by || "—"],
      ["Receiver", receipt.received_by || "—"],
      ["Status", receipt.status],
    ],
  );

  y = drawSectionTitle(doc, y, "Items");

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerReserve },
    tableWidth: PAGE.contentWidth,
    head: [["#", "Item", "Requested", "Issued", "Remaining", "UOM"]],
    body:
      receipt.items.length > 0
        ? receipt.items.map((item, idx) => [
            String(idx + 1),
            item.item_name && item.item_name !== item.item_code
              ? `${item.item_code} — ${item.item_name}`
              : item.item_code,
            formatPdfNumber(item.requested_qty, 2),
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

  const remarksDisplay = splitMaterialIssueRemarksForDisplay(receipt.remarks, {
    items: receipt.items,
  });
  if (remarksDisplay.bullets.length) {
    y = drawSectionTitle(doc, y, "Warehouse Remarks");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.slate700);
    for (const bullet of remarksDisplay.bullets) {
      const lines = doc.splitTextToSize(`• ${bullet}`, PAGE.contentWidth);
      doc.text(lines, PAGE.margin, y);
      y += lines.length * 4 + 1;
    }
    y += 4;
  }

  if (receipt.acceptance_checklist) {
    y = drawSectionTitle(doc, y, "Acceptance Checklist");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.slate700);
    for (const key of Object.keys(ACCEPTANCE_CHECKLIST_LABELS) as Array<
      keyof typeof ACCEPTANCE_CHECKLIST_LABELS
    >) {
      const ok = Boolean(receipt.acceptance_checklist[key]);
      doc.text(
        `${ok ? "[x]" : "[ ]"} ${ACCEPTANCE_CHECKLIST_LABELS[key]}`,
        PAGE.margin,
        y,
      );
      y += 4;
    }
    if (receipt.department_remarks) {
      y += 2;
      const dLines = doc.splitTextToSize(
        `Department Remarks: ${receipt.department_remarks}`,
        PAGE.contentWidth,
      );
      doc.text(dLines, PAGE.margin, y);
      y += dLines.length * 4 + 4;
    } else {
      y += 4;
    }
  }

  if (y > 200) {
    doc.addPage();
    y = PAGE.margin;
  }

  y = drawSectionTitle(doc, y, "Digital Signatures");
  const y1 = drawSignatureBlock(
    doc,
    PAGE.margin,
    y,
    "Warehouse Manager",
    receipt.warehouse_signature,
  );
  const y2 = drawSignatureBlock(
    doc,
    PAGE.margin + 95,
    y,
    "Department User",
    receipt.department_signature,
  );
  y = Math.max(y1, y2) + 8;

  y = drawSectionTitle(doc, y, "Audit & Verification");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate700);
  doc.text(`Document Hash: ${receipt.document_hash}`, PAGE.margin, y);
  y += 4;
  doc.text(`Document Version: ${receipt.document_version}`, PAGE.margin, y);
  y += 4;
  doc.text(
    `Verification Token: ${receipt.verification_token}`,
    PAGE.margin,
    y,
  );
  y += 6;

  const verifyUrl = receiptVerificationUrl(receipt);
  try {
    const qr = await qrDataUrl(verifyUrl);
    doc.addImage(qr, "PNG", PAGE.margin + PAGE.contentWidth - 32, y - 4, 28, 28);
  } catch {
    /* QR optional */
  }

  doc.setFontSize(7);
  doc.setTextColor(...BRAND.slate500);
  const urlLines = doc.splitTextToSize(`Scan QR to verify: ${verifyUrl}`, 120);
  doc.text(urlLines, PAGE.margin, y + 8);

  y += 36;
  if (receipt.audit_trail?.length) {
    y = drawSectionTitle(doc, y, "Audit Trail");
    autoTable(doc, {
      startY: y,
      margin: {
        left: PAGE.margin,
        right: PAGE.margin,
        bottom: PAGE.footerReserve,
      },
      tableWidth: PAGE.contentWidth,
      head: [["When", "Action", "By", "Hash"]],
      body: receipt.audit_trail.slice(0, 12).map((a) => [
        a.at,
        a.action,
        a.by,
        a.hash ? `${a.hash.slice(0, 12)}…` : "—",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: {
        fillColor: BRAND.slate700,
        textColor: BRAND.white,
        fontStyle: "bold",
      },
    });
  }

  drawInvoiceFooter(doc);
  addFootersToAllPages(doc);
  return doc;
}

export async function downloadMaterialIssueReceiptPdf(
  receipt: MaterialIssueReceipt,
): Promise<void> {
  const doc = await buildMaterialIssueReceiptPdf(receipt);
  doc.save(materialIssueReceiptPdfFilename(receipt));
}

export async function printMaterialIssueReceiptPdf(
  receipt: MaterialIssueReceipt,
): Promise<void> {
  const doc = await buildMaterialIssueReceiptPdf(receipt);
  const url = doc.output("bloburl");
  const win = window.open(url, "_blank");
  if (!win) doc.save(materialIssueReceiptPdfFilename(receipt));
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
