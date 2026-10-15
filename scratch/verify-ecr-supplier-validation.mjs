import assert from "node:assert/strict";
import { createServer } from "vite";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "../scripts/ecr-schema-erp-client.mjs";
const api = createEcrSchemaErpClient();
const rows = await listAllEcrSchemaRows(api, "Engineering Change Request", ["name"], [["ecr_number", "=", "ECR-2026-100010"]]);
const document = await api("GET", resource("Engineering Change Request", rows[0]?.name || "ECR-2026-100010"));
const original = JSON.stringify(document);
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { assertEcrProcurementRelationships } = await server.ssrLoadModule("/api/ecrProcurementValidation.ts");
  let sourceReads = 0;
  await assertEcrProcurementRelationships(document, async (doctype, name) => {
    sourceReads++;
    return api("GET", resource(doctype, name));
  });
  assert.equal(JSON.stringify(document), original);
  assert.equal(sourceReads, 0);
  console.log(JSON.stringify({ ecr: document.ecr_number || document.name, validation: "passed", supplierRequired: document.supplier_response_required, supplierSelected: Boolean(document.suggested_supplier), referenceType: document.procurement_reference_type, persistedDocumentUnchanged: true, sourceDocumentReads: sourceReads, writes: 0 }, null, 2));
} finally {
  await server.close();
}
