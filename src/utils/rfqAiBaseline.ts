export interface RfqAiBaseline {
  invitedSupplierIds: string[];
  quotedSupplierIds: string[];
  savedAt: string;
}

export type RfqAiStaleSource = "invite" | "quotation";

export interface RfqAiStaleState {
  stale: boolean;
  reason?: string;
  source?: RfqAiStaleSource;
  markedAt?: string;
}

const baselineKey = (rfqName: string) => `rfq_ai_baseline_${rfqName}`;
const staleKey = (rfqName: string) => `rfq_ai_stale_${rfqName}`;

function norm(id: string): string {
  return id.trim().toLowerCase();
}

export function saveRfqAiBaseline(
  rfqName: string,
  invitedSupplierIds: string[],
  quotedSupplierIds: string[],
): void {
  try {
    const record: RfqAiBaseline = {
      invitedSupplierIds: invitedSupplierIds.map(norm),
      quotedSupplierIds: quotedSupplierIds.map(norm),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(baselineKey(rfqName), JSON.stringify(record));
    clearRfqAiStale(rfqName);
  } catch {
    /* ignore */
  }
}

export function markRfqAiStale(
  rfqName: string,
  reason: string,
  source?: RfqAiStaleSource,
): void {
  try {
    const state: RfqAiStaleState = {
      stale: true,
      reason,
      source,
      markedAt: new Date().toISOString(),
    };
    localStorage.setItem(staleKey(rfqName), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearRfqAiStale(rfqName: string): void {
  try {
    localStorage.removeItem(staleKey(rfqName));
  } catch {
    /* ignore */
  }
}

export function getRfqAiStale(rfqName: string): RfqAiStaleState {
  try {
    const raw = localStorage.getItem(staleKey(rfqName));
    if (!raw) return { stale: false };
    const parsed = JSON.parse(raw) as RfqAiStaleState;
    return parsed?.stale ? parsed : { stale: false };
  } catch {
    return { stale: false };
  }
}

export function readRfqAiBaseline(rfqName: string): RfqAiBaseline | null {
  try {
    const raw = localStorage.getItem(baselineKey(rfqName));
    return raw ? (JSON.parse(raw) as RfqAiBaseline) : null;
  } catch {
    return null;
  }
}

/** Returns true when invited set or quoted set changed since last analysis. */
export function detectRfqAiStale(
  rfqName: string,
  currentInvited: string[],
  currentQuoted: string[],
): boolean {
  const baseline = readRfqAiBaseline(rfqName);
  if (!baseline) return false;

  const invited = new Set(currentInvited.map(norm));
  const quoted = new Set(currentQuoted.map(norm));
  const baseInvited = new Set(baseline.invitedSupplierIds.map(norm));
  const baseQuoted = new Set(baseline.quotedSupplierIds.map(norm));

  for (const id of invited) {
    if (!baseInvited.has(id)) return true;
  }
  for (const id of quoted) {
    if (!baseQuoted.has(id)) return true;
  }
  return false;
}
