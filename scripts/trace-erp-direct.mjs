/**
 * Queries ERPNext directly (same as what listWorkflowRecords does),
 * then applies the isRfqReadyForFinance logic inline to pinpoint the bug.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const BASE = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const KEY = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const SECRET = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const AUTH = `token ${KEY}:${SECRET}`;

async function erpGet(path) {
  const res = await fetch(`${BASE}/api/${path}`, { headers: { Authorization: AUTH, Accept: "application/json" } });
  const json = await res.json();
  return json?.data ?? json;
}

// Same WORKFLOW_LIST_FIELDS as legalReviewCore.ts
const FIELDS = [
  "name", "modified", "sq_name", "rfq_name", "supplier", "company",
  "quotation_number", "procurement_manager", "submission_date", "workflow_state",
  "current_owner", "next_approver", "grand_total", "review_status",
  "approved_by", "approved_on", "legal_comments", "rejection_reason",
  "finance_status", "finance_approved_by", "finance_approved_on",
  "finance_comments", "finance_rejection_reason", "esign_status",
  "esign_envelope", "esign_signed_by", "esign_signed_on", "esign_signed_file_url",
  "terms_file_url", "warranty_file_url", "insurance_file_url",
  "terms_viewed", "terms_approved", "warranty_viewed", "warranty_approved",
  "insurance_viewed", "insurance_approved",
];

// --- Logic replication from frontend ---

function isSha256Hex(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }

function parseEsignBundle(raw) {
  if (!raw) return { documents: {}, reviewChecklist: [] };
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (p?.documents && typeof p.documents === "object") return p;
    const key = p?.documentKey;
    if (key) return { documents: { [key]: p }, reviewChecklist: [] };
  } catch {}
  return { documents: {}, reviewChecklist: [] };
}

function hasLegalSignature(env) {
  return !!env?.signatures?.length && env.signatures.some(s => s.status === "locked" || s.status === "signed");
}

const LEGAL_DOC_KEYS = ["terms", "warranty", "insurance"];

function getRequiredLegalDocumentKeys(review) {
  const keys = review?.required_document_keys;
  if (keys === undefined) return LEGAL_DOC_KEYS.filter(key => {
    const fileUrl = review?.[`${key}_file_url`];
    return typeof fileUrl === "string" && fileUrl.trim().length > 0;
  });
  if (!Array.isArray(keys) || keys.some(key => !LEGAL_DOC_KEYS.includes(key))) return [];
  return [...new Set(keys)];
}

function isLegalDocumentVerified(review, key) {
  if (!review || !(review[`${key}_approved`] === 1 || review[`${key}_approved`] === true)) return false;
  const bundle = parseEsignBundle(review.esign_envelope);
  const env = bundle.documents[key];
  return Boolean(review[`${key}_file_url`] && env?.viewedAt && env.viewedBy && env.sourceFileId &&
    env.sourceFileUrl === review[`${key}_file_url`] && isSha256Hex(env.documentHash) &&
    (!env.approvedHash || env.approvedHash === env.documentHash));
}

function areRequiredDocumentsVerified(review) {
  const keys = getRequiredLegalDocumentKeys(review);
  return keys.length > 0 && keys.every(key => isLegalDocumentVerified(review, key));
}

function isLegalReviewExecuted(review) {
  if (!review || !areRequiredDocumentsVerified(review)) return false;
  const bundle = parseEsignBundle(review.esign_envelope);
  const keys = getRequiredLegalDocumentKeys(review);
  return keys.length > 0 && keys.every(key => {
    const env = bundle.documents[key];
    return !!env?.signatureRequest?.completedAt && !!env.signedFileUrl && isSha256Hex(env.signedFileHash) &&
      env.signatureRequest.sourceHash === env.documentHash &&
      env.signatureRequest.sourceFileId === env.sourceFileId &&
      hasLegalSignature(env);
  });
}

function isRfqReadyForFinance(doc) {
  return !!doc && doc.review_status === "Approved" && doc.workflow_state === "Finance Review" &&
    doc.finance_status === "Pending" && isLegalReviewExecuted(doc);
}

async function run() {
  // Fetch all LDRs with the same fields list uses
  const data = await erpGet(`resource/Legal%20Document%20Review?fields=${encodeURIComponent(JSON.stringify(FIELDS))}&limit_page_length=200&order_by=modified+desc`);
  const rows = Array.isArray(data) ? data : [];
  console.log(`ERP returned ${rows.length} LDR rows`);

  // Apply withRequiredDocuments (same as backend)
  const records = rows.map(r => ({
    ...r,
    required_document_keys: LEGAL_DOC_KEYS.filter(key => Boolean(r[`${key}_file_url`]?.trim())),
  }));

  // Find target
  const target = records.find(r =>
    r.name === "LDC2026-00021" ||
    r.sq_name === "PUR-SQTN-2026-00243" ||
    r.rfq_name === "PUR-RFQ-2026-00088"
  );

  if (!target) {
    console.error("TARGET NOT FOUND! Records:");
    records.forEach(r => console.log(" -", r.name, r.sq_name, r.rfq_name, r.review_status, r.workflow_state, r.finance_status));
    return;
  }

  console.log("\n=== TARGET: LDC2026-00021 ===");
  console.log("review_status:", target.review_status);
  console.log("workflow_state:", target.workflow_state);
  console.log("finance_status:", target.finance_status);
  console.log("esign_status:", target.esign_status);
  console.log("required_document_keys:", target.required_document_keys);
  console.log("file_urls:", { terms: !!target.terms_file_url, warranty: !!target.warranty_file_url, insurance: !!target.insurance_file_url });
  console.log("approved:", { terms: target.terms_approved, warranty: target.warranty_approved, insurance: target.insurance_approved });
  console.log("esign_envelope:", target.esign_envelope ? `PRESENT (${target.esign_envelope.length} chars)` : "ABSENT");

  console.log("\n=== PER-DOCUMENT VERIFICATION ===");
  const reqKeys = getRequiredLegalDocumentKeys(target);
  console.log("Required keys:", reqKeys);

  for (const key of reqKeys) {
    const bundle = parseEsignBundle(target.esign_envelope);
    const env = bundle.documents[key];
    const approved = target[`${key}_approved`];
    const fileUrl = target[`${key}_file_url`];
    console.log(`\n[${key}]`);
    console.log("  approved:", approved, "(need 1 or true)");
    console.log("  file_url:", fileUrl ? "PRESENT" : "MISSING");
    if (!env) { console.log("  envelope: MISSING"); continue; }
    console.log("  viewedAt:", env.viewedAt ?? "NULL");
    console.log("  viewedBy:", env.viewedBy ?? "NULL");
    console.log("  sourceFileId:", env.sourceFileId ?? "NULL");
    console.log("  sourceFileUrl:", env.sourceFileUrl ?? "NULL");
    console.log("  fileUrlMatch:", env.sourceFileUrl === fileUrl, `(env.sourceFileUrl='${env.sourceFileUrl}' vs file_url='${fileUrl}')`);
    console.log("  documentHash:", env.documentHash ? env.documentHash.slice(0,16)+"..." : "NULL");
    console.log("  documentHash valid SHA256:", isSha256Hex(env.documentHash));
    console.log("  approvedHash ok:", !env.approvedHash || env.approvedHash === env.documentHash);
    const verified = isLegalDocumentVerified(target, key);
    console.log("  => isLegalDocumentVerified:", verified);

    if (verified) {
      console.log("  completedAt:", env.signatureRequest?.completedAt ?? "NULL");
      console.log("  signedFileUrl:", env.signedFileUrl ? "PRESENT" : "NULL");
      console.log("  signedFileHash valid:", isSha256Hex(env.signedFileHash));
      console.log("  sourceHash===documentHash:", env.signatureRequest?.sourceHash === env.documentHash);
      console.log("  sourceFileId===env.sourceFileId:", env.signatureRequest?.sourceFileId === env.sourceFileId);
      console.log("  hasLegalSignature:", hasLegalSignature(env));
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log("areRequiredDocumentsVerified:", areRequiredDocumentsVerified(target));
  console.log("isLegalReviewExecuted:", isLegalReviewExecuted(target));
  console.log("isRfqReadyForFinance:", isRfqReadyForFinance(target));

  // Check what deriveWorkflowStage would assign
  const wf = target.workflow_state?.trim();
  const legal = target.review_status?.trim();
  const fin = String(target.finance_status ?? "").trim();
  let derivedStage;
  if (legal === "Rejected" || fin === "Rejected" || wf === "Rejected") derivedStage = "Rejected";
  else if (legal === "Pending" && wf === "Pending Review" && target.current_owner === "Procurement") derivedStage = "Procurement";
  else if (isRfqReadyForFinance(target)) derivedStage = "Finance Review";
  else if (wf === "Pending Review" || legal === "Pending" || !legal) derivedStage = "Legal Review";
  else derivedStage = "Legal Review";
  console.log("derivedWorkflowStage:", derivedStage);

  // isFinanceFunnel check  
  const isFinanceFunnel = derivedStage === "Finance Review" || derivedStage === "Completed" || 
    derivedStage === "Procurement" ||
    (derivedStage === "Rejected" && target.review_status === "Approved");
  console.log("isFinanceFunnel:", isFinanceFunnel);
}

run().catch(console.error);
