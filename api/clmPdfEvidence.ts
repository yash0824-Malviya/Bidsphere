import type { ClmData, ClmRecord } from "../src/types/clm.js";
import { canonicalErpFilePath } from "./fileProxyCore.js";

/** Persisted evidence only: no source fetch, PDF regeneration or workflow mutation. */
export interface ClmPdfEvidence {
  file_id: string;
  file_url: string;
  hash: string;
  version: string;
  kind: "locked" | "signed";
  signature_page?: number;
}
export class ClmPdfEvidenceError extends Error {
  readonly status = 409;
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): ClmRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value.map(object) : [];
const currentVersion = (record: ClmRecord, data: ClmData) => text(record.custom_current_version) ||
  text(data.versions.find(row => row.id === data.version)?.number) || text(data.version) || "1.0";

function evidence(value: unknown, version: string, kind: ClmPdfEvidence["kind"]): ClmPdfEvidence | undefined {
  if (!value) return undefined;
  const row = object(value);
  if (!text(row.file_id) || !text(row.file_url) || !text(row.hash)) throw new ClmPdfEvidenceError("The saved Contract PDF evidence is incomplete. Refresh the Contract and verify its versioned document.");
  if (!/^[a-f\d]{64}$/i.test(text(row.hash)) || !text(row.file_url).startsWith("/private/files/") || !canonicalErpFilePath(text(row.file_url))?.startsWith("/private/files/")) {
    throw new ClmPdfEvidenceError("The saved Contract PDF evidence must identify a private document and valid SHA-256 digest. Verify its versioned document before continuing.");
  }
  if (text(row.version) && text(row.version) !== version || kind === "signed" && text(row.version) !== version) {
    throw new ClmPdfEvidenceError("The saved Contract PDF does not match the requested Contract version. A new review is required.");
  }
  return { file_id: text(row.file_id), file_url: text(row.file_url), hash: text(row.hash).toLowerCase(), version, kind,
    ...(Number.isInteger(row.signature_page) && Number(row.signature_page) > 0 ? { signature_page: Number(row.signature_page) } : {}) };
}

/** The same immutable PDF must drive View, Download and the next signature. */
export function currentClmPdfEvidence(record: ClmRecord, data: ClmData): ClmPdfEvidence | undefined {
  const version = currentVersion(record, data);
  const signatures = data.signatures.map(row => evidence(row, version, "signed")!);
  return signatures.at(-1) || evidence(data.locked_file, version, "locked");
}

/** Original approved PDF, intentionally distinct from its later signed artifact. */
export function lockedClmPdfEvidence(record: ClmRecord, data: ClmData): ClmPdfEvidence | undefined {
  return evidence(data.locked_file, currentVersion(record, data), "locked");
}

/** Parent authorization stays with the caller. Historical access is internal-only. */
export function clmPdfEvidenceById(record: ClmRecord, data: ClmData, fileId: string, includeHistory = false): ClmPdfEvidence | undefined {
  const version = currentVersion(record, data);
  for (const row of data.signatures) if (row.file_id === fileId) return evidence(row, version, "signed");
  if (object(data.locked_file).file_id === fileId) return evidence(data.locked_file, version, "locked");
  if (!includeHistory) return undefined;
  for (const history of rows(data.review_history)) {
    const signatures = rows(history.signatures), locked = object(history.locked_file);
    const number = text(data.versions.find(row => row.id === history.version)?.number) || text(locked.version) || text(signatures[0]?.version) || text(history.version);
    if (!number) continue;
    for (const row of signatures) if (row.file_id === fileId) return evidence(row, number, "signed");
    if (locked.file_id === fileId) return evidence(locked, number, "locked");
  }
  return undefined;
}

/** Attachment schema fields may also refer to the same immutable execution PDF. */
export function clmPdfEvidenceByUrl(record: ClmRecord, data: ClmData, fileUrl: string): ClmPdfEvidence | undefined {
  const row = [...data.signatures, object(data.locked_file)].find(value => value.file_url === fileUrl);
  return row && text(row.file_id) ? clmPdfEvidenceById(record, data, text(row.file_id)) : undefined;
}
