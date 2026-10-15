import { createHash } from "node:crypto";
import type { ClmField, ClmRecord } from "../src/types/clm.js";
import { ClmError, parseClmData, rfqClmFinanceApproved } from "./clmCore.js";
import { clmErpRequest, createClmDependencies, listClmErp } from "./clmErp.js";
import type { ClmPurchaseOrderDeps } from "./clmPurchaseOrder.js";
import { assertRfqPurchaseOrderRequest } from "./rfqPurchaseOrderGuard.js";
import { assertRfqClmReadyForProcurement } from "./rfqClmCore.js";
import { assertSupplierAwardEligible } from "./supplierAwardEligibilityGuard.js";
import { readErpAuthConfig } from "./authSession.js";
import { fetchErpFile } from "./fileProxyCore.js";

export function createClmPurchaseOrderDependencies(): ClmPurchaseOrderDeps {
  const deps = createClmDependencies();
  return { ...deps,
    purchaseOrderFields: async () => {
      const [doctype, custom, setters] = await Promise.all([
        deps.load("DocType", "Purchase Order"), listClmErp("Custom Field", [["dt", "=", "Purchase Order"]]), listClmErp("Property Setter", [["doc_type", "=", "Purchase Order"]]),
      ]);
      const fields = [...new Map([...(Array.isArray(doctype.fields) ? doctype.fields : []), ...custom].map((field: ClmField) => [field.fieldname, { ...field }])).values()];
      for (const setter of setters) {
        const field = fields.find(row => row.fieldname === setter.field_name);
        if (field && ["unique", "options", "fieldtype"].includes(String(setter.property))) Object.assign(field, { [String(setter.property)]: setter.property === "unique" ? Number(setter.value) : setter.value });
      }
      return fields;
    },
    createOrder: doc => clmErpRequest("POST", "method/frappe.client.save", { doc: { ...doc, doctype: "Purchase Order" } }),
    submitOrder: doc => clmErpRequest("POST", "method/frappe.client.submit", { doc: { ...doc, doctype: "Purchase Order" } }),
    verifyIntegrity: async contract => {
      if (!rfqClmFinanceApproved(contract)) throw new ClmError("Contract Legal signature and Finance approval are required.", 409);
      const data = parseClmData(contract.custom_clm_data), cfg = readErpAuthConfig();
      const evidence = [data.locked_file as ClmRecord, ...data.signatures];
      for (const receipt of evidence) {
        if (!receipt?.file_id || !receipt.file_url || !receipt.hash) throw new ClmError("The approved Contract signature evidence is missing.", 409);
        const file = await fetchErpFile({ baseUrl: cfg.baseUrl, apiKey: cfg.key, apiSecret: cfg.secret, fileId: String(receipt.file_id), filePath: String(receipt.file_url),
          authorizeFile: async record => {
            if (record.name !== receipt.file_id || record.attached_to_doctype !== "Contract" || record.attached_to_name !== contract.name || record.file_url !== receipt.file_url || Number(record.is_private) !== 1) throw new ClmError("The signed Contract document is not attached to this Contract.", 409);
          } });
        if (!file.ok || file.contentType !== "application/pdf" || file.buffer.subarray(0, 4).toString() !== "%PDF" || createHash("sha256").update(file.buffer).digest("hex") !== receipt.hash) throw new ClmError("The immutable signed Contract PDF could not be verified. Procurement remains blocked.", 409);
      }
    },
    authorizeOrder: async (principal, doc, source) => {
      await assertRfqPurchaseOrderRequest({ apiPath: "method/frappe.client.save", method: "POST", principal, body: { doc },
        clmContext: { contractId: source.contract, rfqId: source.rfq, awardId: source.award, quotationId: source.quotation } }, {
        loadDocument: deps.load,
        listReviews: filters => listClmErp("Legal Document Review", filters),
        assertClmReady: rfq => assertRfqClmReadyForProcurement(rfq, deps),
        assertAwardEligible: selection => assertSupplierAwardEligible(selection),
        // A CLM-required award uses its Contract's Legal/Finance evidence. The
        // legacy RFQ review document remains unchanged by this branch.
        assertReady: async name => {
          if (name !== source.award || !rfqClmFinanceApproved(await deps.load("Contract", source.contract))) throw new ClmError("The linked Contract has not completed Legal signature and Finance approval.", 409);
        },
      });
    },
  };
}
