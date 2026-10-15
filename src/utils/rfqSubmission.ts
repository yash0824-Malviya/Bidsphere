/** Frappe's persisted docstatus is authoritative; display/status labels are not submission evidence. */
export function isSubmittedRfq(record?: Record<string, unknown>): boolean {
  return Number(record?.docstatus) === 1;
}
