import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { APP_NAME } from "../../config/branding";
import {
  drawBrandedHeader,
  drawInvoiceFooter,
  formatPdfDate,
  PAGE,
} from "../pdf/common";
import { ensurePdfLogo } from "../pdf/logo";
import {
  buildExportFilename,
  formatExportCell,
} from "./formatters";
import type { ExportColumn, ExportFormat, ExportRequest, ExportResult } from "./types";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildMatrix<T>(
  rows: T[],
  columns: ExportColumn<T>[],
): { headers: string[]; body: string[][] } {
  const headers = columns.map((c) => c.label);
  const body = rows.map((row) =>
    columns.map((c) => formatExportCell(c.accessor(row), c.type ?? "text")),
  );
  return { headers, body };
}

function exportCsv<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
): void {
  const { headers, body } = buildMatrix(rows, columns);
  const lines = [headers, ...body].map((row) =>
    row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
  );
  // BOM helps Excel open UTF-8 CSV correctly
  const csv = `\uFEFF${lines.join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
}

function exportXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
  sheetName: string,
): void {
  const { headers, body } = buildMatrix(rows, columns);
  const aoa = [headers, ...body];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable column widths from header length
  sheet["!cols"] = headers.map((h) => ({
    wch: Math.min(40, Math.max(12, h.length + 4)),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31) || "Export");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}

async function exportPdf<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
  title: string,
): Promise<void> {
  const landscape = columns.length > 6;
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: landscape ? "landscape" : "portrait",
  });
  await ensurePdfLogo();
  let y = drawBrandedHeader(doc, title.toUpperCase(), APP_NAME);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated ${formatPdfDate(new Date().toISOString())} · ${rows.length} record${rows.length === 1 ? "" : "s"}`,
    PAGE.margin,
    y,
  );
  y += 8;

  const { headers, body } = buildMatrix(rows, columns);
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head: [headers],
    body,
    styles: {
      fontSize: landscape ? 7 : 8,
      cellPadding: landscape ? 2 : 2.5,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [0, 152, 234],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  drawInvoiceFooter(doc);
  doc.save(filename);
}

/**
 * Generate and download a list export. Callers pass already-filtered rows.
 */
export async function runListExport<T>(
  request: ExportRequest<T>,
): Promise<ExportResult> {
  const columns = request.columns;
  if (columns.length === 0) {
    throw new Error("Select at least one column to export.");
  }

  const filename = buildExportFilename(request.filenamePrefix, request.format);
  const title = request.title || request.module;
  const rows = request.rows ?? [];

  switch (request.format) {
    case "csv":
      exportCsv(rows, columns, filename);
      break;
    case "xlsx":
      exportXlsx(rows, columns, filename, request.module);
      break;
    case "pdf":
      await exportPdf(rows, columns, filename, title);
      break;
    default:
      throw new Error(`Unsupported export format: ${request.format as string}`);
  }

  return {
    filename,
    format: request.format,
    rowCount: rows.length,
  };
}

export function assertExportFormat(value: string): ExportFormat {
  if (value === "xlsx" || value === "pdf" || value === "csv") return value;
  throw new Error(`Unsupported export format: ${value}`);
}
