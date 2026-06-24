import type { PaymentEntry } from "../types/erpnext";
import { DEFAULT_CURRENCY, formatCurrencyCompact } from "./format";
import {
  mapUsPaymentUiStatus,
  US_PAYMENT_STATUS_OPTIONS,
  type UsPaymentUiStatus,
} from "./usPaymentMethods";

export type PaymentUiStatus = UsPaymentUiStatus;

export const PAYMENT_STATUS_OPTIONS = US_PAYMENT_STATUS_OPTIONS;

export function paymentAmount(p: PaymentEntry): number {
  return p.received_amount ?? p.paid_amount ?? 0;
}

export function paymentCurrency(p: PaymentEntry): string {
  return (
    p.paid_to_account_currency ??
    p.paid_from_account_currency ??
    DEFAULT_CURRENCY
  );
}

export function mapPaymentUiStatus(p: PaymentEntry): PaymentUiStatus {
  return mapUsPaymentUiStatus(p);
}

export { formatCurrencyCompact };

export function filterPayments(
  rows: PaymentEntry[],
  opts: {
    search: string;
    status: "" | PaymentUiStatus;
    method: string;
    dateFrom: string;
    dateTo: string;
  }
): PaymentEntry[] {
  return rows.filter((p) => {
    if (opts.search) {
      const q = opts.search.toLowerCase();
      const hay = [
        p.name,
        p.party_name,
        p.party,
        p.reference_no,
        p.mode_of_payment,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (opts.status && mapPaymentUiStatus(p) !== opts.status) return false;

    if (opts.method && opts.method !== "All") {
      const mode = (p.mode_of_payment ?? "").toLowerCase();
      const want = opts.method.toLowerCase();
      if (mode !== want && !mode.includes(want.split(" ")[0] ?? "")) {
        return false;
      }
    }

    if (opts.dateFrom && (p.posting_date ?? "") < opts.dateFrom) return false;
    if (opts.dateTo && (p.posting_date ?? "") > opts.dateTo) return false;

    return true;
  });
}

export function computePaymentKpis(rows: PaymentEntry[]) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let total = 0;
  let monthTotal = 0;
  let pending = 0;
  const paidSuppliers = new Set<string>();

  for (const p of rows) {
    const amt = paymentAmount(p);
    const status = mapPaymentUiStatus(p);
    total += amt;
    if ((p.posting_date ?? "").startsWith(monthKey)) monthTotal += amt;
    if (status === "Pending" || status === "Scheduled") pending += amt;
    if ((status === "Paid" || status === "Partial") && p.party) {
      paidSuppliers.add(p.party);
    }
  }

  return {
    total,
    monthTotal,
    pending,
    activeSuppliers: paidSuppliers.size,
  };
}

export function monthlyPaymentTrend(rows: PaymentEntry[], months = 6) {
  const buckets = new Map<string, number>();
  const labels: string[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short" });
    buckets.set(key, 0);
    labels.push(label);
  }

  const keys = [...buckets.keys()];
  for (const p of rows) {
    const date = p.posting_date ?? "";
    const key = date.slice(0, 7);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + paymentAmount(p));
    }
  }

  return keys.map((key, i) => ({
    key,
    label: labels[i] ?? key,
    amount: buckets.get(key) ?? 0,
  }));
}

export function topSuppliersByPayment(
  rows: PaymentEntry[],
  limit = 5
): Array<{ name: string; total: number }> {
  const map = new Map<string, number>();
  for (const p of rows) {
    const status = mapPaymentUiStatus(p);
    if (status !== "Paid" && status !== "Partial") continue;
    const name = p.party_name ?? p.party ?? "Unknown";
    map.set(name, (map.get(name) ?? 0) + paymentAmount(p));
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function recentLargePayments(
  rows: PaymentEntry[],
  limit = 5
): PaymentEntry[] {
  return [...rows]
    .sort((a, b) => paymentAmount(b) - paymentAmount(a))
    .slice(0, limit);
}
