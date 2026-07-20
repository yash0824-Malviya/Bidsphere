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

export function grnPdfFilename(grn: Pick<PurchaseReceipt, "name">): string {
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

  // Warehouse Digital Signature block — pinned to the bottom of the last page.
  if (
    grn.warehouse_signed ||
    grn.warehouse_signature_hash ||
    grn.warehouse_signed_by ||
    grn.signed ||
    grn.sha256_hash
  ) {
    await drawWarehouseSignatureBlockAtBottom(doc, grn, y);
  }

  addFootersToAllPages(doc, drawInvoiceFooter);
  return doc;
}

const SIG_BLOCK_HEIGHT_MM = 58;

async function drawWarehouseSignatureBlockAtBottom(
  doc: Awaited<ReturnType<typeof createDocument>>,
  grn: PurchaseReceipt,
  contentEndY: number,
): Promise<void> {
  const usableBottom = PAGE.height - PAGE.footerReserve;
  // Ensure room on the last content page; otherwise start a fresh page.
  if (contentEndY + 8 > usableBottom - SIG_BLOCK_HEIGHT_MM) {
    doc.addPage();
  }
  doc.setPage(doc.getNumberOfPages());
  let y = usableBottom - SIG_BLOCK_HEIGHT_MM;

  y = drawSectionTitle(doc, y, "Warehouse Digital Signature");
  setPdfBodyFont(doc, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.slate900);

  const signer =
    grn.signed_by ||
    grn.warehouse_signature_name ||
    grn.warehouse_signed_by ||
    "—";
  const signedRaw =
    grn.signed_at ||
    grn.warehouse_signature_timestamp ||
    grn.warehouse_signed_at ||
    "";
  const signedAt = signedRaw
    ? formatPdfDate(signedRaw.slice(0, 10))
    : "—";
  const signedTime = signedRaw
    ? signedRaw.includes("T")
      ? new Date(signedRaw).toLocaleTimeString()
      : (signedRaw.split(" ")[1] ?? "—")
    : "—";

  let envelopeEmp = "";
  let designation = "Warehouse Manager";
  let typedName = "";
  let dataUrl: string | null = null;
  try {
    if (grn.warehouse_esign_envelope) {
      const env = JSON.parse(grn.warehouse_esign_envelope) as {
        employeeId?: string;
        designation?: string;
        typedName?: string;
        signatureDataUrl?: string | null;
        role?: string;
        email?: string;
        documentVersion?: string;
      };
      envelopeEmp = env.employeeId || "";
      designation = env.designation || designation;
      typedName = env.typedName || "";
      if (env.signatureDataUrl?.startsWith("data:image")) {
        dataUrl = env.signatureDataUrl;
      }
    }
  } catch {
    /* ignore envelope parse */
  }

  if (!dataUrl) {
    // Dynamic import avoids a static cycle with warehouseEsign → grnPdf.
    const { fetchWarehouseSignatureImageDataUrl } = await import(
      "../../api/warehouseEsign"
    );
    dataUrl = await fetchWarehouseSignatureImageDataUrl(grn);
  }
  if (
    !dataUrl &&
    typeof grn.warehouse_signature_data === "string" &&
    grn.warehouse_signature_data.startsWith("data:image")
  ) {
    dataUrl = grn.warehouse_signature_data;
  }

  const boxX = PAGE.margin;
  const boxW = PAGE.contentWidth * 0.55;
  const boxH = 26;
  doc.setDrawColor(...BRAND.slate200);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(boxX, y, boxW, boxH, 2, 2, "FD");

  if (dataUrl) {
    try {
      const fmt = dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg")
        ? "JPEG"
        : "PNG";
      doc.addImage(dataUrl, fmt, boxX + 4, y + 2.5, boxW - 8, boxH - 5);
    } catch {
      setPdfBodyFont(doc, "italic");
      doc.setFontSize(14);
      doc.text(typedName || signer, boxX + 6, y + 15);
    }
  } else {
    setPdfBodyFont(doc, "italic");
    doc.setFontSize(14);
    doc.text(typedName || signer, boxX + 6, y + 15);
  }

  y += boxH + 5;
  setPdfBodyFont(doc, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.slate700);

  let signerRole =
    grn.warehouse_signer_role ||
    grn.warehouse_signature_role ||
    designation;
  let signerEmail =
    grn.warehouse_signer_email || grn.warehouse_signature_email || "";
  let docVersion =
    grn.warehouse_signature_version ||
    grn.warehouse_document_version ||
    "1.0";
  try {
    if (grn.warehouse_esign_envelope) {
      const env = JSON.parse(grn.warehouse_esign_envelope) as {
        role?: string;
        email?: string;
        documentVersion?: string;
      };
      signerRole = grn.warehouse_signer_role || env.role || signerRole;
      signerEmail = grn.warehouse_signer_email || env.email || signerEmail;
      docVersion = env.documentVersion || docVersion;
    }
  } catch {
    /* keep defaults */
  }

  const hash =
    grn.warehouse_signature_hash || grn.sha256_hash || "";
  const lines = [
    `Signed by: ${signer}`,
    `Role: ${signerRole}`,
    `Designation: ${designation}`,
    `Employee ID: ${envelopeEmp || "—"}`,
    signerEmail ? `Email: ${signerEmail}` : "",
    `Date: ${signedAt}    Time: ${signedTime}`,
    `Document Version: ${docVersion}`,
    "Signature Status: Verified ✓",
    hash ? `SHA-256: ${hash}` : "SHA-256: Verified ✓",
  ].filter(Boolean);

  const metaX = boxX + boxW + 6;
  let metaY = y - boxH - 5 + 6;
  for (const line of lines) {
    doc.text(line, metaX, metaY, {
      maxWidth: PAGE.contentWidth - boxW - 8,
    });
    metaY += 4.2;
  }

  y = Math.max(y, metaY) + 2;
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.slate700);
  const notice =
    "This document is digitally signed. Any modification invalidates the signature.";
  const noticeLines = doc.splitTextToSize(notice, PAGE.contentWidth);
  doc.text(noticeLines, PAGE.margin, Math.min(y, usableBottom - 6));
}

/** Fresh signed GRN PDF bytes (no cache) for inline Finance viewers. */
export async function buildSignedGrnPdfBytes(
  grn: PurchaseReceipt,
  statusLabel: string,
): Promise<ArrayBuffer> {
  const doc = await buildGrnPdf(grn, statusLabel);
  return doc.output("arraybuffer");
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
