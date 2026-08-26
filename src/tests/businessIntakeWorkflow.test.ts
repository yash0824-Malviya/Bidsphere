import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBusinessNeedInErp,
  submitBusinessNeedInErp,
  updateBusinessNeedLatest,
  createBusinessCaseInErp,
  approveFinanceInErp,
  approveLegalInErp,
  linkRfqToBusinessCaseInErp,
} from "../api/businessIntakeErp";
import { createBusinessNeed } from "../api/businessIntake";

// Mock the core ERPNext API client methods
vi.mock("../api/erpnext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/erpnext")>();
  return {
    ...actual,
    apiGet: vi.fn().mockImplementation((url) => {
      if (url.includes("User") || url.includes("Company") || url.includes("Employee") || url.includes("Department")) {
        return Promise.resolve([{ name: "MOCK-ID" }]);
      }
      return Promise.resolve({
        name: "MOCK-DOC",
        status: "Draft",
        modified: "2026-08-17 11:44:26.420194",
        version: 1,
      });
    }),
    apiPost: vi.fn().mockResolvedValue({ name: "MOCK-DOC", modified: "2026-08-17 11:44:26.420194" }),
    apiPut: vi.fn().mockResolvedValue({ name: "MOCK-DOC", modified: "2026-08-17 11:44:26.420194" }),
    COMPANY: "Netlink",
    ERP_API_BASE_URL: "http://mock.erpnext",
  };
});

import { apiPost, apiGet } from "../api/erpnext";

describe("Business Intake Workflow - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Business Need Creation & Safe Submission", () => {
    it("should create a draft Business Need and fetch the latest document", async () => {
      const result = await createBusinessNeedInErp({ title: "Test Need" } as any, "user@test.com");
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.save", expect.any(Object));
      expect(result.name).toBe("MOCK-DOC");
      // Must fetch fresh document after creation/attachments
      expect(apiGet).toHaveBeenCalled();
    });

    it("should submit a Business Need with latest modified timestamp", async () => {
      await submitBusinessNeedInErp("BN-001");
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.submit", {
        doc: {
          doctype: "Business Need",
          name: "BN-001",
          modified: expect.any(String),
        },
      });
    });

    it("should safely update latest document atomically via updateBusinessNeedLatest", async () => {
      const updated = await updateBusinessNeedLatest("BN-001", {
        status: "Submitted",
        business_case: "BC-001",
      });

      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.set_value", {
        doctype: "Business Need",
        name: "BN-001",
        fieldname: {
          status: "Submitted",
          business_case: "BC-001",
        },
      });
      expect(updated.name).toBe("MOCK-DOC");
    });

    it("should handle concurrency conflicts gracefully by refetching and retrying", async () => {
      let callCount = 0;
      vi.mocked(apiPost).mockImplementationOnce((url) => {
        if (url.includes("set_value")) {
          callCount++;
          const err: any = new Error("TimestampMismatchError: Document has been modified after you have opened it");
          err.response = {
            status: 417,
            data: { message: "Document BN-001 has been modified after you have opened it" },
          };
          return Promise.reject(err);
        }
        return Promise.resolve({ name: "MOCK-DOC" });
      });

      const res = await updateBusinessNeedLatest("BN-001", { status: "Submitted" });
      expect(res.name).toBe("MOCK-DOC");
      expect(apiPost).toHaveBeenCalledTimes(2); // Initial failed attempt + successful retry
    });
  });

  describe("2. Complete createBusinessNeed flow with Business Case auto-linking", () => {
    it("should create Business Need, create Business Case, link Business Case, and return persisted state", async () => {
      const finalDoc = await createBusinessNeed(
        {
          title: "New High Precision Sensor",
          description: "High Precision Optical Laser Sensor",
          company: "Netlink",
          department: "Manufacturing Engineering",
          need_type: "Direct",
          priority: "High",
          problem_statement: "Need sensor replacement",
          requester: "engineer@netlink.com",
          requester_email: "engineer@netlink.com",
          business_owner: "Lead Engineer",
          estimated_budget: 25000,
        },
        "engineer@netlink.com",
        "department",
        true,
      );

      expect(finalDoc).toBeDefined();
      expect(finalDoc.name).toBe("MOCK-DOC");
      // Atomic set_value must link the Business Case
      expect(apiPost).toHaveBeenCalledWith(
        "/api/method/frappe.client.set_value",
        expect.objectContaining({
          doctype: "Business Need",
          name: "MOCK-DOC",
          fieldname: expect.objectContaining({
            status: "Submitted",
            business_case: "MOCK-DOC",
          }),
        }),
      );
    });
  });

  describe("3. Business Case Creation", () => {
    it("should create a Business Case linked to Business Need", async () => {
      await createBusinessCaseInErp({ name: "BN-001", title: "Test Title" } as any);
      
      // Asserts that frappe.client.save is called with the correct doc fields
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.save", expect.objectContaining({
        doc: expect.objectContaining({
          doctype: "Business Case",
          business_need: "BN-001",
        })
      }));
    });
  });

  describe("4. Finance Workflow & Gate Validation", () => {
    it("should block approval if budget is 0 or missing", async () => {
      const { validateFinanceGateInErp } = await import("../api/businessIntakeErp");

      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 0,
          business_justification: "Test justification",
        },
      });

      const res = await validateFinanceGateInErp("BC-001");
      expect(res.canApprove).toBe(false);
      expect(res.blockers.some((b) => b.code === "MISSING_BUDGET")).toBe(true);
    });

    it("should block approval if digital signature is pending", async () => {
      const { validateFinanceGateInErp } = await import("../api/businessIntakeErp");

      // 1. Business Case doc
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 25000,
          business_justification: "Valid justification",
        },
      });

      // 2. Business Case files with pending signature
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-001",
            file_name: "Finance_Approval_Memo.pdf",
            file_url: "/private/files/memo.pdf",
            signature_required: 1,
            signature_status: "Pending",
          },
        ],
      });

      const res = await validateFinanceGateInErp("BC-001");
      expect(res.canApprove).toBe(false);
      expect(res.blockers.some((b) => b.code === "SIGNATURE_PENDING")).toBe(true);
    });

    it("should calculate and persist financial assumptions to ERPNext via saveBusinessCaseFinancialsInErp", async () => {
      const { saveBusinessCaseFinancialsInErp } = await import("../api/businessIntakeErp");

      // 1. GET latest Business Case
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 200000,
        },
      });

      // 2. Mock frappe.client.set_value
      vi.mocked(apiPost).mockResolvedValueOnce({
        message: "success",
      });

      // 3. Mock re-fetch fetchBusinessCaseByIdFromErp
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          capex: 200000,
          budget: 200000,
          total_investment: 200000,
          annual_gross_benefit: 110000,
          annual_net_benefit: 90000,
          total_net_benefit: 450000,
          net_project_gain: 250000,
          roi: 125,
          roi_formatted: "125.0%",
          financial_calculation_status: "Calculated",
        },
      });

      // 4. File attachments query for re-fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [],
      });

      const updated = await saveBusinessCaseFinancialsInErp("BC-001", {
        capex: 200000,
        opex: 20000,
        expected_annual_savings: 70000,
        revenue_increase: 30000,
        cost_avoidance: 10000,
        project_duration: 5,
        discount_rate: 10,
      });

      expect(updated).toBeDefined();
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.set_value", expect.objectContaining({
        doctype: "Business Case",
        name: "BC-001",
        fieldname: expect.objectContaining({
          capex: 200000,
          total_investment: 200000,
          annual_net_benefit: 90000,
          roi: 125,
          financial_calculation_status: "Calculated",
        }),
      }));
    });

    it("should approve finance and advance to Legal Review when all criteria pass", async () => {
      // 1. Initial fetchBusinessCaseByIdFromErp
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 25000,
          capex: 25000,
          project_duration: 5,
          discount_rate: 10,
          financial_calculation_status: "Calculated",
          business_justification: "Valid justification",
          business_problem: "Capacity bottleneck",
        },
      });
      // Attached files for initial fetch
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      // 2. updateBusinessCaseStatus -> version fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          version: 1,
        },
      });

      // 3. updateBusinessCaseStatus -> final fetch doc
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Legal Review",
          finance_status: "Approved",
          budget: 25000,
          capex: 25000,
        },
      });
      // Attached files for final fetch
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await approveFinanceInErp("BC-001", "LGTM", "finance@test.com", "finance", {
        budgetVerified: true,
        capexOpexVerified: true,
        financialAssumptionsReviewed: true,
        requiredDocumentsReviewed: true,
        requiredSignaturesVerified: true,
        businessJustificationReviewed: true,
        financialFeasibilityConfirmed: true,
      });

      // Uses atomic set_value for workflow_state and status
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.set_value", expect.objectContaining({
        doctype: "Business Case",
        name: "BC-001",
        fieldname: expect.objectContaining({
          workflow_state: "Pending Legal Review",
          status: "Pending Approval",
          finance_status: "Approved",
        }),
      }));
    });

    it("should reject Finance approval if user lacks finance permission", async () => {
      await expect(
        approveFinanceInErp("BC-001", "LGTM", "buyer@test.com", "buyer", {
          budgetVerified: true,
          capexOpexVerified: true,
          financialAssumptionsReviewed: true,
          requiredDocumentsReviewed: true,
          requiredSignaturesVerified: true,
          businessJustificationReviewed: true,
          financialFeasibilityConfirmed: true,
        }),
      ).rejects.toThrow("You do not have permission to approve the Finance Gate.");
    });

    it("should block Finance approval if Business Justification is missing", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 200000,
          capex: 200000,
          project_duration: 5,
          discount_rate: 10,
          financial_calculation_status: "Calculated",
          business_problem: "Valid problem statement",
          business_justification: "",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveFinanceInErp("BC-001", "LGTM", "finance@test.com", "finance", {
          budgetVerified: true,
          capexOpexVerified: true,
          financialAssumptionsReviewed: true,
          requiredDocumentsReviewed: true,
          requiredSignaturesVerified: true,
          businessJustificationReviewed: true,
          financialFeasibilityConfirmed: true,
        }),
      ).rejects.toThrow("Business Justification is required.");
    });

    it("should block Finance approval if checklist is incomplete", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Finance Review",
          budget: 200000,
          capex: 200000,
          project_duration: 5,
          discount_rate: 10,
          financial_calculation_status: "Calculated",
          business_problem: "Valid problem",
          business_justification: "Valid justification",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveFinanceInErp("BC-001", "LGTM", "finance@test.com", "finance", {
          budgetVerified: true,
          capexOpexVerified: false, // Incomplete
          financialAssumptionsReviewed: true,
          requiredDocumentsReviewed: true,
          requiredSignaturesVerified: true,
          businessJustificationReviewed: true,
          financialFeasibilityConfirmed: true,
        }),
      ).rejects.toThrow("Finance Checklist: CAPEX/OPEX breakdown not verified");
    });

    it("should prevent duplicate Finance approval when already approved", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          status: "Pending Legal Review",
          finance_status: "Approved",
          budget: 200000,
          capex: 200000,
          project_duration: 5,
          discount_rate: 10,
          financial_calculation_status: "Calculated",
          business_problem: "Valid problem",
          business_justification: "Valid justification",
        },
      });

      await expect(
        approveFinanceInErp("BC-001", "LGTM", "finance@test.com", "finance", {
          budgetVerified: true,
          capexOpexVerified: true,
          financialAssumptionsReviewed: true,
          requiredDocumentsReviewed: true,
          requiredSignaturesVerified: true,
          businessJustificationReviewed: true,
          financialFeasibilityConfirmed: true,
        }),
      ).rejects.toThrow("Finance Gate is already approved.");
    });
  });

  describe("5. Legal Workflow", () => {
    it("should block Legal approval if Finance is Pending", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Finance Review",
          status: "Pending Approval",
          finance_status: "Pending",
          legal_status: "Pending",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveLegalInErp("BC-001", "Legal OK", "legal@test.com", "legal"),
      ).rejects.toThrow("Business Case is not currently in Pending Legal Review");
    });

    it("should block Legal approval if Finance Gate is not Approved", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Legal Review",
          status: "Pending Approval",
          finance_status: "Pending",
          legal_status: "Pending",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveLegalInErp("BC-001", "Legal OK", "legal@test.com", "legal"),
      ).rejects.toThrow("Legal approval is blocked because Finance approval is incomplete.");
    });

    it("should block Legal approval if Finance approver info is missing", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Legal Review",
          status: "Pending Approval",
          finance_status: "Approved",
          finance_approved_by: "",
          finance_approved_on: "",
          legal_status: "Pending",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveLegalInErp("BC-001", "Legal OK", "legal@test.com", "legal"),
      ).rejects.toThrow("Finance approver information or approval timestamp is missing");
    });

    it("should block duplicate Legal approval if already Approved", async () => {
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Legal Review",
          status: "Pending Approval",
          finance_status: "Approved",
          finance_approved_by: "finance@test.com",
          finance_approved_on: "2026-08-18 10:15:43",
          legal_status: "Approved",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await expect(
        approveLegalInErp("BC-001", "Legal OK", "legal@test.com", "legal"),
      ).rejects.toThrow("Legal Gate is already approved.");
    });

    it("should approve legal and advance to Pending Procurement with all audit fields", async () => {
      // 1. Initial fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Legal Review",
          status: "Pending Approval",
          finance_status: "Approved",
          finance_approved_by: "finance@test.com",
          finance_approved_on: "2026-08-18 10:15:43",
          legal_status: "Pending",
          budget: 25000,
          capex: 25000,
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      // 2. updateBusinessCaseStatus version fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: { name: "BC-001", version: 1 },
      });

      // 3. Final fetch doc
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Pending Procurement",
          status: "Pending Approval",
          finance_status: "Approved",
          legal_status: "Approved",
          legal_approved_by: "legal@test.com",
          legal_approved_on: "2026-08-18 10:17:09",
          legal_comments: "Terms acceptable and NDA verified.",
          budget: 25000,
          capex: 25000,
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await approveLegalInErp("BC-001", "Terms acceptable and NDA verified.", "legal@test.com", "legal");

      // Verify set_value call
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.set_value", expect.objectContaining({
        doctype: "Business Case",
        name: "BC-001",
        fieldname: expect.objectContaining({
          workflow_state: "Pending Procurement",
          status: "Pending Approval",
          legal_status: "Approved",
          legal_approved_by: "legal@test.com",
          legal_comments: "Terms acceptable and NDA verified.",
        }),
      }));

      // Verify approval history insert call
      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.insert", expect.objectContaining({
        doc: expect.objectContaining({
          doctype: "Business Case Approval",
          stage: "Legal",
          approver: "legal@test.com",
          status: "Approved",
          comments: "Terms acceptable and NDA verified.",
        }),
      }));
    });
  });

  describe("6. Procurement / RFQ Linkage", () => {
    it("should link RFQ and update status to RFQ Created", async () => {
      // 1. Initial fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "Procurement Ready",
          status: "Approved",
          finance_status: "Approved",
          legal_status: "Approved",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      // 2. updateBusinessCaseStatus version fetch
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: { name: "BC-001", version: 1 },
      });

      // 3. Final fetch doc
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-001",
          workflow_state: "RFQ Created",
          status: "Closed",
          rfq_id: "RFQ-123",
        },
      });
      vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

      await linkRfqToBusinessCaseInErp("BC-001", "RFQ-123");

      expect(apiPost).toHaveBeenCalledWith("/api/method/frappe.client.set_value", expect.objectContaining({
        doctype: "Business Case",
        name: "BC-001",
        fieldname: expect.objectContaining({
          workflow_state: "RFQ Created",
          status: "Closed",
          rfq_id: "RFQ-123",
        }),
      }));
    });
  });

  describe("7. Document Attachment Querying & Business Case Propagation", () => {
    it("should query ERPNext File records and format IntakeAttachment items properly", async () => {
      const { fetchAttachedFilesFromErp } = await import("../api/businessIntakeErp");

      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-001",
            file_name: "Sensor_Specs.pdf",
            file_url: "/private/files/Sensor_Specs.pdf",
            file_size: 1048576,
            creation: "2026-08-17 11:44:26",
          },
        ],
      });

      const files = await fetchAttachedFilesFromErp("Business Need", "BN-001");
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("Sensor_Specs.pdf");
      expect(files[0].type).toBe("PDF");
      expect(files[0].size).toBe("1.0 MB");
      expect(files[0].url).toContain("/api/file-proxy");
    });

    it("should propagate attachments through the trusted identifier-only File link endpoint", async () => {
      const { propagateBusinessNeedFilesToBusinessCase } = await import("../api/businessIntakeErp");

      // 1st call: Need files query
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-001",
            file_name: "Tech_Spec.pdf",
            file_url: "/private/files/Tech_Spec.pdf",
            file_size: 512000,
            is_private: 1,
          },
          {
            name: "FILE-002",
            file_name: "Budget_Sheet.xlsx",
            file_url: "/private/files/Budget_Sheet.xlsx",
            file_size: 204800,
            is_private: 1,
          },
        ],
      });

      // 2nd call: Final fetchAttachedFilesFromErp. Duplicate detection and
      // replay are authoritative on /api/file-link-copy, not in the browser.
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-CASE-001",
            file_name: "Tech_Spec.pdf",
            file_url: "/private/files/Tech_Spec.pdf",
            file_size: 512000,
          },
          {
            name: "FILE-CASE-002",
            file_name: "Budget_Sheet.xlsx",
            file_url: "/private/files/Budget_Sheet.xlsx",
            file_size: 204800,
          },
        ],
      });

      const propagated = await propagateBusinessNeedFilesToBusinessCase("BN-001", "BC-2026-00003");

      expect(apiPost).toHaveBeenNthCalledWith(1, "/api/file-link-copy", {
        source_file_name: "FILE-001",
        target_doctype: "Business Case",
        target_docname: "BC-2026-00003",
      });
      expect(apiPost).toHaveBeenNthCalledWith(2, "/api/file-link-copy", {
        source_file_name: "FILE-002",
        target_doctype: "Business Case",
        target_docname: "BC-2026-00003",
      });
      expect(apiPost).not.toHaveBeenCalledWith(
        "/api/method/frappe.client.insert",
        expect.anything(),
      );

      expect(propagated).toHaveLength(2);
    });

    it("should hydrate supporting_documents and budget on fetchBusinessCaseByIdFromErp", async () => {
      const { fetchBusinessCaseByIdFromErp } = await import("../api/businessIntakeErp");

      // 1. Case doc GET
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BC-2026-00003",
          business_need: "BN-001",
          status: "Pending Finance Review",
          budget: 0,
        },
      });

      // 2. Case File records GET
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-001",
            file_name: "Architecture.pdf",
            file_url: "/private/files/Architecture.pdf",
            file_size: 102400,
          },
        ],
      });

      // 3. Linked Need doc GET
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: {
          name: "BN-001",
          title: "Plant Automation",
          estimated_budget: 25000,
          currency: "USD",
          status: "Submitted",
        },
      });

      // 4. Linked Need Files GET (from fetchBusinessNeedByIdFromErp)
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [],
      });

      // 5. Need File records GET (from fetchBusinessCaseByIdFromErp propagation check)
      vi.mocked(apiGet).mockResolvedValueOnce({
        data: [
          {
            name: "FILE-001",
            file_name: "Architecture.pdf",
            file_url: "/private/files/Architecture.pdf",
            file_size: 102400,
          },
        ],
      });

      const bc = await fetchBusinessCaseByIdFromErp("BC-2026-00003");
      expect(bc).toBeDefined();
      expect(bc?.budget).toBe(25000);
      expect(bc?.supporting_documents).toHaveLength(1);
      expect(bc?.supporting_documents[0].name).toBe("Architecture.pdf");
      expect(bc?.documents).toHaveLength(1);
    });
  });
});
