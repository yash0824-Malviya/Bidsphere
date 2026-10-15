/** Read-only checks using the actual application projections, without executing browser code. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { assertEcrDataSchemaInstalled } from "./ecr-data-schema.mjs";
import { createEcrSchemaErpClient, ecrSchemaResource as resource, listAllEcrSchemaRows } from "./ecr-schema-erp-client.mjs";

function source(path) {
  return ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
}
function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (child) => find(child, predicate));
}
function stringArray(node, bindings = {}) {
  assert.ok(node && ts.isArrayLiteralExpression(node), "Expected a source array literal.");
  return node.elements.flatMap((element) => {
    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      assert.ok(bindings[element.expression.text], "Unknown source field list spread.");
      return bindings[element.expression.text];
    }
    assert.ok(ts.isStringLiteral(element), "Expected string fields in source query.");
    return element.text;
  });
}
function declaredArray(root, name, bindings) {
  const declaration = find(root, (node) => ts.isVariableDeclaration(node) && node.name.getText(root) === name);
  return stringArray(declaration?.initializer, bindings);
}
function serializedFields(root) {
  const call = find(root, (node) => ts.isCallExpression(node) && node.expression.getText() === "JSON.stringify"
    && node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])
    && node.arguments[0].elements.every(ts.isStringLiteral));
  return stringArray(call?.arguments[0]);
}

async function main() {
  const api = createEcrSchemaErpClient();
  const ECR = "Engineering Change Request";
  const ecrSource = source("src/api/ecr.ts");
  const listFields = declaredArray(ecrSource, "ECR_LIST_FIELDS");
  const detailFields = declaredArray(ecrSource, "ECR_DETAIL_FIELDS", { ECR_LIST_FIELDS: listFields });
  const securitySource = source("api/proxy.ts");
  const securityFunction = find(securitySource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "readEcrSecuritySnapshot");
  assert.ok(securityFunction, "ECR security snapshot function not found.");
  const securityFields = serializedFields(securityFunction);
  const notificationFields = serializedFields(source("src/hooks/useECRNotifications.ts"));
  for (const fields of [listFields, detailFields, securityFields, notificationFields]) assert.ok(fields.includes("ecr_workflow_version"));

  assertEcrDataSchemaInstalled(await api("GET", resource("DocType", ECR)));
  const records = await listAllEcrSchemaRows(api, ECR, listFields);
  for (const row of records) {
    const [detail, snapshot] = await Promise.all([detailFields, securityFields].map((fields) =>
      api("GET", `${resource(ECR, row.name)}?${new URLSearchParams({ fields: JSON.stringify(fields) })}`)));
    assert.equal(detail.name, row.name);
    assert.equal(snapshot.name, row.name);
    assert.equal(detail.ecr_workflow_version ?? "", row.ecr_workflow_version ?? "");
    assert.equal(snapshot.ecr_workflow_version ?? "", row.ecr_workflow_version ?? "");
  }
  // Same version predicate and all role stage predicates used by notification polling.
  const notifications = source("src/hooks/useECRNotifications.ts");
  const stageMap = find(notifications, (node) => ts.isVariableDeclaration(node) && node.name.getText(notifications) === "STAGES_BY_ROLE");
  assert.ok(stageMap?.initializer && ts.isObjectLiteralExpression(stageMap.initializer));
  for (const role of stageMap.initializer.properties) {
    assert.ok(ts.isPropertyAssignment(role));
    const stages = stringArray(role.initializer);
    await listAllEcrSchemaRows(api, ECR, notificationFields, [["ecr_workflow_version", "=", "extended_v1"], ["select_pxfp", "in", stages]]);
  }
  const rfqs = await listAllEcrSchemaRows(api, "Request for Quotation", ["name", "docstatus"]);
  if (rfqs.length) assert.equal((await api("GET", resource("Request for Quotation", rfqs[0].name))).name, rfqs[0].name);
  console.log(JSON.stringify({
    schema: "passed", dashboardAndListProjection: { fields: listFields.length, records: records.length, result: "passed" },
    detailProjection: { fields: detailFields.length, records: records.length, result: "passed" },
    securitySnapshotProjection: { records: records.length, result: "passed" },
    notificationQueries: { roles: stageMap.initializer.properties.length, result: "passed" },
    legacyRecords: records.filter((row) => row.ecr_workflow_version !== "extended_v1").length,
    extendedRecords: records.filter((row) => row.ecr_workflow_version === "extended_v1").length,
    existingRfqReads: { records: rfqs.length, detail: rfqs.length ? "passed" : "no existing RFQs" },
    mutations: 0,
  }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
