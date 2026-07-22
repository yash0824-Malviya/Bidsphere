/**
 * Local persistence for RFP supplier responses + enterprise field enrichment.
 * Parent RFP documents live in ERPNext; enrichment is UI/architecture sidecar
 * so we never modify existing RFP APIs or DocType fields.
 */

import type {
  RFP,
  RfpDurationUnit,
  RfpRequiredDocument,
  RfpResponse,
} from "../types/rfp";

const RESPONSE_KEY = "bidsphere-rfp-responses";
const ENRICHMENT_KEY = "bidsphere-rfp-enrichment";

export interface RfpEnrichment {
  category?: string;
  department?: string;
  scope_of_work?: string;
  business_objective?: string;
  technical_requirements?: string;
  estimated_duration_value?: number;
  estimated_duration_unit?: RfpDurationUnit;
  /** Full document config including max size / allowed types. */
  required_documents?: RfpRequiredDocument[];
}

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

export function readAllRfpResponses(): RfpResponse[] {
  return readJson<RfpResponse[]>(RESPONSE_KEY, []);
}

export function writeAllRfpResponses(list: RfpResponse[]): void {
  writeJson(RESPONSE_KEY, list);
}

export function upsertRfpResponse(doc: RfpResponse): RfpResponse {
  const list = readAllRfpResponses();
  const idx = list.findIndex((r) => r.id === doc.id);
  if (idx >= 0) list[idx] = doc;
  else list.unshift(doc);
  writeAllRfpResponses(list);
  return doc;
}

function readEnrichmentMap(): Record<string, RfpEnrichment> {
  return readJson<Record<string, RfpEnrichment>>(ENRICHMENT_KEY, {});
}

export function getRfpEnrichment(rfpName: string): RfpEnrichment {
  if (!rfpName) return {};
  return readEnrichmentMap()[rfpName] ?? {};
}

export function saveRfpEnrichment(
  rfpName: string,
  enrichment: RfpEnrichment,
): void {
  if (!rfpName) return;
  const map = readEnrichmentMap();
  map[rfpName] = { ...map[rfpName], ...enrichment };
  writeJson(ENRICHMENT_KEY, map);
}

export function deleteRfpEnrichment(rfpName: string): void {
  if (!rfpName) return;
  const map = readEnrichmentMap();
  delete map[rfpName];
  writeJson(ENRICHMENT_KEY, map);
}

function pickText(
  primary: string | undefined | null,
  fallback: string | undefined | null,
): string | undefined {
  const a = String(primary ?? "").trim();
  if (a) return a;
  const b = String(fallback ?? "").trim();
  return b || undefined;
}

/** Merge ERPNext RFP with local enrichment for enterprise UI fields. */
export function mergeRfpWithEnrichment(rfp: RFP): RFP {
  const e = getRfpEnrichment(rfp.name);
  const docs =
    e.required_documents && e.required_documents.length > 0
      ? mergeDocuments(rfp.required_documents, e.required_documents)
      : rfp.required_documents;

  // Prefer non-empty ERP values; fall back to local enrichment (procurement browser).
  return {
    ...rfp,
    category: pickText(rfp.category, e.category),
    department: pickText(rfp.department, e.department),
    scope_of_work: pickText(rfp.scope_of_work, e.scope_of_work),
    business_objective: pickText(rfp.business_objective, e.business_objective),
    technical_requirements: pickText(
      rfp.technical_requirements,
      e.technical_requirements,
    ),
    estimated_duration_value:
      rfp.estimated_duration_value ?? e.estimated_duration_value,
    estimated_duration_unit:
      rfp.estimated_duration_unit ?? e.estimated_duration_unit,
    required_documents: docs,
  };
}

/** True when local enrichment has narrative text missing from the ERP document. */
export function rfpNeedsNarrativeSync(rfp: RFP): boolean {
  const e = getRfpEnrichment(rfp.name);
  return Boolean(
    (!String(rfp.scope_of_work || "").trim() &&
      String(e.scope_of_work || "").trim()) ||
      (!String(rfp.business_objective || "").trim() &&
        String(e.business_objective || "").trim()) ||
      (!String(rfp.technical_requirements || "").trim() &&
        String(e.technical_requirements || "").trim()),
  );
}

function mergeDocuments(
  erpDocs: RfpRequiredDocument[],
  enriched: RfpRequiredDocument[],
): RfpRequiredDocument[] {
  if (!erpDocs.length) return enriched;
  return erpDocs.map((erp) => {
    const match =
      enriched.find((e) => e.id === erp.id) ||
      enriched.find(
        (e) =>
          e.doc_type === erp.doc_type &&
          (e.label || "") === (erp.label || ""),
      );
    if (!match) return erp;
    return {
      ...erp,
      max_file_size_mb: match.max_file_size_mb,
      allowed_file_types: match.allowed_file_types,
      label: match.label ?? erp.label,
      required: match.required ?? erp.required,
    };
  });
}
