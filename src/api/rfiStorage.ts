/**
 * Local persistence for the RFI module.
 *
 * Primary store is localStorage so the module works without new ERPNext
 * DocTypes. The public API in `rfi.ts` is intentionally DocType-shaped so
 * an ERPNext-backed implementation can replace this later without UI churn.
 */

import type { RFI, RfiResponse } from "../types/rfi";

const RFI_KEY = "bidsphere-rfi-documents";
const RESPONSE_KEY = "bidsphere-rfi-responses";
const SEQ_KEY = "bidsphere-rfi-seq";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readAllRfis(): RFI[] {
  return readJson<RFI[]>(RFI_KEY, []);
}

export function writeAllRfis(list: RFI[]): void {
  writeJson(RFI_KEY, list);
}

export function readAllResponses(): RfiResponse[] {
  return readJson<RfiResponse[]>(RESPONSE_KEY, []);
}

export function writeAllResponses(list: RfiResponse[]): void {
  writeJson(RESPONSE_KEY, list);
}

/** Generate the next RFI number: RFI-YYYY-##### */
export function nextRfiNumber(): string {
  const year = new Date().getFullYear();
  const seq = readJson<{ year: number; n: number }>(SEQ_KEY, {
    year,
    n: 0,
  });
  const next = seq.year === year ? seq.n + 1 : 1;
  writeJson(SEQ_KEY, { year, n: next });
  return `RFI-${year}-${String(next).padStart(5, "0")}`;
}

export function upsertRfi(doc: RFI): RFI {
  const list = readAllRfis();
  const idx = list.findIndex((r) => r.name === doc.name);
  if (idx >= 0) list[idx] = doc;
  else list.unshift(doc);
  writeAllRfis(list);
  return doc;
}

export function removeRfi(name: string): void {
  writeAllRfis(readAllRfis().filter((r) => r.name !== name));
  writeAllResponses(readAllResponses().filter((r) => r.rfi !== name));
}

export function upsertResponse(doc: RfiResponse): RfiResponse {
  const list = readAllResponses();
  const idx = list.findIndex((r) => r.id === doc.id);
  if (idx >= 0) list[idx] = doc;
  else list.unshift(doc);
  writeAllResponses(list);
  return doc;
}
