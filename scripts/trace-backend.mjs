/**
 * Directly calls listWorkflowRecords via the legalReviewCore backend
 * to trace the exact failing check for LDC2026-00021.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

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

// Import the actual backend function
const { listWorkflowRecords } = await import("./api/legalReviewCore.js");

// Inline the same logic as approvalWorkflow.ts

function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

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
      env.signatureRequest.sourceHash === env.documentHash && env.signatureRequest.sourceFileId === env.sourceFileId &&
      hasLegalSignature(env);
  });
}

function isRfqReadyForFinance(doc) {
  return !!doc && doc.review_status === "Approved" && doc.workflow_state === "Finance Review" &&
    doc.finance_status === "Pending" && isLegalReviewExecuted(doc);
}

async function run() {
  console.log("Calling listWorkflowRecords...");
  const records = await listWorkflowRecords({ limit: 200 });
  console.log(`Got ${records.length} records`);

  const target = records.find(r =>
    r.name === "LDC2026-00021" ||
    r.sq_name === "PUR-SQTN-2026-00243" ||
    r.rfq_name === "PUR-RFQ-2026-00088"
  );

  if (!target) {
    console.error("TARGET NOT FOUND!");
    console.log("All records:", records.map(r => ({ name: r.name, sq: r.sq_name, rfq: r.rfq_name, review: r.review_status, wf: r.workflow_state, fin: r.finance_status })));
    return;
  }

  console.log("\n=== TARGET FOUND ===");
  console.log("name:", target.name);
  console.log("review_status:", target.review_status);
  console.log("workflow_state:", target.workflow_state);
  console.log("finance_status:", target.finance_status);
  console.log("esign_status:", target.esign_status);
  console.log("required_document_keys:", target.required_document_keys);
  console.log("terms_file_url:", target.terms_file_url ? "OK" : "MISSING");
  console.log("warranty_file_url:", target.warranty_file_url ? "OK" : "MISSING");
  console.log("insurance_file_url:", target.insurance_file_url ? "OK" : "MISSING");
  console.log("terms_approved:", target.terms_approved);
  console.log("warranty_approved:", target.warranty_approved);
  console.log("insurance_approved:", target.insurance_approved);
  console.log("esign_envelope:", target.esign_envelope ? `PRESENT (${target.esign_envelope.length} chars)` : "MISSING/NULL");

  console.log("\n=== ISRFQREADYFORFINANCE BREAKDOWN ===");
  console.log("1. review_status === Approved:", target.review_status === "Approved");
  console.log("2. workflow_state === Finance Review:", target.workflow_state === "Finance Review");
  console.log("3. finance_status === Pending:", target.finance_status === "Pending");

  const reqKeys = getRequiredLegalDocumentKeys(target);
  console.log("4. required keys:", reqKeys);

  for (const key of reqKeys) {
    const approved = target[`${key}_approved`];
    console.log(`\n   [${key}]`);
    console.log(`   ${key}_approved:`, approved);
    console.log(`   ${key}_file_url:`, target[`${key}_file_url`] ? "PRESENT" : "MISSING");
    const bundle = parseEsignBundle(target.esign_envelope);
    const env = bundle.documents[key];
    if (!env) { console.log(`   envelope.${key}: MISSING`); continue; }
    console.log(`   viewedAt:`, env.viewedAt ?? "NULL");
    console.log(`   viewedBy:`, env.viewedBy ?? "NULL");
    console.log(`   sourceFileId:`, env.sourceFileId ?? "NULL");
    console.log(`   sourceFileUrl:`, env.sourceFileUrl ?? "NULL");
    console.log(`   fileUrlMatch:`, env.sourceFileUrl === target[`${key}_file_url`]);
    console.log(`   documentHash valid SHA256:`, isSha256Hex(env.documentHash));
    console.log(`   approvedHash === documentHash or blank:`, !env.approvedHash || env.approvedHash === env.documentHash);
    const verified = isLegalDocumentVerified(target, key);
    console.log(`   => isLegalDocumentVerified:`, verified);
    if (verified) {
      console.log(`   completedAt:`, env.signatureRequest?.completedAt ?? "NULL");
      console.log(`   signedFileUrl:`, env.signedFileUrl ?? "NULL");
      console.log(`   signedFileHash valid:`, isSha256Hex(env.signedFileHash));
      console.log(`   sourceHash===documentHash:`, env.signatureRequest?.sourceHash === env.documentHash);
      console.log(`   sourceFileId===env.sourceFileId:`, env.signatureRequest?.sourceFileId === env.sourceFileId);
      console.log(`   hasLegalSignature:`, hasLegalSignature(env));
    }
  }

  const docsVerified = areRequiredDocumentsVerified(target);
  console.log("\n5. areRequiredDocumentsVerified:", docsVerified);
  const executed = isLegalReviewExecuted(target);
  console.log("6. isLegalReviewExecuted:", executed);
  console.log("\n==> isRfqReadyForFinance:", isRfqReadyForFinance(target));
}

run().catch(console.error);
