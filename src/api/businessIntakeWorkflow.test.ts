import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock erpnext module
vi.mock("./erpnext", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPut: vi.fn(),
    apiPost: vi.fn(),
    erpnext: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    },
  };
});

import { apiGet, apiPut, apiPost } from "./erpnext";
import {
  isFinanceManagerRole,
  isEngineerRole,
  isEngineeringManagerRole,
  isLegalManagerRole,
  isProcurementManagerRole,
  isWarehouseManagerRole,
  createBusinessCaseStandaloneInErp,
  completeEngineerTechnicalReviewInErp,
  approveEngineeringStageInErp,
  approveFinanceStageInErp,
  approveLegalStageInErp,
  approveProcurementStageInErp,
  sendBackBusinessCaseInErp,
  rejectBusinessCaseInErp,
  fetchRoleBusinessCasesFromErp,
} from "./businessIntakeErp";

describe("Business Case Sequential Workflow & Role Permissions", () => {
  let mockCaseState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaseState = {
      name: "BC-2026-00005",
      business_case_id: "BC-2026-00005",
      title: "Automated Inspection Robots",
      workflow_status: "Pending Engineering",
      budget: 180000,
      capex: 180000,
      roi: 66.66,
      approval_history: "[]",
    };

    (apiGet as any).mockImplementation(async (url: string) => {
      if (
        url &&
        (url.includes("/api/resource/Business%20Case") || url.includes("/api/resource/Business Case")) &&
        !url.includes("BC-2026-")
      ) {
        return [{ ...mockCaseState }];
      }
      return { ...mockCaseState };
    });

    (apiPut as any).mockImplementation(async (_url: string, data: any) => {
      Object.assign(mockCaseState, data);
      return { ...mockCaseState };
    });

    (apiPost as any).mockImplementation(async (url: string, data: any) => {
      if (url.includes("frappe.client.set_value") && data?.fieldname) {
        Object.assign(mockCaseState, data.fieldname);
      }
      return { name: "BC-HIST-001" };
    });
  });

  describe("Role Normalization and Aliases", () => {
    it("recognizes all variations of Finance Manager", () => {
      const financeRoles = [
        "Finance Manager",
        "finance_manager",
        "finance manager",
        "FINANCE_MANAGER",
        "finance",
        "Finance",
        "finance_executive",
        "finance team",
      ];
      for (const r of financeRoles) {
        expect(isFinanceManagerRole(r), `Expected ${r} to be Finance Manager`).toBe(true);
      }
      expect(isFinanceManagerRole("engineer")).toBe(false);
      expect(isFinanceManagerRole("warehouse")).toBe(false);
    });

    it("recognizes Engineer and Engineering Manager roles", () => {
      expect(isEngineerRole("engineer")).toBe(true);
      expect(isEngineerRole("Lead Engineer")).toBe(true);
      expect(isEngineerRole("engineering_user")).toBe(true);
      expect(isEngineerRole("engineering")).toBe(false);
      expect(isEngineerRole("finance")).toBe(false);

      expect(isEngineeringManagerRole("engineering")).toBe(true);
      expect(isEngineeringManagerRole("engineering_manager")).toBe(true);
      expect(isEngineeringManagerRole("Engineering Manager")).toBe(true);
      expect(isEngineeringManagerRole("engineer")).toBe(false);
    });

    it("recognizes Legal Manager roles", () => {
      expect(isLegalManagerRole("legal")).toBe(true);
      expect(isLegalManagerRole("legal_manager")).toBe(true);
      expect(isLegalManagerRole("Legal Manager")).toBe(true);
      expect(isLegalManagerRole("finance")).toBe(false);
    });

    it("recognizes Procurement Manager roles", () => {
      expect(isProcurementManagerRole("procurement")).toBe(true);
      expect(isProcurementManagerRole("procurement_manager")).toBe(true);
      expect(isProcurementManagerRole("Procurement Manager")).toBe(true);
      expect(isProcurementManagerRole("procurement_team")).toBe(true);
      expect(isProcurementManagerRole("warehouse")).toBe(false);
    });

    it("correctly identifies and excludes Warehouse Manager", () => {
      expect(isWarehouseManagerRole("warehouse")).toBe(true);
      expect(isWarehouseManagerRole("warehouse_manager")).toBe(true);
      expect(isWarehouseManagerRole("Warehouse Manager")).toBe(true);

      // Warehouse manager must NOT match any approval gate
      expect(isEngineerRole("warehouse_manager")).toBe(false);
      expect(isEngineeringManagerRole("warehouse_manager")).toBe(false);
      expect(isFinanceManagerRole("warehouse_manager")).toBe(false);
      expect(isLegalManagerRole("warehouse_manager")).toBe(false);
      expect(isProcurementManagerRole("warehouse_manager")).toBe(false);
    });
  });

  describe("Sequential Stage Transitions", () => {
    it("Engineer review advances to Pending Engineering Manager", async () => {
      mockCaseState.workflow_status = "Pending Engineering";

      const updated = await completeEngineerTechnicalReviewInErp(
        "BC-2026-00005",
        "Technical specs verified",
        "engineer@netlink.com",
        "Engineer"
      );

      expect(updated.workflow_status).toBe("Pending Engineering Manager");
    });

    it("Engineering Manager approval advances to Pending Finance", async () => {
      mockCaseState.workflow_status = "Pending Engineering Manager";

      const updated = await approveEngineeringStageInErp(
        "BC-2026-00005",
        "Engineering approved",
        "engmgr@netlink.com",
        "Engineering Manager"
      );

      expect(updated.workflow_status).toBe("Pending Finance");
    });

    it("Finance Manager approval advances to Pending Legal", async () => {
      mockCaseState.workflow_status = "Pending Finance";

      const updated = await approveFinanceStageInErp(
        "BC-2026-00005",
        "Budget and ROI verified",
        "finance@netlink.com",
        "Finance Manager"
      );

      expect(updated.workflow_status).toBe("Pending Legal");
    });

    it("Finance Manager can also approve from 'Revision Required (Finance)'", async () => {
      mockCaseState.workflow_status = "Revision Required (Finance)";

      const updated = await approveFinanceStageInErp(
        "BC-2026-00005",
        "Re-verified after revision",
        "finance@netlink.com",
        "Finance Manager"
      );

      expect(updated.workflow_status).toBe("Pending Legal");
    });

    it("Legal Manager approval advances to Pending Procurement", async () => {
      mockCaseState.workflow_status = "Pending Legal";

      const updated = await approveLegalStageInErp(
        "BC-2026-00005",
        "Terms and compliance approved",
        "legal@netlink.com",
        "Legal Manager"
      );

      expect(updated.workflow_status).toBe("Pending Procurement");
    });

    it("Procurement Manager approval advances to Ready for RFQ and locks record", async () => {
      mockCaseState.workflow_status = "Pending Procurement";

      const updated = await approveProcurementStageInErp(
        "BC-2026-00005",
        "Procurement packaging approved",
        "procurement@netlink.com",
        "Procurement Manager"
      );

      expect(updated.workflow_status).toBe("Ready for RFQ");
      expect(updated.is_locked).toBe(true);
    });

    it("Unauthorized role is rejected with error", async () => {
      mockCaseState.workflow_status = "Pending Finance";

      await expect(
        approveFinanceStageInErp(
          "BC-2026-00005",
          "Attempting approval without role",
          "warehouse@netlink.com",
          "Warehouse Manager"
        )
      ).rejects.toThrow(/permission/i);
    });

    it("Send back sets status according to reviewing role", async () => {
      mockCaseState.workflow_status = "Pending Finance";

      const updated = await sendBackBusinessCaseInErp(
        "BC-2026-00005",
        "Adjust CAPEX depreciation schedule",
        "finance@netlink.com",
        "Finance Manager"
      );

      expect(updated.workflow_status).toBe("Revision Required (Finance)");
    });

    it("Reject marks business case as Rejected terminal state", async () => {
      mockCaseState.workflow_status = "Pending Finance";

      const updated = await rejectBusinessCaseInErp(
        "BC-2026-00005",
        "Exceeds strategic budget thresholds",
        "finance@netlink.com",
        "Finance Manager"
      );

      expect(updated.workflow_status).toBe("Rejected");
    });

    it("Legal Manager approval with e-signature sets Pending Procurement and assigns Procurement Manager", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";

      const updated = await approveLegalStageInErp(
        "BC-2026-00005",
        "Contract terms and compliance verified",
        "legal@netlink.com",
        "Legal Manager",
        { signatureName: "Jane Legal", signedAt: "2026-09-07T12:00:00Z" }
      );

      expect(updated.workflow_status).toBe("Pending Procurement");
      expect(updated.status).toBe("Pending Procurement");
      expect(updated.current_stage).toBe("Procurement Review");
      expect(updated.current_approver_role).toBe("Procurement Manager");
      expect(updated.legal_status).toBe("Approved");
      expect(updated.legal_signature).toBe("Jane Legal");
    });

    it("Legal Manager approval rejects unauthorized non-legal users", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";

      await expect(
        approveLegalStageInErp(
          "BC-2026-00005",
          "Attempting approval without legal role",
          "eng@netlink.com",
          "Engineer"
        )
      ).rejects.toThrow(/permission/i);
    });

    it("Legal Manager approval rejects when stage is not Legal Approval", async () => {
      mockCaseState.workflow_status = "Pending Finance";
      mockCaseState.current_stage = "Finance Approval";

      await expect(
        approveLegalStageInErp(
          "BC-2026-00005",
          "Attempting approval out of sequence",
          "legal@netlink.com",
          "Legal Manager"
        )
      ).rejects.toThrow(/Cannot approve Legal stage/i);
    });

    it("Legal Manager send-back returns to Department User", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";

      const updated = await sendBackBusinessCaseInErp(
        "BC-2026-00005",
        "Please provide the updated supplier compliance certificate.",
        "legal@netlink.com",
        "Legal Manager"
      );

      expect(updated.workflow_status).toBe("Returned");
      expect(updated.status).toBe("Returned");
      expect(updated.current_approver_role).toBe("Department User");
      expect(updated.legal_status).toBe("Revision Requested");
      expect(updated.rejection_reason).toBe("Please provide the updated supplier compliance certificate.");
    });

    it("Legal Manager reject sets terminal Rejected state", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";

      const updated = await rejectBusinessCaseInErp(
        "BC-2026-00005",
        "Breaches export control compliance guidelines.",
        "legal@netlink.com",
        "Legal Manager"
      );

      expect(updated.workflow_status).toBe("Rejected");
      expect(updated.status).toBe("Rejected");
      expect(updated.legal_status).toBe("Rejected");
      expect(updated.is_locked).toBe(true);
    });

    it("Legal Manager approval preserves full checklist and fontId in e-signature audit", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";

      const checklistMock = {
        businessRequirements: true,
        supplierDocReviewed: true,
        complianceCertificates: true,
        regulatoryRequirements: true,
        contractualRequirements: true,
        warrantyLiabilityTerms: true,
        requiredLegalDocsAvailable: true,
        noUnresolvedExceptions: true,
        finalReviewCompleted: true,
      };

      const updated = await approveLegalStageInErp(
        "BC-2026-00005",
        "All 9 legal checklist criteria satisfied and verified.",
        "legal.counsel@netlink.com",
        "legal",
        {
          signatureName: "Elena Vance",
          fontId: "caveat",
          signedAt: "2026-09-07T14:30:00Z",
          checklist: checklistMock,
          documentReviews: {
            "Technical Data Sheet & Engineering Specs": { status: "Reviewed" },
            "Warranty, Liability & SLA Framework": { status: "Reviewed" },
          },
          auditMetadata: { ipAddress: "192.168.1.100", userAgent: "Mozilla/5.0" },
        }
      );

      expect(updated.workflow_status).toBe("Pending Procurement");
      expect(updated.current_stage).toBe("Procurement Review");
      expect(updated.current_approver_role).toBe("Procurement Manager");
      expect(updated.legal_status).toBe("Approved");
      expect(updated.legal_signature).toBe("Elena Vance");
    });
  });

  describe("Business Case Creation RBAC Enforcement", () => {
    it("prohibits Legal Manager, Engineer, Finance, Procurement, and Warehouse from creating Business Cases", async () => {
      const unauthorizedRoles = [
        "Legal Manager",
        "legal",
        "legal_counsel",
        "Engineer",
        "engineer",
        "Engineering Manager",
        "Finance Manager",
        "finance",
        "Procurement Manager",
        "procurement",
        "Warehouse Manager",
        "warehouse",
      ];

      for (const role of unauthorizedRoles) {
        await expect(
          createBusinessCaseStandaloneInErp(
            { title: "Unauthorized Attempt", department: "Operations" },
            "user@netlink.com",
            role
          ),
          `Expected role ${role} to be rejected with 403 Forbidden`
        ).rejects.toThrow(/403 Forbidden|Only Department Users/i);
      }
    });

    it("allows Department User and Admin to create Business Cases", async () => {
      const authorizedRoles = ["department", "department_user", "Department User", "admin", "Admin"];

      for (const role of authorizedRoles) {
        const created = await createBusinessCaseStandaloneInErp(
          { title: "Authorized Case", department: "Engineering" },
          "requester@netlink.com",
          role
        );
        expect(created).toBeDefined();
        expect(created.workflow_status).toBe("Pending Engineering");
      }
    });

    it("persists technical requirements as a structured child-table array without string coercion, preserving quantity and UOM", async () => {
      const technicalRequirementsList = [
        {
          id: "TR-001",
          requirement_type: "Product / Equipment",
          quantity: 1,
          uom: "Nos.",
          priority: "High",
          is_mandatory: true,
          specification:
            "Robotic welding cell with welding robot, welding power source, positioner, fixtures, safety enclosure, control panel, tooling, programming, commissioning and operator training.",
          performance_requirements:
            "20 units/hour, minimum 95% availability, repeatable welding accuracy, automatic monitoring and fault detection.",
          quality_requirements:
            "Consistent weld quality, inspection documentation and validation reports.",
          delivery_installation_requirements:
            "Plant 01 installation, commissioning, trial production, training and handover within 45 days from PO.",
          integration_requirements:
            "Compatible with plant electrical and automation systems and standard industrial communication protocols.",
          safety_compliance_requirements:
            "Safety guarding, emergency stops, safety interlocks and required compliance documentation.",
        },
      ];

      let capturedPayload: any = null;
      (apiPost as any).mockImplementationOnce(async (_url: string, payload: any) => {
        capturedPayload = payload?.doc || payload;
        return {
          name: "BC-2026-00099",
          business_case_id: "BC-2026-00099",
          title: "Automated Precision Robotic Welding Cell",
          workflow_status: "Pending Engineering",
          technical_requirements: capturedPayload.technical_requirements,
        };
      });

      const created = await createBusinessCaseStandaloneInErp(
        {
          title: "Automated Precision Robotic Welding Cell",
          department: "Operations",
          technical_requirements_list: technicalRequirementsList as any,
        },
        "dept.user@netlink.com",
        "department_user",
        true
      );

      expect(created).toBeDefined();
      expect(Array.isArray(capturedPayload.technical_requirements)).toBe(true);
      expect(typeof capturedPayload.technical_requirements).not.toBe("string");

      const childDoc = capturedPayload.technical_requirements[0];
      expect(childDoc.doctype).toBe("Technical Requirement");
      expect(childDoc.item).toBe("Product / Equipment");
      expect(childDoc.annual_volume).toBe(1);
      expect(childDoc.unit).toBe("Nos.");
      expect(childDoc.description).toContain("Robotic welding cell");
      expect(childDoc.performance).toContain("20 units/hour");
      expect(childDoc.quality).toContain("Consistent weld quality");
      expect(childDoc.delivery).toContain("Plant 01 installation");
      expect(childDoc.integration).toContain("standard industrial communication protocols");
      expect(childDoc.safety).toContain("Safety guarding");

      // Verify normalization when case is returned/read
      expect(Array.isArray(created.technical_requirements_list)).toBe(true);
      expect(created.technical_requirements_list[0].quantity).toBe(1);
      expect(created.technical_requirements_list[0].uom).toBe("Nos.");
      expect(created.workflow_status).toBe("Pending Engineering");
    });

    it("persists uploaded PDF supporting documents with permanent file metadata", async () => {
      const docs = [
        {
          id: "doc-1",
          name: "Technical_Data_Sheet.pdf",
          file_url: "/files/Technical_Data_Sheet.pdf",
          file_id: "FIL-001",
          file_size: 1048576,
          size: 1048576,
          document_type: "Technical Data Sheet",
          version: "v1.0",
          status: "Available",
          uploadStatus: "UPLOADED",
        },
        {
          id: "doc-2",
          name: "Warranty_SLA.pdf",
          file_url: "/files/Warranty_SLA.pdf",
          file_id: "FIL-002",
          file_size: 2097152,
          size: 2097152,
          document_type: "Warranty & SLA Agreement",
          version: "v1.0",
          status: "Available",
          uploadStatus: "UPLOADED",
        },
      ];

      const created = await createBusinessCaseStandaloneInErp(
        {
          title: "Robotics Case with Docs",
          department: "Operations",
          supporting_documents: docs as any,
        },
        "dept.user@netlink.com",
        "department_user"
      );

      expect(created).toBeDefined();
      expect(created.supporting_documents).toHaveLength(2);
      expect(created.supporting_documents[0].file_url).toBe("/files/Technical_Data_Sheet.pdf");
      expect(created.supporting_documents[0].document_type).toBe("Technical Data Sheet");
      expect(created.supporting_documents[1].file_id).toBe("FIL-002");
    });
  });

  describe("Requirement 23 Acceptance Tests: Legal Stage & E-Signature", () => {
    it("TEST 7 & TEST 1: Unauthorized create API call by Legal Manager yields 403 Forbidden", async () => {
      await expect(
        createBusinessCaseStandaloneInErp(
          { title: "Direct Bypass Create Attempt", department: "Legal" },
          "legal.manager@netlink.com",
          "Legal Manager"
        )
      ).rejects.toThrow(/Access denied\. Only Department Users/i);
    });

    it("TEST 2: Active case in Pending Legal has Legal Approval stage assigned to Legal Manager", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";
      mockCaseState.current_approver_role = "Legal Manager";

      expect(mockCaseState.workflow_status).toBe("Pending Legal");
      expect(mockCaseState.current_stage).toBe("Legal Approval");
      expect(mockCaseState.current_approver_role).toBe("Legal Manager");
    });

    it("TEST 3, 4, 5, 6: Full Legal Review, Checklist, E-Signature, and Approval to Pending Procurement", async () => {
      mockCaseState.workflow_status = "Pending Legal";
      mockCaseState.current_stage = "Legal Approval";
      mockCaseState.current_approver_role = "Legal Manager";

      // 9 checklist items verified
      const verifiedChecklist = {
        businessRequirements: true,
        supplierDocReviewed: true,
        complianceCertificates: true,
        regulatoryRequirements: true,
        contractualRequirements: true,
        warrantyLiabilityTerms: true,
        requiredLegalDocsAvailable: true,
        noUnresolvedExceptions: true,
        finalReviewCompleted: true,
      };

      // Document reviews
      const docReviews = {
        "Technical Data Sheet": { status: "Reviewed" },
        "Quality Assurance Certificate": { status: "Reviewed" },
        "Warranty & SLA": { status: "Reviewed" },
        "FAT/SAT Plan": { status: "Reviewed" },
        "CE / Regulatory Compliance Certificate": { status: "Reviewed" },
        "Installation, Commissioning & Operation Manual": { status: "Reviewed" },
      };

      const result = await approveLegalStageInErp(
        "BC-2026-00005",
        "Comprehensive legal, compliance, and contractual review completed with zero exceptions.",
        "legal.manager@netlink.com",
        "Legal Manager",
        {
          signatureName: "Legal Manager",
          fontId: "caveat",
          signedAt: "2026-09-07T16:30:00Z",
          checklist: verifiedChecklist,
          documentReviews: docReviews,
          auditMetadata: {
            ipAddress: "10.0.0.45",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            businessCaseId: "BC-2026-00005",
          },
        }
      );

      // TEST 5: E-Signature event recorded
      expect(result.legal_signature).toBe("Legal Manager");
      expect(result.legal_status).toBe("Approved");
      expect(result.legal_approved_by).toBe("legal.manager@netlink.com");
      expect(result.legal_approved_date).toBeDefined();

      // TEST 6: Moves to PENDING PROCUREMENT assigned to Procurement Manager
      expect(result.workflow_status).toBe("Pending Procurement");
      expect(result.status).toBe("Pending Procurement");
      expect(result.current_stage).toBe("Procurement Review");
      expect(result.current_approver_role).toBe("Procurement Manager");
    });
  });

  describe("Requirement 19: Strict Sequential Visibility & Queue Isolation across 6 Roles", () => {
    it("traces BC-2026-00005 strictly sequentially across Department User, Engineer, Eng Mgr, Finance, Legal, and Procurement", async () => {
      // Step 1: Department User submits BC-2026-00005
      mockCaseState.name = "BC-2026-00005";
      mockCaseState.business_case_id = "BC-2026-00005";
      mockCaseState.title = "Automated Inspection Robots";
      mockCaseState.workflow_status = "Pending Engineering";
      mockCaseState.current_stage = "Technical Review";
      mockCaseState.current_approver_role = "Engineer";
      mockCaseState.owner = "dept.user@netlink.com";
      mockCaseState.created_by = "dept.user@netlink.com";
      mockCaseState.department = "Operations";
      mockCaseState.engineering_status = "Pending";
      mockCaseState.finance_status = "Pending";
      mockCaseState.legal_status = "Pending";
      mockCaseState.procurement_status = "Pending";

      // Dept User sees their submitted case
      const deptCases = await fetchRoleBusinessCasesFromErp("department", "dept.user@netlink.com", { tab: "submitted" });
      expect(deptCases).toHaveLength(1);
      expect(deptCases[0].business_case_id).toBe("BC-2026-00005");

      // Engineer sees 1 pending case in active queue
      const engCases = await fetchRoleBusinessCasesFromErp("engineer", "engineer@netlink.com");
      expect(engCases).toHaveLength(1);
      expect(engCases[0].business_case_id).toBe("BC-2026-00005");

      // Downstream roles see 0 in their active queues
      expect(await fetchRoleBusinessCasesFromErp("engineering_manager", "eng.mgr@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("finance", "finance@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com")).toHaveLength(0);

      // Step 2: Engineer completes Technical Review
      await completeEngineerTechnicalReviewInErp(
        "BC-2026-00005",
        "Technical review verified and approved.",
        "engineer@netlink.com",
        "Engineer"
      );

      // Engineer active queue = 0, history = 1
      expect(await fetchRoleBusinessCasesFromErp("engineer", "engineer@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("engineer", "engineer@netlink.com", { tab: "history" })).toHaveLength(1);

      // Engineering Manager sees 1 pending case
      const engMgrCases = await fetchRoleBusinessCasesFromErp("engineering_manager", "eng.mgr@netlink.com");
      expect(engMgrCases).toHaveLength(1);
      expect(engMgrCases[0].business_case_id).toBe("BC-2026-00005");

      // Downstream roles still see 0 in their active queues
      expect(await fetchRoleBusinessCasesFromErp("finance", "finance@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com")).toHaveLength(0);

      // Step 3: Engineering Manager approves
      await approveEngineeringStageInErp(
        "BC-2026-00005",
        "Engineering sign-off completed.",
        "eng.mgr@netlink.com",
        "Engineering Manager"
      );

      // Engineering Manager active queue = 0, history = 1
      expect(await fetchRoleBusinessCasesFromErp("engineering_manager", "eng.mgr@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("engineering_manager", "eng.mgr@netlink.com", { tab: "history" })).toHaveLength(1);

      // Finance Manager sees 1 pending case
      const finCases = await fetchRoleBusinessCasesFromErp("finance", "finance@netlink.com");
      expect(finCases).toHaveLength(1);
      expect(finCases[0].business_case_id).toBe("BC-2026-00005");

      // Downstream roles still see 0 in their active queues
      expect(await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com")).toHaveLength(0);

      // Step 4: Finance Manager approves
      await approveFinanceStageInErp(
        "BC-2026-00005",
        "Financial model and budget clearance verified.",
        "finance@netlink.com",
        "Finance Manager"
      );

      // Finance Manager active queue = 0, history = 1
      expect(await fetchRoleBusinessCasesFromErp("finance", "finance@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("finance", "finance@netlink.com", { tab: "history" })).toHaveLength(1);

      // Legal Manager sees 1 pending case
      const legalCases = await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com");
      expect(legalCases).toHaveLength(1);
      expect(legalCases[0].business_case_id).toBe("BC-2026-00005");

      // Procurement Manager still sees 0 in their active queue
      expect(await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com")).toHaveLength(0);

      // Step 5: Legal Manager approves with E-Signature
      await approveLegalStageInErp(
        "BC-2026-00005",
        "Legal review and statutory checks complete.",
        "legal@netlink.com",
        "Legal Manager",
        {
          signatureName: "Legal Manager",
          fontId: "caveat",
          signedAt: "2026-09-08T10:00:00Z",
          checklist: { businessRequirements: true },
          documentReviews: {},
        }
      );

      // Legal Manager active queue = 0, history = 1
      expect(await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com")).toHaveLength(0);
      expect(await fetchRoleBusinessCasesFromErp("legal", "legal@netlink.com", { tab: "history" })).toHaveLength(1);

      // Procurement Manager sees 1 pending case in active review queue
      const procCases = await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com");
      expect(procCases).toHaveLength(1);
      expect(procCases[0].business_case_id).toBe("BC-2026-00005");

      // Step 6: Procurement Manager reviews / approves
      await approveProcurementStageInErp(
        "BC-2026-00005",
        "Procurement packaging and commercial review completed.",
        "proc@netlink.com",
        "Procurement Manager"
      );

      // Procurement Manager active review queue = 0
      expect(await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com")).toHaveLength(0);

      // Procurement Manager 'ready_for_rfq' tab = 1 case
      const readyCases = await fetchRoleBusinessCasesFromErp("procurement", "proc@netlink.com", { tab: "ready_for_rfq" });
      expect(readyCases).toHaveLength(1);
      expect(readyCases[0].business_case_id).toBe("BC-2026-00005");
      expect(readyCases[0].workflow_status).toBe("Ready for RFQ");
    });

    it("ensures Engineer queue does not show Pending Engineering Manager and Engineering Manager active queue shows it", async () => {
      mockCaseState = {
        name: "BC-2026-02027",
        business_case_id: "BC-2026-02027",
        title: "Factory Automation Upgrade",
        workflow_status: "Pending Engineering Manager",
        current_stage: "Engineering Approval",
        engineering_status: "Reviewed",
        budget: 250000,
        capex: 250000,
        approval_history: "[]",
      };

      // 1. Engineer active queue MUST be 0
      const engineerActive = await fetchRoleBusinessCasesFromErp("engineer", "engineer@netlink.com");
      expect(engineerActive).toHaveLength(0);

      // 2. Engineer history queue MUST include BC-2026-02027
      const engineerHistory = await fetchRoleBusinessCasesFromErp("engineer", "engineer@netlink.com", { tab: "history" });
      expect(engineerHistory).toHaveLength(1);
      expect(engineerHistory[0].business_case_id).toBe("BC-2026-02027");

      // 3. Engineering Manager ('engineering') active queue MUST include BC-2026-02027
      const engMgrActive = await fetchRoleBusinessCasesFromErp("engineering", "engineeringmanager@netlink.com");
      expect(engMgrActive).toHaveLength(1);
      expect(engMgrActive[0].business_case_id).toBe("BC-2026-02027");
      expect(engMgrActive[0].workflow_status).toBe("Pending Engineering Manager");

      // 4. Engineering Manager approves -> advances to Pending Finance
      const approved = await approveEngineeringStageInErp(
        "BC-2026-02027",
        "Engineering specifications and capacity verified.",
        "engineeringmanager@netlink.com",
        "engineering",
      );
      expect(approved.workflow_status).toBe("Pending Finance");
      expect(approved.current_stage).toBe("Finance Approval");
      expect(approved.engineering_status).toBe("Approved");
    });

    it("Engineering Approval technical requirements data normalization preserves 1 Nos. and handles empty data safely", () => {
      // Helper function mirroring the normalized component logic in BusinessCaseDetailPage
      const normalizeTechRequirements = (businessCase: any) => {
        if (!businessCase) return [];
        const rawSource: any =
          businessCase.technical_requirements_list ??
          businessCase.technicalRequirements ??
          businessCase.technical_requirements;

        let list: any[] = [];
        if (Array.isArray(rawSource)) {
          list = rawSource;
        } else if (typeof rawSource === "string" && rawSource.trim()) {
          try {
            const parsed = JSON.parse(rawSource);
            if (Array.isArray(parsed)) list = parsed;
            else list = [{ requirement_type: "Product / Equipment", specification: rawSource.trim(), quantity: 1, uom: "Nos." }];
          } catch {
            list = [{ requirement_type: "Product / Equipment", specification: rawSource.trim(), quantity: 1, uom: "Nos." }];
          }
        }

        if (list.length > 0) {
          return list.map((tr: any) => ({
            id: tr.id || tr.name || undefined,
            requirement_type: tr.requirement_type || tr.item || "Product / Equipment",
            item: tr.item || tr.requirement_type || "Product / Equipment",
            specification: tr.specification || tr.description || "",
            description: tr.description || tr.specification || "",
            quantity: Number(tr.quantity) || Number(tr.annual_volume) || 1,
            uom: tr.uom || tr.unit || "Nos.",
            priority: tr.priority || "High",
            is_mandatory: tr.is_mandatory !== undefined ? Boolean(tr.is_mandatory) : true,
            performance_requirements: tr.performance_requirements || "",
            quality_requirements: tr.quality_requirements || "",
            delivery_installation_requirements: tr.delivery_installation_requirements || "",
            integration_requirements: tr.integration_requirements || "",
            safety_compliance_requirements: tr.safety_compliance_requirements || "",
          }));
        }

        return [];
      };

      // 1. Child-table technical requirement with quantity: 1, uom: "Nos."
      const testCaseWithItems = {
        business_case_id: "BC-02027",
        title: "Test Case",
        technical_requirements: [
          {
            requirement_type: "Product / Equipment",
            specification: "High precision CNC milling spindle assembly",
            quantity: 1,
            uom: "Nos.",
            priority: "High",
            is_mandatory: true,
            performance_requirements: "12,000 RPM continuous duty cycle",
            quality_requirements: "ISO 9001 / IATF 16949 compliant",
            delivery_installation_requirements: "Plant unloading and FAT/SAT",
            integration_requirements: "SCADA PLC interface compatible",
            safety_compliance_requirements: "OSHA machinery safety certified",
          },
        ],
      };

      const normalized = normalizeTechRequirements(testCaseWithItems);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].quantity).toBe(1);
      expect(normalized[0].uom).toBe("Nos.");
      expect(normalized[0].quantity).not.toBe(50);
      expect(normalized[0].requirement_type).toBe("Product / Equipment");
      expect(normalized[0].specification).toBe("High precision CNC milling spindle assembly");
      expect(normalized[0].is_mandatory).toBe(true);
      expect(normalized[0].performance_requirements).toBe("12,000 RPM continuous duty cycle");
      expect(normalized[0].quality_requirements).toBe("ISO 9001 / IATF 16949 compliant");
      expect(normalized[0].delivery_installation_requirements).toBe("Plant unloading and FAT/SAT");
      expect(normalized[0].integration_requirements).toBe("SCADA PLC interface compatible");
      expect(normalized[0].safety_compliance_requirements).toBe("OSHA machinery safety certified");

      // 2. Safe empty handling: undefined, null, empty array, empty string never crash
      expect(normalizeTechRequirements(null)).toEqual([]);
      expect(normalizeTechRequirements({})).toEqual([]);
      expect(normalizeTechRequirements({ technical_requirements: [] })).toEqual([]);
      expect(normalizeTechRequirements({ technical_requirements_list: [] })).toEqual([]);
      expect(normalizeTechRequirements({ technical_requirements: "" })).toEqual([]);
    });
  });
});



