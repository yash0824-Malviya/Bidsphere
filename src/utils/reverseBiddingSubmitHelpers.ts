/** ERPNext optimistic-concurrency / timestamp mismatch errors. */
export function isTimestampConflictError(err: unknown): boolean {
  const msg = extractErrorMessage(err);
  return /timestampmismatch|has been modified|modified after|changed since you|document has been modified/i.test(
    msg,
  );
}

export function isRetryableSaveError(err: unknown): boolean {
  if (isTimestampConflictError(err)) return true;
  const msg = extractErrorMessage(err).toLowerCase();
  if (/timeout|etimedout|econnreset|502|503|504|deadlock|lock wait/i.test(msg)) {
    return true;
  }
  const status =
    err instanceof Error && "status" in err
      ? Number((err as { status?: number }).status)
      : NaN;
  return status === 409 || status === 502 || status === 503 || status === 504;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err ?? "");
}

/** Initial attempt + one automatic retry on transient failure. */
export const REVERSE_BID_MAX_SAVE_ATTEMPTS = 2;

export type ClientBidSnapshot = {
  totalLowest?: number;
  lowestByItem?: Record<string, number>;
};
