import { describe, it, expect, beforeEach, vi } from "vitest";

let mockDoc: Record<string, any> = {
  name: "BC-2026-00001",
  title: "Test Welding Robot",
  status: "Pending Approval",
  workflow_state: "Pending Finance Review",
  finance_status: "Pending",
  legal_status: "Pending",
  modified: "2026-08-17 11:44:26.420194",
  version: 1,
  capex: 350000,
  budget: 350000,
  project_duration: 5,
  discount_rate: 10,
  financial_calculation_status: "Calculated",
  business_justification: "Critical automation requirement",
  business_problem: "Capacity bottleneck at welding station",
  supporting_documents: [],
};

// Mock ERPNext API client
vi.mock("./erpnext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erpnext")>();
  return {
    ...actual,
    apiGet: vi.fn().mockImplementation((url: string) => {
      if (url.includes("User") || url.includes("Company") || url.includes("Employee") || url.includes("Department")) {
        return Promise.resolve([{ name: "MOCK-ID" }]);
      }
      if (url.includes("Business%20Need") || url.includes("Business Need")) {
        return Promise.resolve({
          data: {
            name: "BN-2026-00001",
            title: "Test Welding Robot",
            status: "Submitted",
            modified: "2026-08-17 11:44:26.420194",
            estimated_budget: 350000,
          },
        });
      }
      return Promise.resolve({
        data: { ...mockDoc },
      });
    }),
    apiPost: vi.fn().mockImplementation((url: string, payload: any) => {
      if (url.includes("set_value") && payload?.doctype === "Business Case") {
        if (payload?.fieldname) {
          Object.assign(mockDoc, payload.fieldname);
        }
      }
      return Promise.resolve({
        message: { ...mockDoc },
      });
    }),
    apiPut: vi.fn().mockResolvedValue({
      name: "BC-2026-00001",
      modified: "2026-08-17 11:44:26.420194",
    }),
    COMPANY: "Netlink",
    ERP_API_BASE_URL: "http://mock.erpnext",
  };
});

import {
  createBusinessNeed,
  saveBusinessNeedDraft,
  submitExistingBusinessNeedDraft,
  fetchBusinessCases,
  approveFinanceReview,
  rejectBusinessCaseAtFinance,
  requestFinanceRevision,
  approveLegalReview,
  rejectBusinessCaseAtLegal,
  requestLegalRevision,
  getPendingBusinessCasesForProcurement,
  linkRfqToBusinessCase,
  saveBusinessCaseFinancials,
} from "./businessIntake";

describe("Enterprise Business Intake Module — Public Interface & Flow Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Department User can create Business Need and initialize CAPEX & Financials", async () => {
    const need = await createBusinessNeed(
      {
        title: "Test Welding Robot",
        description: "Robotic welding cell needed for assembly",
        need_type: "Direct",
        priority: "High",
        company: "Netlink Industrial Solutions",
        department: "Manufacturing Engineering",
        problem_statement: "Capacity bottleneck at welding station",
        requester: "Jane Doe",
        requester_email: "jane.doe@netlink.com",
        business_owner: "Robert Miller",
        estimated_budget: 350000,
      },
      "jane.doe@netlink.com",
      "department",
      true
    );

    expect(need).toBeDefined();
    expect(need.title).toBe("Test Welding Robot");
  });

  it("2. Finance User can fetch Business Cases", async () => {
    const cases = await fetchBusinessCases();
    expect(cases).toBeDefined();
  });

  it("3. Finance User can calculate and save deterministic financials", async () => {
    const saved = await saveBusinessCaseFinancials("BC-2026-00001", {
      capex: 200000,
      opex: 20000,
      expected_annual_savings: 70000,
      revenue_increase: 30000,
      cost_avoidance: 10000,
      project_duration: 5,
      discount_rate: 10,
    });
    expect(saved).toBeDefined();
  });

  it("4. Finance User can approve Finance Review with complete checklist", async () => {
    const approved = await approveFinanceReview(
      "BC-2026-00001",
      "Approved",
      "finance@netlink.com",
      "finance",
      {
        budgetVerified: true,
        capexOpexVerified: true,
        financialAssumptionsReviewed: true,
        requiredDocumentsReviewed: true,
        requiredSignaturesVerified: true,
        businessJustificationReviewed: true,
        financialFeasibilityConfirmed: true,
      }
    );
    expect(approved).toBeDefined();
  });

  it("5. Finance User can reject or request revision", async () => {
    const rejected = await rejectBusinessCaseAtFinance("BC-2026-00001", "Budget too high", "finance@netlink.com", "finance");
    expect(rejected).toBeDefined();

    const revision = await requestFinanceRevision("BC-2026-00001", "Update payback period", "finance@netlink.com", "finance");
    expect(revision).toBeDefined();
  });

  it("6. Legal User can approve, reject, or request revision", async () => {
    mockDoc.status = "Pending Approval";
    mockDoc.workflow_state = "Pending Legal Review";
    mockDoc.finance_status = "Approved";
    mockDoc.finance_approved_by = "finance@netlink.com";
    mockDoc.finance_approved_on = "2026-08-18 10:15:43";
    mockDoc.legal_status = "Pending";

    const approved = await approveLegalReview("BC-2026-00001", "Terms acceptable", "legal@netlink.com", "legal");
    expect(approved).toBeDefined();

    const rejected = await rejectBusinessCaseAtLegal("BC-2026-00001", "IP dispute", "legal@netlink.com", "legal");
    expect(rejected).toBeDefined();

    const revision = await requestLegalRevision("BC-2026-00001", "Provide NDA", "legal@netlink.com", "legal");
    expect(revision).toBeDefined();
  });

  it("7. Procurement User can query queue and link RFQ", async () => {
    mockDoc.status = "Approved";
    mockDoc.workflow_state = "Procurement Ready";
    mockDoc.finance_status = "Approved";
    mockDoc.legal_status = "Approved";

    const queue = await getPendingBusinessCasesForProcurement();
    expect(queue).toBeDefined();

    const linked = await linkRfqToBusinessCase("BC-2026-00001", "RFQ-2026-0001", "procurement@netlink.com");
    expect(linked).toBeDefined();
  });

  it("8. Department User can save and update a Business Need Draft without creating Business Case", async () => {
    const draft = await saveBusinessNeedDraft(
      {
        title: "Draft Sensors",
        department: "Manufacturing Engineering",
        estimated_budget: 150000,
      },
      "jane.doe@netlink.com",
      "department"
    );
    expect(draft).toBeDefined();
    expect(draft.name).toBe("BN-2026-00001");
  });

  it("9. Department User can submit existing Draft and trigger Business Case generation", async () => {
    const submitted = await submitExistingBusinessNeedDraft(
      "BN-2026-00001",
      {
        title: "Draft Sensors Final",
        description: "High precision sensors for inspection",
        problem_statement: "Capacity bottleneck",
        business_justification: "Critical quality improvement",
        need_type: "Direct",
        priority: "High",
        company: "Netlink Industrial Solutions",
        department: "Manufacturing Engineering",
        business_owner: "Robert Miller",
        requester: "Jane Doe",
        requester_email: "jane.doe@netlink.com",
        estimated_budget: 150000,
      },
      "jane.doe@netlink.com",
      "department"
    );
    expect(submitted).toBeDefined();
  });
});
