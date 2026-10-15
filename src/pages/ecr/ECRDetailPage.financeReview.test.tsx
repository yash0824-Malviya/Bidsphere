import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyECRBusinessCasePayload, type ECRBusinessCase } from "../../types/ecrBusinessCase";
import type { EngineeringChangeRequest } from "../../types/erpnext";

const fixture = vi.hoisted(() => ({
  user: { role: "finance", email: "financemanager@example.com", name: "financemanager@example.com" },
  ecr: null as unknown as EngineeringChangeRequest,
  qc: { setQueryData: vi.fn(), getQueryData: vi.fn(), invalidateQueries: vi.fn(async () => undefined) },
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "ecr" ? fixture.ecr : [], isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => fixture.qc,
}));
vi.mock("../../api/ecrBusinessCase", () => ({ applyECRBusinessCaseAction: vi.fn(), fetchECRBusinessCase: vi.fn(), notifyECRStageChange: vi.fn() }));
import ECRDetailPage from "./ECRDetailPage";

function render() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr/ECR-2026-100010"]}><Routes>
    <Route path="/ecr/:name" element={<ECRDetailPage />} />
  </Routes></MemoryRouter>);
}
let businessCase: ECRBusinessCase;
function saveBusinessCase() { fixture.ecr.ecr_business_case = JSON.stringify(businessCase); }

describe("Finance review from the ECR detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.user.role = "finance";
    fixture.ecr = {
      name: "internal-ecr-100010", ecr_number: "ECR-2026-100010", ecr_title: "Improve latch durability",
      priority: "High", requesting_department: "Engineering", plant: "Plant 1", target_implementation_date: "2026-10-01",
      chnage_description: "Improve latch", reason_for_change: "Durability",
      ecr_owner: "engineer@example.com", docstatus: 0, ecr_workflow_version: "extended_v1", select_pxfp: "Finance Review",
      modified: "2026-09-15 15:00:00", cost_impact: 1, quality_impact: 1,
      approval_requirements: [{ name: "finance-task", approval_role: "Finance Manager", status: "Pending", required: 1 }],
    };
    businessCase = { ...emptyECRBusinessCasePayload(), name: "BC-100010", business_case_id: "BC-100010", ecr_reference: fixture.ecr.name,
      status: "Finance Review", finance_status: "Pending", procurement_status: "Pending", quality_status: "Pending",
      current_cost: 100, proposed_cost: 80, implementation_cost: 1000, one_time_cost: 300, recurring_cost: 25, annual_volume: 200,
      expected_annual_savings: 4000, roi: 300, payback_period: 3, budget_impact: "Tooling budget allocation",
      financial_risk: "Annual volume sensitivity", business_risk: "Supplier continuity", why_required: "Reduce cost",
      expected_benefits: "Improved durability", created_by: "engineer@example.com", creation: "2026-09-15", modified: "2026-09-15" };
    saveBusinessCase();
  });

  it("shows Finance Manager usable review controls immediately on the ECR detail page", () => {
    const html = render();
    expect(html).toContain('aria-label="Finance Business Case review"');
    expect(html).toContain("Finance Manager"); expect(html).toContain("Finance Review");
    expect(html).toContain("Financial Review");
    const approve = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Approve Business Case<\/button>/)?.[0];
    expect(approve).toBeDefined(); expect(approve).not.toContain('disabled=""');
    expect(html).toContain("Send Back"); expect(html).toContain("Reject");
    for (const field of ["Current unit cost", "Proposed unit cost", "Implementation cost", "Other one-time cost", "Recurring cost", "Annual volume", "Annual savings", "ROI", "Payback period", "Budget impact", "Financial risk"]) expect(html).toContain(field);
    expect(html).toContain(businessCase.budget_impact); expect(html).toContain(businessCase.financial_risk);
    expect(html).toContain("Open full Business Case");
    expect(html).not.toContain("Save draft"); expect(html).not.toContain("Create RFQ");
  });

  it.each(["engineer", "engineering", "procurement", "procurement_team", "quality", "program_manager", "admin"])("keeps Finance decisions hidden from %s", (role) => {
    fixture.user.role = role;
    expect(render()).not.toContain("Approve Business Case");
    expect(render()).not.toContain('aria-label="Finance Business Case review"');
  });

  it.each(["missing case", "different parent", "not pending", "missing task", "wrong task", "duplicate task", "legacy", "submitted"])("does not allow approval for %s", (condition) => {
    if (condition === "missing case") fixture.ecr.ecr_business_case = "";
    if (condition === "different parent") { businessCase.ecr_reference = "another-ecr"; saveBusinessCase(); }
    if (condition === "not pending") { businessCase.finance_status = "Approved"; saveBusinessCase(); }
    if (condition === "missing task") fixture.ecr.approval_requirements = [];
    if (condition === "wrong task") fixture.ecr.approval_requirements![0].approval_role = "Procurement Manager";
    if (condition === "duplicate task") fixture.ecr.approval_requirements!.push({ ...fixture.ecr.approval_requirements![0], name: "duplicate" });
    if (condition === "legacy") fixture.ecr.ecr_workflow_version = undefined;
    if (condition === "submitted") fixture.ecr.docstatus = 1;
    expect(render()).not.toContain("Approve Business Case");
  });

  it("hands the actionable review to Procurement only after Finance approval", () => {
    fixture.ecr.select_pxfp = "Procurement BC Review";
    fixture.ecr.approval_requirements = [
      { name: "finance-task", approval_role: "Finance Manager", status: "Approved", required: 1 },
      { name: "procurement-task", approval_role: "Procurement Manager", status: "Pending", required: 1 },
    ];
    businessCase.status = "Procurement BC Review"; businessCase.finance_status = "Approved"; saveBusinessCase();
    expect(render()).not.toContain("Approve Business Case");
    fixture.user.role = "procurement";
    expect(render()).toContain('aria-label="Procurement Business Case review"');
    expect(render()).toContain("Approve Business Case");
    expect(render()).toContain("Preliminary RFQ recommendation");
  });
});
