import { describe, expect, it } from "vitest";

import {
  hasFrappeResourceDataWrapper,
  isDirectEcrWorkflowRequest,
  requestDoctypeFromBodyOrQuery,
  requestDoctypesFromBodyOrQuery,
} from "./ecrDirectWorkflowGuard";

describe("direct ECR workflow proxy guard", () => {
  it("detects body-carried workflow documents", () => {
    expect(isDirectEcrWorkflowRequest(
      "method/frappe.model.workflow.apply_workflow",
      { doc: { doctype: "Engineering Change Request", name: "ECR-001" } },
      {},
    )).toBe(true);
  });

  it("detects query-carried workflow documents with an empty body", () => {
    expect(isDirectEcrWorkflowRequest(
      "method/frappe.model.workflow.apply_workflow",
      {},
      { doc: JSON.stringify({ doctype: "Engineering Change Request", name: "ECR-001" }) },
    )).toBe(true);
  });

  it("does not classify Purchase Requisition workflow calls as ECR calls", () => {
    expect(isDirectEcrWorkflowRequest(
      "method/frappe.model.workflow.apply_workflow",
      {},
      { doc: JSON.stringify({ doctype: "Purchase Requisition", name: "PR-001" }) },
    )).toBe(false);
  });

  it("detects an ECR doc carried in a generic method query", () => {
    expect(requestDoctypeFromBodyOrQuery({}, {
      doc: JSON.stringify({
        doctype: "Engineering Change Request",
        name: "ECR-001",
        select_pxfp: "Approved",
      }),
    })).toBe("Engineering Change Request");
  });

  it("detects Frappe resource data wrappers in either body or query", () => {
    expect(hasFrappeResourceDataWrapper(
      { data: JSON.stringify({ select_pxfp: "Approved" }) },
      {},
    )).toBe(true);
    expect(hasFrappeResourceDataWrapper(
      {},
      { data: JSON.stringify({ select_pxfp: "Approved" }) },
    )).toBe(true);
    expect(hasFrappeResourceDataWrapper(
      { data: { select_pxfp: "Approved" } },
      {},
    )).toBe(true);
  });

  it("allows ordinary unwrapped resource payloads", () => {
    expect(hasFrappeResourceDataWrapper(
      { title: "Door Bracket Thickness Modification" },
      {},
    )).toBe(false);
  });

  it("finds ECR parent and protected-child doctypes inside bulk docs", () => {
    expect(requestDoctypesFromBodyOrQuery({
      docs: JSON.stringify([
        { doctype: "Engineering Change Request", name: "ECR-001" },
        { doctype: "ECR Approval", name: "TASK-001" },
      ]),
    }, {})).toEqual(["Engineering Change Request", "ECR Approval"]);
  });

  it("finds query-carried insert_many documents", () => {
    expect(requestDoctypesFromBodyOrQuery({}, {
      docs: JSON.stringify([{ doctype: "Engineering Change Request" }]),
    })).toContain("Engineering Change Request");
  });

  it("classifies comment and File attachment reference doctypes", () => {
    expect(requestDoctypesFromBodyOrQuery({
      doctype: "File",
      attached_to_doctype: "Engineering Change Request",
    }, {})).toEqual(["File", "Engineering Change Request"]);
    expect(requestDoctypesFromBodyOrQuery({
      reference_doctype: "Engineering Change Request",
    }, {})).toContain("Engineering Change Request");
  });
});
