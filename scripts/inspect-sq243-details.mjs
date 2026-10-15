import http from "node:http";

const ERP_HOST = "80.225.204.210";
const ERP_PORT = 8090;
const ERP_KEY = "381bc6a7a0b5a32";
const ERP_SECRET = "8336d859faae069";

function erpGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ERP_HOST,
      port: ERP_PORT,
      path,
      method: "GET",
      headers: {
        Authorization: `token ${ERP_KEY}:${ERP_SECRET}`,
        Accept: "application/json",
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  const sqRes = await erpGet("/api/resource/Supplier%20Quotation/PUR-SQTN-2026-00243");
  const sq = sqRes?.data || {};

  const ldcRes = await erpGet("/api/resource/Legal%20Document%20Review/LDC2026-00021");
  const ldc = ldcRes?.data || {};

  const rfqName = sq.request_for_quotation || ldc.rfq_name || "PUR-RFQ-2026-00088";
  const rfqRes = await erpGet(`/api/resource/Request%20for%20Quotation/${rfqName}`);
  const rfq = rfqRes?.data || {};

  console.log("=== LDC2026-00021 (Legal Document Review) ===");
  console.log({
    name: ldc.name,
    sq_name: ldc.sq_name,
    rfq_name: ldc.rfq_name,
    review_status: ldc.review_status,
    finance_status: ldc.finance_status,
    workflow_state: ldc.workflow_state,
    docstatus: ldc.docstatus,
    status: ldc.status,
    terms_viewed: ldc.terms_viewed,
    terms_approved: ldc.terms_approved,
    warranty_viewed: ldc.warranty_viewed,
    warranty_approved: ldc.warranty_approved,
    insurance_viewed: ldc.insurance_viewed,
    insurance_approved: ldc.insurance_approved,
    esign_envelope_length: (ldc.esign_envelope || "").length,
    legal_comments: ldc.legal_comments,
    approved_by: ldc.approved_by,
    approved_on: ldc.approved_on,
  });

  console.log("\n=== PUR-SQTN-2026-00243 (Supplier Quotation) ===");
  console.log({
    name: sq.name,
    docstatus: sq.docstatus,
    status: sq.status,
    custom_finance_status: sq.custom_finance_status,
    custom_legal_status: sq.custom_legal_status,
    custom_workflow_state: sq.custom_workflow_state,
    workflow_state: sq.workflow_state,
    custom_terms__condition: sq.custom_terms__condition,
    custom_warenty_certificate: sq.custom_warenty_certificate,
    custom_insurance_certificate: sq.custom_insurance_certificate,
  });

  console.log("\n=== PUR-RFQ-2026-00088 (Request for Quotation) ===");
  console.log({
    name: rfq.name,
    status: rfq.status,
    docstatus: rfq.docstatus,
    custom_finance_status: rfq.custom_finance_status,
    custom_legal_status: rfq.custom_legal_status,
    custom_workflow_state: rfq.custom_workflow_state,
    workflow_state: rfq.workflow_state,
  });

  // Check Approval Log / Version / Audit
  const versionRes = await erpGet(`/api/resource/Version?filters=[["ref_doctype","=","Legal%20Document%20Review"],["docname","=","LDC2026-00021"]]&fields=["name","owner","creation","data"]`);
  console.log("\n=== Version History for LDC2026-00021 ===");
  console.log(versionRes?.data || []);
}

run().catch(console.error);
