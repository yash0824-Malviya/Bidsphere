/** Reusable list-export contracts (presentation + file generation only). */

export type ExportFormat = "xlsx" | "pdf" | "csv";

export type ExportValueType = "text" | "date" | "currency" | "number" | "status";

export interface ExportColumn<T = Record<string, unknown>> {
  /** Stable key used in column picker + row accessors. */
  id: string;
  /** Header label in the export file. */
  label: string;
  /** How to format the cell value. */
  type?: ExportValueType;
  /** Extract raw value from a row. */
  accessor: (row: T) => unknown;
  /** Default selected in the column picker. */
  defaultSelected?: boolean;
}

export interface ExportRequest<T = Record<string, unknown>> {
  /** Human module name, e.g. "Supplier Onboarding". */
  module: string;
  /** Filename stem before date, e.g. "Supplier_Onboarding". */
  filenamePrefix: string;
  format: ExportFormat;
  columns: ExportColumn<T>[];
  /** Already filtered / sorted / date-scoped rows. */
  rows: T[];
  title?: string;
}

export interface ExportResult {
  filename: string;
  format: ExportFormat;
  rowCount: number;
}
