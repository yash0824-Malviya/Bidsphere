import { describe, expect, it } from "vitest";
import {
  getSupplierRFQStatus,
  findEffectiveQuotation,
  type RfqLike,
  type SupplierQuotationLike,
} from "./supplierRfqStatus";

describe("supplierRfqStatus resolver", () => {
  const baseRfq: RfqLike = {
    name: "PUR-RFQ-2026-00108",
    status: "Submitted",
    docstatus: 1,
    suppliers: [
      {
        supplier: '"Atlantic Precision Manufacturing."',
        quote_status: "Pending",
      },
    ],
  };

  it("Scenario 1: Supplier has never submitted quotation -> Awaiting Quotation / Continue Quotation", () => {
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotation: null,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Awaiting Quotation");
    expect(res.action).toBe("continue");
    expect(res.actionLabel).toBe("Continue Quotation");
    expect(res.tone).toBe("warning");
    expect(res.isReadOnly).toBe(false);
  });

  it("Scenario 2: Supplier saved draft -> Draft Quotation / Continue Quotation", () => {
    const draftQuote: SupplierQuotationLike = {
      name: "PUR-SQTN-2026-00288",
      supplier: '"Atlantic Precision Manufacturing."',
      status: "Draft",
      docstatus: 0,
      grand_total: 0,
    };
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotation: draftQuote,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Draft Quotation");
    expect(res.action).toBe("continue");
    expect(res.actionLabel).toBe("Continue Quotation");
    expect(res.tone).toBe("neutral");
    expect(res.isReadOnly).toBe(false);
    expect(res.effectiveQuotation?.name).toBe("PUR-SQTN-2026-00288");
  });

  it("Scenario 3: Supplier submitted quotation -> Quotation Submitted / View Details", () => {
    const submittedQuote: SupplierQuotationLike = {
      name: "PUR-SQTN-2026-00288",
      supplier: '"Atlantic Precision Manufacturing."',
      status: "Submitted",
      docstatus: 1,
      grand_total: 1500,
      valid_till: "2026-11-01",
    };
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotation: submittedQuote,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Quotation Submitted");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
    expect(res.tone).toBe("info");
    expect(res.isReadOnly).toBe(true);
  });

  it("Scenario 4: Procurement requests revision -> Revision Requested / Revise Quotation", () => {
    const revisionQuote: SupplierQuotationLike = {
      name: "PUR-SQTN-2026-00288",
      supplier: '"Atlantic Precision Manufacturing."',
      status: "Revision Requested",
      docstatus: 1,
      grand_total: 1500,
    };
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotation: revisionQuote,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Revision Requested");
    expect(res.action).toBe("revise");
    expect(res.actionLabel).toBe("Revise Quotation");
    expect(res.tone).toBe("warning");
    expect(res.isReadOnly).toBe(false);
  });

  it("Scenario 5: Quotation under review -> Under Review / View Details", () => {
    const reviewQuote: SupplierQuotationLike = {
      name: "PUR-SQTN-2026-00288",
      supplier: '"Atlantic Precision Manufacturing."',
      status: "Under Review",
      docstatus: 1,
      grand_total: 1500,
    };
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotation: reviewQuote,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Under Review");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
    expect(res.tone).toBe("info");
    expect(res.isReadOnly).toBe(true);
  });

  it("Scenario 6: Supplier gets awarded -> Awarded / View Details", () => {
    const awardedRfq: RfqLike = {
      ...baseRfq,
      status: "Awarded",
      award_supplier: '"Atlantic Precision Manufacturing."',
    };
    const submittedQuote: SupplierQuotationLike = {
      name: "PUR-SQTN-2026-00288",
      supplier: '"Atlantic Precision Manufacturing."',
      status: "Accepted",
      docstatus: 1,
      grand_total: 1500,
    };
    const res = getSupplierRFQStatus({
      rfq: awardedRfq,
      quotation: submittedQuote,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Awarded");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
    expect(res.tone).toBe("awarded");
    expect(res.isReadOnly).toBe(true);
  });

  it("Scenario 7a: RFQ closed without award -> Closed / View Details", () => {
    const closedRfq: RfqLike = {
      ...baseRfq,
      status: "Closed",
    };
    const res = getSupplierRFQStatus({
      rfq: closedRfq,
      quotation: null,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Closed");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
    expect(res.tone).toBe("closed");
    expect(res.isReadOnly).toBe(true);
  });

  it("Scenario 7b: Supplier explicitly declined -> Closed / View Details", () => {
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      declined: true,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Closed");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
    expect(res.tone).toBe("closed");
  });

  it("Edge Case: Multiple quotations (Draft + Submitted) selects effective submitted state", () => {
    const quotes: SupplierQuotationLike[] = [
      {
        name: "PUR-SQTN-2026-00288",
        supplier: '"Atlantic Precision Manufacturing."',
        status: "Draft",
        docstatus: 0,
        modified: "2026-10-06 10:00:00",
      },
      {
        name: "PUR-SQTN-2026-00287",
        supplier: '"Atlantic Precision Manufacturing."',
        status: "Submitted",
        docstatus: 1,
        modified: "2026-10-05 10:00:00",
      },
    ];

    const effective = findEffectiveQuotation(
      quotes,
      '"Atlantic Precision Manufacturing."',
    );
    expect(effective?.name).toBe("PUR-SQTN-2026-00288");

    // With prior submitted quote and a new draft, it is treated as revision in progress
    const res = getSupplierRFQStatus({
      rfq: baseRfq,
      quotations: quotes,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Revision Requested");
  });

  it("Corroborating signal: RFQ supplier row has quote_status 'Received'", () => {
    const rfqWithReceived: RfqLike = {
      name: "PUR-RFQ-2026-00108",
      status: "Submitted",
      docstatus: 1,
      suppliers: [
        {
          supplier: '"Atlantic Precision Manufacturing."',
          quote_status: "Received",
        },
      ],
    };
    const res = getSupplierRFQStatus({
      rfq: rfqWithReceived,
      supplierId: '"Atlantic Precision Manufacturing."',
    });
    expect(res.status).toBe("Quotation Submitted");
    expect(res.action).toBe("details");
    expect(res.actionLabel).toBe("View Details");
  });
});
