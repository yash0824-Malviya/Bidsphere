import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export const ERP_NEXT_DATE_FORMAT = "YYYY-MM-DD";
export const US_DISPLAY_DATE_FORMAT = "MM/DD/YYYY";
export const UK_DISPLAY_DATE_FORMAT = "DD/MM/YYYY";
export const ERP_NEXT_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GRN_POSTING_DATE_PO_ERROR =
  "Posting Date must be on or after Purchase Order Date.";

type SeparatedDateParts = {
  first: number;
  second: number;
  year: number;
};

function parseSeparatedDateParts(raw: string): SeparatedDateParts | null {
  const match = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  return {
    first: Number(match[1]),
    second: Number(match[2]),
    year: Number(match[3]),
  };
}

function parseSeparatedDate(raw: string): dayjs.Dayjs | null {
  const parts = parseSeparatedDateParts(raw);
  if (!parts) return null;

  const { first, second } = parts;
  let format: "DD-MM-YYYY" | "MM-DD-YYYY" | null = null;

  if (first > 12) {
    format = "DD-MM-YYYY";
  } else if (second > 12) {
    format = "MM-DD-YYYY";
  } else if (first > second) {
    format = "DD-MM-YYYY";
  } else if (first < second) {
    format = "MM-DD-YYYY";
  }

  if (!format) return null;

  const parsed = dayjs(raw, format, true);
  if (!parsed.isValid()) return null;

  return dayjs(parsed.format(ERP_NEXT_DATE_FORMAT), ERP_NEXT_DATE_FORMAT, true);
}

/**
 * Parse ERPNext / user date input into a local calendar dayjs instance.
 * Accepts YYYY-MM-DD (API), MM/DD/YYYY (UI), and legacy dashed formats.
 */
export function parseERPNextDateInput(
  value: string | Date | null | undefined
): dayjs.Dayjs | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.startOf("day") : null;
  }

  const raw = value.trim();

  if (ERP_NEXT_ISO_DATE_RE.test(raw)) {
    const parsed = dayjs(raw, ERP_NEXT_DATE_FORMAT, true);
    return parsed.isValid() ? parsed.startOf("day") : null;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const parsed = dayjs(raw, US_DISPLAY_DATE_FORMAT, true);
    return parsed.isValid() ? parsed.startOf("day") : null;
  }

  const separated = parseSeparatedDate(raw);
  return separated?.isValid() ? separated.startOf("day") : null;
}

/** Format any supported date input as YYYY-MM-DD for ERPNext API payloads. */
export function formatERPNextDate(
  value: string | Date | null | undefined
): string | null {
  const parsed =
    value instanceof Date
      ? dayjs(value).startOf("day")
      : parseERPNextDateInput(value);

  if (!parsed?.isValid()) return null;
  return parsed.format(ERP_NEXT_DATE_FORMAT);
}

/** Format ISO / API date for US display (MM/DD/YYYY). */
export function formatUsDisplayDate(
  value: string | Date | null | undefined
): string {
  const parsed = parseERPNextDateInput(value);
  return parsed?.isValid() ? parsed.format(US_DISPLAY_DATE_FORMAT) : "";
}

/** Format ISO / API date for UK/EU display (DD/MM/YYYY). */
export function formatUkDisplayDate(
  value: string | Date | null | undefined
): string {
  const parsed = parseERPNextDateInput(value);
  return parsed?.isValid() ? parsed.format(UK_DISPLAY_DATE_FORMAT) : "";
}

/** Parse US display input (MM/DD/YYYY) to ISO (YYYY-MM-DD). */
export function parseUsDisplayDate(value: string): string | null {
  return formatERPNextDate(value);
}

/** Ensure a value is YYYY-MM-DD before sending to ERPNext. Throws if invalid. */
export function assertERPNextDate(
  value: string | Date | null | undefined,
  fieldName: string
): string {
  const formatted = formatERPNextDate(value);
  if (!formatted || !ERP_NEXT_ISO_DATE_RE.test(formatted)) {
    throw new Error(
      `${fieldName} must be a valid date in YYYY-MM-DD format for ERPNext.`
    );
  }
  return formatted;
}

/** Compare two dates by local calendar day. */
export function compareERPNextDates(
  a: string | Date,
  b: string | Date
): number {
  const left = parseERPNextDateInput(a);
  const right = parseERPNextDateInput(b);
  if (!left?.isValid() || !right?.isValid()) {
    // Fallback: compare as YYYY-MM-DD strings when dayjs parsing fails
    const aStr = typeof a === "string" ? a : "";
    const bStr = typeof b === "string" ? b : "";
    if (ERP_NEXT_ISO_DATE_RE.test(aStr) && ERP_NEXT_ISO_DATE_RE.test(bStr)) {
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    }
    return 0;
  }
  // Compare using day-level integers to avoid timezone issues
  const leftDay = left.year() * 10000 + (left.month() + 1) * 100 + left.date();
  const rightDay = right.year() * 10000 + (right.month() + 1) * 100 + right.date();
  return leftDay - rightDay;
}

export function isERPNextDateBefore(
  a: string | Date,
  b: string | Date
): boolean {
  return compareERPNextDates(a, b) < 0;
}

/**
 * Default GRN posting date: clamp(poDate, serverToday).
 *
 * Returns max(poDate, browserToday) capped at serverToday so the date
 * is always >= PO date AND <= the ERPNext server's date (which may
 * differ from the browser's clock due to timezone / clock skew).
 *
 * When poDate > serverToday no valid date exists — returns serverToday
 * so the form renders, and the page shows a warning to the user.
 */
export function resolveGrnPostingDate(
  poTransactionDate: string | null | undefined,
  serverToday?: string | null,
  browserTodayOverride?: string | Date
): string {
  const browserToday = formatERPNextDate(browserTodayOverride ?? new Date());
  const poIso = poTransactionDate
    ? formatERPNextDate(poTransactionDate)
    : null;
  const serverIso = serverToday ? formatERPNextDate(serverToday) : null;

  const effectiveToday = serverIso ?? browserToday;
  if (!effectiveToday) return poIso ?? "";
  if (!poIso) return effectiveToday;

  // Ideal: max(poDate, effectiveToday). But never exceed server's today.
  const ideal = compareERPNextDates(poIso, effectiveToday) > 0 ? poIso : effectiveToday;
  if (serverIso && compareERPNextDates(ideal, serverIso) > 0) return serverIso;
  return ideal;
}

export function todayERPNextDate(): string {
  return formatERPNextDate(new Date()) ?? "";
}

export function erpNextDateOffset(days: number): string {
  return dayjs().add(days, "day").format(ERP_NEXT_DATE_FORMAT);
}

/** PO transaction_date — always today's local calendar date as YYYY-MM-DD. */
export function resolvePoTransactionDate(): string {
  return todayERPNextDate();
}

/**
 * PO line schedule_date — prefer RFQ item schedule when it is valid ISO and
 * not before the PO transaction date; otherwise use PO transaction date.
 */
export function resolvePoItemScheduleDate(
  rfqItemScheduleDate: string | undefined,
  poTransactionDate: string
): string {
  const itemIso = rfqItemScheduleDate
    ? formatERPNextDate(rfqItemScheduleDate)
    : null;
  if (
    itemIso &&
    compareERPNextDates(itemIso, poTransactionDate) >= 0
  ) {
    return itemIso;
  }
  return poTransactionDate;
}

/** Header schedule_date — latest item schedule, or PO transaction date. */
export function resolvePoHeaderScheduleDate(
  itemScheduleDates: string[],
  poTransactionDate: string
): string {
  if (itemScheduleDates.length === 0) return poTransactionDate;
  return itemScheduleDates.reduce((latest, current) =>
    compareERPNextDates(current, latest) > 0 ? current : latest
  );
}

/** Audit log for RFQ → PO date mapping. */
export function logRfqToPoDateContext(input: {
  rfqName: string;
  rfqTransactionDateRaw?: string;
  rfqTransactionDateIso?: string | null;
  rfqValidTillIso?: string | null;
  sqName?: string;
  sqTransactionDateRaw?: string;
  sqTransactionDateIso?: string | null;
  poTransactionDateIso: string;
  poScheduleDateIso: string;
  payload: {
    transaction_date?: string;
    schedule_date?: string;
    items?: Array<{ schedule_date?: string }>;
  };
  erpNextStored?: {
    transaction_date?: string;
    schedule_date?: string;
  };
}): void {
  const payloadTxn = input.payload.transaction_date ?? "";
  const storedTxn = input.erpNextStored?.transaction_date ?? "";

  // eslint-disable-next-line no-console
  console.group("[RFQ → PO] Date audit");
  // eslint-disable-next-line no-console
  console.log("RFQ name:", input.rfqName);
  // eslint-disable-next-line no-console
  console.log("RFQ date (raw):", input.rfqTransactionDateRaw);
  // eslint-disable-next-line no-console
  console.log("RFQ date (ISO):", input.rfqTransactionDateIso);
  // eslint-disable-next-line no-console
  console.log("RFQ Valid Till (ISO):", input.rfqValidTillIso);
  // eslint-disable-next-line no-console
  console.log("Supplier Quotation:", input.sqName);
  // eslint-disable-next-line no-console
  console.log("SQ transaction_date (raw):", input.sqTransactionDateRaw);
  // eslint-disable-next-line no-console
  console.log("SQ transaction_date (ISO):", input.sqTransactionDateIso);
  // eslint-disable-next-line no-console
  console.log("PO transaction_date (sent ISO):", payloadTxn);
  // eslint-disable-next-line no-console
  console.log("PO transaction_date (US display):", formatUsDisplayDate(payloadTxn));
  // eslint-disable-next-line no-console
  console.log("PO schedule_date (sent ISO):", input.payload.schedule_date);
  // eslint-disable-next-line no-console
  console.log("PO item schedule_dates:", input.payload.items?.map((i) => i.schedule_date));
  // eslint-disable-next-line no-console
  console.log("Final API Payload", input.payload);
  if (input.erpNextStored) {
    // eslint-disable-next-line no-console
    console.log("ERPNext stored transaction_date:", storedTxn);
    // eslint-disable-next-line no-console
    console.log("ERPNext stored (US display):", formatUsDisplayDate(storedTxn));
    // eslint-disable-next-line no-console
    console.log(
      "Sent vs stored match:",
      formatERPNextDate(storedTxn) === payloadTxn
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

/**
 * Build a Purchase Receipt payload with ISO dates only.
 *
 * CRITICAL: `set_posting_time: 1` is required to make ERPNext honour
 * the `posting_date` we send.  Without it ERPNext silently replaces
 * the date with the server's `nowdate()`, which may differ due to
 * timezone and cause a spurious "before Purchase Order date" error.
 */
export function buildGrnPayload<
  T extends { posting_date?: string; set_posting_time?: 0 | 1 }
>(data: T): T & { set_posting_time: 1 } {
  const payload = { ...data, set_posting_time: 1 as const };
  if (payload.posting_date) {
    payload.posting_date = assertERPNextDate(
      payload.posting_date,
      "posting_date"
    );
  }
  return payload;
}

/** Normalize Purchase Order payload dates to YYYY-MM-DD. */
export function buildPurchaseOrderPayload<
  T extends {
    transaction_date?: string;
    schedule_date?: string;
    items?: Array<{ schedule_date?: string }>;
  },
>(data: T): T {
  const payload = { ...data };

  if (payload.transaction_date) {
    payload.transaction_date = assertERPNextDate(
      payload.transaction_date,
      "transaction_date"
    );
  }
  if (payload.schedule_date) {
    payload.schedule_date = assertERPNextDate(
      payload.schedule_date,
      "schedule_date"
    );
  }
  if (payload.items) {
    payload.items = payload.items.map((item) => ({
      ...item,
      ...(item.schedule_date
        ? {
            schedule_date: assertERPNextDate(
              item.schedule_date,
              "schedule_date"
            ),
          }
        : {}),
    }));
  }

  return payload;
}

/** Normalize Payment Entry payload dates to YYYY-MM-DD. */
export function buildPaymentEntryPayload<
  T extends { posting_date?: string; reference_date?: string },
>(data: T): T {
  const payload = { ...data };
  if (payload.posting_date) {
    payload.posting_date = assertERPNextDate(
      payload.posting_date,
      "posting_date"
    );
  }
  if (payload.reference_date) {
    payload.reference_date = assertERPNextDate(
      payload.reference_date,
      "reference_date"
    );
  }
  return payload;
}

/** Normalize Purchase Invoice payload dates to YYYY-MM-DD. */
export function buildPurchaseInvoicePayload<
  T extends { posting_date?: string; bill_date?: string; due_date?: string },
>(data: T): T {
  const payload = { ...data };
  if (payload.posting_date) {
    payload.posting_date = assertERPNextDate(
      payload.posting_date,
      "posting_date"
    );
  }
  if (payload.bill_date) {
    payload.bill_date = assertERPNextDate(payload.bill_date, "bill_date");
  }
  if (payload.due_date) {
    payload.due_date = assertERPNextDate(payload.due_date, "due_date");
  }
  return payload;
}

export function logGrnSubmitContext(input: {
  poDateRaw?: string;
  poDateIso?: string | null;
  postingDateIso: string;
  postingDateDisplay: string;
  formState: Record<string, unknown>;
  payload: { posting_date?: string; [key: string]: unknown };
}): void {
  const payloadIso = input.payload.posting_date ?? "";
  const displayFromPayload = formatUsDisplayDate(payloadIso);
  const matches =
    payloadIso === input.postingDateIso &&
    displayFromPayload === input.postingDateDisplay;

  // eslint-disable-next-line no-console
  console.group("[GRN Submit] Date audit");
  // eslint-disable-next-line no-console
  console.log("1. Form state", input.formState);
  // eslint-disable-next-line no-console
  console.log("2. PO Date (raw from ERPNext):", input.poDateRaw);
  // eslint-disable-next-line no-console
  console.log("3. PO Date (ISO parsed):", input.poDateIso);
  // eslint-disable-next-line no-console
  console.log("4. Posting Date (React ISO state):", input.postingDateIso);
  // eslint-disable-next-line no-console
  console.log("5. Posting Date (picker display):", input.postingDateDisplay);
  // eslint-disable-next-line no-console
  console.log("6. Payload posting_date (ISO):", payloadIso);
  // eslint-disable-next-line no-console
  console.log("7. Display vs payload match:", matches, {
    display: input.postingDateDisplay,
    payloadDisplay: displayFromPayload,
    payloadIso,
  });
  // eslint-disable-next-line no-console
  console.log("8. Final API Payload", input.payload);
  // eslint-disable-next-line no-console
  console.groupEnd();

  if (!matches) {
    // eslint-disable-next-line no-console
    console.warn(
      "[GRN Submit] MISMATCH: UI display does not match payload posting_date"
    );
  }
}
