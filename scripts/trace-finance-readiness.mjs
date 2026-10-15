/**
 * Simulates what the Finance dashboard does:
 * 1. Calls /api/legal-review/list (gateway)
 * 2. Applies isRfqReadyForFinance on the returned records
 * 3. Reports which check fails for LDC2026-00021
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function parseEsignBundle(raw) {
  if (!raw) return { documents: {}, reviewChecklist: [] };
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (p?.documents && typeof p.documents === "object") return p;
    // Legacy envelope: wrap in documents
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
  if (!review || !(review[`${key}_approved`] === 1 || review[`${key}_approved`] === true)) {
    return false;
  }
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
      env.signatureRequest.sourceHash === env.documentHash && env.signatureRequest.sourceFileId === env.sourceFileId &&
      hasLegalSignature(env);
  });
}

function isRfqReadyForFinance(doc) {
  return !!doc && doc.review_status === "Approved" && doc.workflow_state === "Finance Review" &&
    doc.finance_status === "Pending" && isLegalReviewExecuted(doc);
}

// Call the gateway
const token = `${process.env.ERP_API_KEY || process.env.VITE_API_KEY}:${process.env.ERP_API_SECRET || process.env.VITE_API_SECRET}`;

const res = await fetch("http://localhost:5173/api/legal-review/list", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Bidsphere-Access-Token": token },
  body: JSON.stringify({ limit: 200 }),
});

if (!res.ok) {
  const txt = await res.text();
  console.error("Gateway call FAILED:", res.status, txt.slice(0, 500));
  process.exit(1);
}

const { records } = await res.json();
console.log(`Gateway returned ${records?.length ?? 0} records`);

// Find the record for LDC2026-00021 / PUR-SQTN-2026-00243
const target = records?.find(r =>
  r.name === "LDC2026-00021" ||
  r.sq_name === "PUR-SQTN-2026-00243" ||
  r.rfq_name === "PUR-RFQ-2026-00088"
);

if (!target) {
  console.error("TARGET RECORD NOT FOUND in gateway response!");
  console.log("All record names:", records?.map(r => ({ name: r.name, sq: r.sq_name, rfq: r.rfq_name, review_status: r.review_status, workflow_state: r.workflow_state, finance_status: r.finance_status })));
  process.exit(1);
}

console.log("\n=== TARGET RECORD FOUND ===");
console.log("name:", target.name);
console.log("rfq_name:", target.rfq_name);
console.log("review_status:", target.review_status);
console.log("workflow_state:", target.workflow_state);
console.log("finance_status:", target.finance_status);
console.log("esign_status:", target.esign_status);
console.log("required_document_keys:", target.required_document_keys);
console.log("terms_file_url:", target.terms_file_url ? "PRESENT" : "MISSING");
console.log("warranty_file_url:", target.warranty_file_url ? "PRESENT" : "MISSING");
console.log("insurance_file_url:", target.insurance_file_url ? "PRESENT" : "MISSING");
console.log("terms_approved:", target.terms_approved);
console.log("warranty_approved:", target.warranty_approved);
console.log("insurance_approved:", target.insurance_approved);
console.log("esign_envelope:", target.esign_envelope ? `PRESENT (${target.esign_envelope.length} chars)` : "MISSING");

console.log("\n=== FINANCE READINESS BREAKDOWN ===");
console.log("1. doc exists:", !!target);
console.log("2. review_status === Approved:", target.review_status === "Approved");
console.log("3. workflow_state === Finance Review:", target.workflow_state === "Finance Review");
console.log("4. finance_status === Pending:", target.finance_status === "Pending");

const docsVerified = areRequiredDocumentsVerified(target);
console.log("5. areRequiredDocumentsVerified:", docsVerified);

if (!docsVerified) {
  const reqKeys = getRequiredLegalDocumentKeys(target);
  console.log("   required keys:", reqKeys);
  for (const key of reqKeys) {
    const approved = target[`${key}_approved`];
    console.log(`   ${key}_approved:`, approved);
    if (approved === 1 || approved === true) {
      const bundle = parseEsignBundle(target.esign_envelope);
      const env = bundle.documents[key];
      console.log(`   ${key} envelope:`, env ? {
        viewedAt: env.viewedAt,
        viewedBy: env.viewedBy,
        sourceFileId: env.sourceFileId,
        sourceFileUrl: env.sourceFileUrl,
        fileUrlMatch: env.sourceFileUrl === target[`${key}_file_url`],
        documentHash: env.documentHash ? env.documentHash.slice(0, 16) + "..." : null,
        hashValid: isSha256Hex(env.documentHash),
        approvedHash: env.approvedHash ? env.approvedHash.slice(0, 16) + "..." : null,
        hashMatch: !env.approvedHash || env.approvedHash === env.documentHash,
      } : "MISSING_ENVELOPE");
    }
  }
}

const executed = isLegalReviewExecuted(target);
console.log("6. isLegalReviewExecuted:", executed);

if (!executed && docsVerified) {
  const bundle = parseEsignBundle(target.esign_envelope);
  const reqKeys = getRequiredLegalDocumentKeys(target);
  for (const key of reqKeys) {
    const env = bundle.documents[key];
    console.log(`   ${key} signature check:`, {
      completedAt: env?.signatureRequest?.completedAt,
      signedFileUrl: env?.signedFileUrl ? "PRESENT" : "MISSING",
      signedFileHash: env?.signedFileHash ? env.signedFileHash.slice(0,16)+"..." : "MISSING",
      hashValid: isSha256Hex(env?.signedFileHash),
      sourceHashMatch: env?.signatureRequest?.sourceHash === env?.documentHash,
      sourceFileIdMatch: env?.signatureRequest?.sourceFileId === env?.sourceFileId,
      hasSig: hasLegalSignature(env),
    });
  }
}

console.log("\n==> isRfqReadyForFinance:", isRfqReadyForFinance(target));

// Check what stage deriveWorkflowStage assigns
function deriveWorkflowStage(doc) {
  const legal = (doc.review_status ?? "").trim();
  const finance = String(doc.finance_status ?? "").trim();
  const persisted = (doc.workflow_state ?? "").trim();

  if (legal === "Rejected" || finance === "Rejected" || persisted === "Rejected") return "Rejected";
  if (legal === "Pending" && persisted === "Pending Review" && doc.current_owner === "Procurement") return "Procurement";
  if (isRfqReadyForPurchaseOrder(doc)) return "Procurement";
  if (isRfqReadyForFinance(doc)) return "Finance Review";
  if (persisted === "Pending Review" || legal === "Pending" || !legal) return "Legal Review";
  return "Legal Review";
}

function isRfqReadyForPurchaseOrder(doc) {
  return !!doc && doc.review_status === "Approved" && doc.finance_status === "Approved" &&
    doc.workflow_state === "Completed" && isLegalReviewExecuted(doc);
}

console.log("==> deriveWorkflowStage:", deriveWorkflowStage(target));
