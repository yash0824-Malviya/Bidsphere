import { describe, it } from "vitest";
import { getRfqClmSummary, getClmDetail } from "../api/clmCore";
import { rfqSourceDocumentProjection } from "../api/clm";
import { createEcrSchemaErpClient, ecrSchemaResource } from "../scripts/ecr-schema-erp-client.mjs";
import type { ClmDeps } from "../api/clmCore";
import type { AccessPrincipal } from "../api/rbacAuth";

describe("live inspection of CTRQ-2026-0008", () => {
  it("inspects summary and detail", async () => {
    const api = createEcrSchemaErpClient();
    const principal: AccessPrincipal = {
      typ: "internal",
      role: "procurement_team",
      sub: "procurement@netlink.com",
      email: "procurement@netlink.com",
    };
    const deps: ClmDeps = {
      load: async (doctype, name) => api("GET", ecrSchemaResource(doctype, name)),
      list: async (doctype, filters, fields) => {
        const query = new URLSearchParams();
        if (filters) query.set("filters", JSON.stringify(filters));
        if (fields) query.set("fields", JSON.stringify(fields));
        const res = await api("GET", `resource/${doctype}?${query.toString()}`);
        return res || [];
      },
      save: async () => {},
      create: async () => {},
      now: () => new Date().toISOString(),
    };

    const summary = await getRfqClmSummary(principal, "PUR-RFQ-2026-00112", deps);
    console.log("SUMMARY:", JSON.stringify(summary, null, 2));

    const request = await api("GET", ecrSchemaResource("Contract Request", "CTRQ-2026-0008"));
    console.log("REQUEST DOCSTATUS:", request.docstatus);
  });
});
