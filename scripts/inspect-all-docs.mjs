const ERP_URL = process.env.VITE_ERP_BASE_URL || "http://80.225.204.210:8090";
const ERP_KEY = process.env.VITE_ERP_API_KEY || "";
const ERP_SECRET = process.env.VITE_ERP_API_SECRET || "";

async function main() {
  const ldcRes = await fetch(`${ERP_URL}/api/resource/Legal Document Review/LDC2026-00021`, {
    headers: { Authorization: `token ${ERP_KEY}:${ERP_SECRET}`, Accept: "application/json" }
  });
  const ldc = (await ldcRes.json()).data;
  console.log("LDC2026-00021:", {
    name: ldc.name,
    sq_name: ldc.sq_name,
    terms_file_url: ldc.terms_file_url,
    warranty_file_url: ldc.warranty_file_url,
    insurance_file_url: ldc.insurance_file_url,
    esign_signed_file_url: ldc.esign_signed_file_url,
  });

  const sqRes = await fetch(`${ERP_URL}/api/resource/Supplier Quotation/PUR-SQTN-2026-00243`, {
    headers: { Authorization: `token ${ERP_KEY}:${ERP_SECRET}`, Accept: "application/json" }
  });
  const sq = (await sqRes.json()).data;
  console.log("SQ:", {
    custom_terms__condition: sq.custom_terms__condition,
    custom_warenty_certificate: sq.custom_warenty_certificate,
    custom_warranty_certificate: sq.custom_warranty_certificate,
    custom_insurance_certificate: sq.custom_insurance_certificate,
  });

  const filesRes = await fetch(`${ERP_URL}/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["attached_to_name", "in", ["LDC2026-00021", "PUR-SQTN-2026-00243"]]]))}&fields=${encodeURIComponent(JSON.stringify(["name", "file_name", "file_url", "is_private", "attached_to_doctype", "attached_to_name", "attached_to_field", "owner"]))}`, {
    headers: { Authorization: `token ${ERP_KEY}:${ERP_SECRET}`, Accept: "application/json" }
  });
  console.log("Files attached to LDC or SQ:", (await filesRes.json()).data);
}

main().catch(console.error);
