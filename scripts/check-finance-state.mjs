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

const base = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function api(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: auth, Accept: "application/json" } });
  const json = await res.json();
  return { status: res.status, data: json?.data ?? json };
}

async function run() {
  // 1. Get LDR by sq_name
  const fields = JSON.stringify(["name", "rfq_name", "sq_name", "supplier", "review_status", "workflow_state",
    "finance_status", "esign_status", "current_owner", "next_approver",
    "terms_viewed", "terms_approved", "warranty_viewed", "warranty_approved",
    "insurance_viewed", "insurance_approved", "approved_by", "approved_on",
    "finance_approved_by", "finance_approved_on"]);
  const filters = JSON.stringify([["sq_name", "=", "PUR-SQTN-2026-00243"]]);
  const { data: ldcList } = await api(`/api/resource/Legal Document Review?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`);
  const ldc = Array.isArray(ldcList) ? ldcList[0] : null;

  console.log("=== LDR KEY FIELDS ===");
  console.log("ldc_name:", ldc?.name);
  console.log("rfq_name:", ldc?.rfq_name);
  console.log("sq_name:", ldc?.sq_name);
  console.log("supplier:", ldc?.supplier);
  console.log("review_status:", ldc?.review_status);
  console.log("workflow_state:", ldc?.workflow_state);
  console.log("finance_status:", ldc?.finance_status);
  console.log("esign_status:", ldc?.esign_status);
  console.log("current_owner:", ldc?.current_owner);
  console.log("next_approver:", ldc?.next_approver);
  console.log("approved_by:", ldc?.approved_by);
  console.log("approved_on:", ldc?.approved_on);
  console.log("finance_approved_by:", ldc?.finance_approved_by);
  console.log("finance_approved_on:", ldc?.finance_approved_on);
  console.log("docs verified:", {
    terms_viewed: ldc?.terms_viewed,
    terms_approved: ldc?.terms_approved,
    warranty_viewed: ldc?.warranty_viewed,
    warranty_approved: ldc?.warranty_approved,
    insurance_viewed: ldc?.insurance_viewed,
    insurance_approved: ldc?.insurance_approved,
  });

  if (!ldc) {
    console.log("\nNO LDR FOUND for sq_name=PUR-SQTN-2026-00243");
    // Also check by rfq_name
    const rfqFilters = JSON.stringify([["rfq_name", "=", "PUR-SQTN-2026-00243"]]);
    const { data: ldcByRfq } = await api(`/api/resource/Legal Document Review?filters=${encodeURIComponent(rfqFilters)}&fields=${encodeURIComponent(fields)}`);
    const byRfq = Array.isArray(ldcByRfq) ? ldcByRfq[0] : null;
    if (byRfq) {
      console.log("Found by rfq_name:", byRfq.name);
      console.log("review_status:", byRfq.review_status);
      console.log("workflow_state:", byRfq.workflow_state);
      console.log("finance_status:", byRfq.finance_status);
    }
    return;
  }

  // 2. Determine isRfqReadyForFinance
  const isReadyForFinance = 
    ldc?.review_status === "Approved" &&
    ldc?.workflow_state === "Finance Review" &&
    (ldc?.finance_status === "Pending" || !ldc?.finance_status);
  
  console.log("\n=== FINANCE READINESS CHECK ===");
  console.log("review_status === 'Approved':", ldc?.review_status === "Approved");
  console.log("workflow_state === 'Finance Review':", ldc?.workflow_state === "Finance Review");
  console.log("finance_status === 'Pending' or blank:", ldc?.finance_status === "Pending" || !ldc?.finance_status);
  console.log("==> isReadyForFinance:", isReadyForFinance);

  // 3. Check if esign_envelope shows signatures
  if (ldc?.name) {
    const { data: full } = await api(`/api/resource/Legal Document Review/${ldc.name}`);
    const envelope = full?.esign_envelope;
    if (envelope) {
      try {
        const parsed = JSON.parse(envelope);
        const docs = parsed.documents || {};
        console.log("\n=== ESIGN ENVELOPE SUMMARY ===");
        for (const [docKey, env] of Object.entries(docs)) {
          console.log(`  ${docKey}:`, {
            status: env.status,
            locked: env.locked,
            signedFileHash: env.signedFileHash ? env.signedFileHash.slice(0,16) + "..." : null,
            completedAt: env.signatureRequest?.completedAt ?? null,
          });
        }
        // Check isLegalReviewExecuted criteria
        const requiredKeys = Object.keys(docs).filter(k => ["terms","warranty","insurance"].includes(k));
        const allSigned = requiredKeys.every(k => {
          const e = docs[k];
          return e?.signatureRequest?.completedAt && e?.signedFileUrl && e?.signedFileHash;
        });
        console.log("requiredKeys:", requiredKeys);
        console.log("allSigned (completedAt+signedFileUrl+hash):", allSigned);
      } catch (e) {
        console.log("Failed to parse esign_envelope:", e.message);
      }
    } else {
      console.log("\nesign_envelope is EMPTY/NULL");
    }
  }
}

run().catch(console.error);
