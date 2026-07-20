import { DEFAULT_CURRENCY } from "../format";
import type { ExportValueType } from "./types";

/** Empty / nullish → blank for spreadsheet / PDF cells. */
export function formatEmpty(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "undefined") {
    return "";
  }
  return s;
}

/** Prefer ISO YYYY-MM-DD for dates; keep readable datetime when time present. */
export function formatExportDate(value: unknown): string {
  const raw = formatEmpty(value);
  if (!raw) return "";
  // Already ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw.includes("T") || raw.includes(" ") ? raw : `${raw}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return raw;
  const hasTime = /T|\d{2}:\d{2}/.test(raw);
  if (!hasTime) {
    return d.toISOString().slice(0, 10);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatExportCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return formatEmpty(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatExportNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return formatEmpty(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(n);
}

/** Status badges → plain text labels. */
export function formatExportStatus(value: unknown): string {
  const raw = formatEmpty(value);
  if (!raw) return "";
  // Strip common badge noise
  return raw.replace(/\s+/g, " ").trim();
}

export function formatExportCell(
  value: unknown,
  type: ExportValueType = "text",
): string {
  switch (type) {
    case "date":
      return formatExportDate(value);
    case "currency":
      return formatExportCurrency(value);
    case "number":
      return formatExportNumber(value);
    case "status":
      return formatExportStatus(value);
    default:
      return formatEmpty(value);
  }
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Safe filename stem: alphanumeric + underscore. */
export function sanitizeExportFilename(prefix: string): string {
  return (
    prefix
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "Export"
  );
}

export function buildExportFilename(
  prefix: string,
  format: "xlsx" | "pdf" | "csv",
): string {
  const stem = sanitizeExportFilename(prefix);
  const date = todayIsoDate();
  return `${stem}_${date}.${format}`;
}
