export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export function toggleSortDirection(
  current: SortState,
  key: string
): SortState {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return { key, direction: "desc" };
}

function compareStrings(
  a: string,
  b: string,
  direction: SortDirection
): number {
  const result = a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return direction === "desc" ? -result : result;
}

function compareDates(
  a?: string | null,
  b?: string | null,
  direction: SortDirection = "desc"
): number {
  const ta = a ? Date.parse(a.length === 10 ? `${a}T00:00:00` : a) : 0;
  const tb = b ? Date.parse(b.length === 10 ? `${b}T00:00:00` : b) : 0;
  const safeA = Number.isNaN(ta) ? 0 : ta;
  const safeB = Number.isNaN(tb) ? 0 : tb;
  return direction === "desc" ? safeB - safeA : safeA - safeB;
}

function compareNumbers(
  a: number,
  b: number,
  direction: SortDirection
): number {
  return direction === "desc" ? b - a : a - b;
}

/** Default newest-first ordering used across transactional lists. */
export function sortNewestFirst<T>(
  rows: T[],
  pickers: {
    date: (row: T) => string | undefined | null;
    creation?: (row: T) => string | undefined | null;
    name: (row: T) => string;
  }
): T[] {
  return [...rows].sort((a, b) => {
    const byDate = compareDates(pickers.date(a), pickers.date(b), "desc");
    if (byDate !== 0) return byDate;

    if (pickers.creation) {
      const byCreation = compareDates(
        pickers.creation(a),
        pickers.creation(b),
        "desc"
      );
      if (byCreation !== 0) return byCreation;
    }

    return compareStrings(pickers.name(a), pickers.name(b), "desc");
  });
}

export function sortRows<T>(
  rows: T[],
  sort: SortState,
  comparators: Record<
    string,
    (a: T, b: T, direction: SortDirection) => number
  >
): T[] {
  const compare = comparators[sort.key];
  if (!compare) return rows;
  return [...rows].sort((a, b) => compare(a, b, sort.direction));
}

export function purchaseOrderComparators<
  T extends {
    name: string;
    transaction_date?: string;
    creation?: string;
    supplier_name?: string;
    supplier?: string;
    status?: string;
    grand_total?: number;
    per_received?: number;
    per_billed?: number;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    supplier: (a: T, b: T, direction: SortDirection) =>
      compareStrings(
        a.supplier_name ?? a.supplier ?? "",
        b.supplier_name ?? b.supplier ?? "",
        direction
      ),
    date: (a: T, b: T, direction: SortDirection) => {
      const primary = compareDates(
        a.transaction_date,
        b.transaction_date,
        direction
      );
      if (primary !== 0) return primary;
      const secondary = compareDates(a.creation, b.creation, direction);
      if (secondary !== 0) return secondary;
      return compareStrings(a.name, b.name, direction);
    },
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
    total: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.grand_total ?? 0, b.grand_total ?? 0, direction),
    received: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.per_received ?? 0, b.per_received ?? 0, direction),
    billed: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.per_billed ?? 0, b.per_billed ?? 0, direction),
  };
}

export function rfqComparators<
  T extends {
    name: string;
    modified?: string;
    owner?: string;
    quote_count?: number;
    display_status?: string;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    modified: (a: T, b: T, direction: SortDirection) =>
      compareDates(a.modified, b.modified, direction),
    owner: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.owner ?? "", b.owner ?? "", direction),
    quotes: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.quote_count ?? 0, b.quote_count ?? 0, direction),
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.display_status ?? "", b.display_status ?? "", direction),
  };
}

export function grnComparators<
  T extends {
    name: string;
    posting_date?: string;
    creation?: string;
    supplier_name?: string;
    supplier?: string;
    status?: string;
    grand_total?: number;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    supplier: (a: T, b: T, direction: SortDirection) =>
      compareStrings(
        a.supplier_name ?? a.supplier ?? "",
        b.supplier_name ?? b.supplier ?? "",
        direction
      ),
    date: (a: T, b: T, direction: SortDirection) => {
      const primary = compareDates(a.posting_date, b.posting_date, direction);
      if (primary !== 0) return primary;
      const secondary = compareDates(a.creation, b.creation, direction);
      if (secondary !== 0) return secondary;
      return compareStrings(a.name, b.name, direction);
    },
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
    total: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.grand_total ?? 0, b.grand_total ?? 0, direction),
  };
}

export function invoiceComparators<
  T extends {
    name: string;
    posting_date?: string;
    creation?: string;
    due_date?: string;
    supplier_name?: string;
    supplier?: string;
    status?: string;
    grand_total?: number;
    outstanding_amount?: number;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    supplier: (a: T, b: T, direction: SortDirection) =>
      compareStrings(
        a.supplier_name ?? a.supplier ?? "",
        b.supplier_name ?? b.supplier ?? "",
        direction
      ),
    date: (a: T, b: T, direction: SortDirection) => {
      const primary = compareDates(a.posting_date, b.posting_date, direction);
      if (primary !== 0) return primary;
      const secondary = compareDates(a.creation, b.creation, direction);
      if (secondary !== 0) return secondary;
      return compareStrings(a.name, b.name, direction);
    },
    due: (a: T, b: T, direction: SortDirection) =>
      compareDates(a.due_date, b.due_date, direction),
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
    total: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.grand_total ?? 0, b.grand_total ?? 0, direction),
    outstanding: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(
        a.outstanding_amount ?? 0,
        b.outstanding_amount ?? 0,
        direction
      ),
  };
}

export function paymentComparators<
  T extends {
    name: string;
    posting_date?: string;
    creation?: string;
    party_name?: string;
    party?: string;
    mode_of_payment?: string;
    paid_amount?: number;
    received_amount?: number;
    status?: string;
  }
>() {
  const amount = (row: T) => row.received_amount ?? row.paid_amount ?? 0;

  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    supplier: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.party_name ?? a.party ?? "", b.party_name ?? b.party ?? "", direction),
    date: (a: T, b: T, direction: SortDirection) => {
      const primary = compareDates(a.posting_date, b.posting_date, direction);
      if (primary !== 0) return primary;
      const secondary = compareDates(a.creation, b.creation, direction);
      if (secondary !== 0) return secondary;
      return compareStrings(a.name, b.name, direction);
    },
    method: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.mode_of_payment ?? "", b.mode_of_payment ?? "", direction),
    amount: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(amount(a), amount(b), direction),
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
  };
}

export function supplierQuotationComparators<
  T extends {
    name: string;
    transaction_date?: string;
    creation?: string;
    modified?: string;
    grand_total?: number;
    total?: number;
    status?: string;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.name, b.name, direction),
    date: (a: T, b: T, direction: SortDirection) => {
      const primary = compareDates(
        a.transaction_date ?? a.modified,
        b.transaction_date ?? b.modified,
        direction
      );
      if (primary !== 0) return primary;
      const secondary = compareDates(a.creation, b.creation, direction);
      if (secondary !== 0) return secondary;
      return compareStrings(a.name, b.name, direction);
    },
    total: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.grand_total ?? a.total ?? 0, b.grand_total ?? b.total ?? 0, direction),
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
  };
}

export function rfqTemplateComparators<
  T extends {
    name: string;
    template_name?: string;
    category?: string;
    modified?: string;
    status?: string;
    estimated_value?: number;
    usage_count?: number;
    last_used_at?: string;
  }
>() {
  return {
    name: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.template_name ?? a.name, b.template_name ?? b.name, direction),
    category: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.category ?? "", b.category ?? "", direction),
    estimated_value: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.estimated_value ?? 0, b.estimated_value ?? 0, direction),
    usage_count: (a: T, b: T, direction: SortDirection) =>
      compareNumbers(a.usage_count ?? 0, b.usage_count ?? 0, direction),
    last_used_at: (a: T, b: T, direction: SortDirection) =>
      compareDates(a.last_used_at, b.last_used_at, direction),
    modified: (a: T, b: T, direction: SortDirection) =>
      compareDates(a.modified, b.modified, direction),
    status: (a: T, b: T, direction: SortDirection) =>
      compareStrings(a.status ?? "", b.status ?? "", direction),
  };
}

export const TEMPLATE_DEFAULT_SORT: SortState = { key: "modified", direction: "desc" };
export const PO_DEFAULT_SORT: SortState = { key: "date", direction: "desc" };
export const RFQ_DEFAULT_SORT: SortState = { key: "modified", direction: "desc" };
export const GRN_DEFAULT_SORT: SortState = { key: "date", direction: "desc" };
export const INVOICE_DEFAULT_SORT: SortState = { key: "date", direction: "desc" };
export const PAYMENT_DEFAULT_SORT: SortState = { key: "date", direction: "desc" };
export const SQ_DEFAULT_SORT: SortState = { key: "date", direction: "desc" };
