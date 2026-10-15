import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyECRBusinessCasePayload, type ECRBusinessCaseAggregate } from "../../types/ecrBusinessCase";
const fixture = vi.hoisted(() => ({
  user: { name: "engineer@example.com", email: "engineer@example.com", role: "engineer" }, data: null as unknown, loadedRevision: "",
  mutations: [] as Array<{ onSuccess?: (result: ECRBusinessCaseAggregate, action: string) => void }>,
  qc: { setQueryData: vi.fn(), invalidateQueries: vi.fn(async () => undefined) },
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(fixture.loadedRevision && initial === (fixture.data as ECRBusinessCaseAggregate)?.ecr.modified ? fixture.loadedRevision : initial) };
});
vi.mock("../../store/authStore", () => ({ useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: fixture.data, isLoading: false, isError: false }),
  useMutation: (options: (typeof fixture.mutations)[number]) => {
    fixture.mutations.push(options);
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => fixture.qc,
}));
vi.mock("../../api/ecrBusinessCase", () => ({ applyECRBusinessCaseAction: vi.fn(), fetchECRBusinessCase: vi.fn() }));
vi.mock("../../api/ecrAttachments", () => ({ uploadECRAttachment: vi.fn(), fetchECRAttachments: vi.fn() }));
vi.mock("../../api/legalDocsStorage", () => ({ getFullFileUrl: (url: string) => `/api/file-proxy?url=${encodeURIComponent(url)}` }));
import ECRBusinessCasePage from "./ECRBusinessCasePage";

function render() { return renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr/ECR-2026-00001/business-case"]}><Routes><Route path="/ecr/:name/business-case" element={<ECRBusinessCasePage />} /></Routes></MemoryRouter>); }
function aggregate() { return fixture.data as ECRBusinessCaseAggregate; }
function setReview(stage: "Finance Review" | "Procurement BC Review" | "Quality Review", role: string, approvalRole: string) {
  fixture.user.role = role;
  aggregate().ecr.select_pxfp = stage;
  aggregate().ecr.approval_requirements = [{ name: "current-review-task", approval_role: approvalRole, required: 1, status: "Pending" }];
  aggregate().businessCase!.status = stage;
  aggregate().businessCase!.finance_status = stage === "Finance Review" ? "Pending" : "Approved";
  aggregate().businessCase!.procurement_status = stage === "Quality Review" ? "Approved" : "Pending";
  aggregate().businessCase!.quality_status = "Pending";
}

describe("ECR Business Case route controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.mutations = [];
    fixture.loadedRevision = "";
    fixture.user = { name: "engineer@example.com", email: "engineer@example.com", role: "engineer" };
    fixture.data = {
      ecr: { name: "ECR-2026-00001", docstatus: 0, ecr_title: "Bracket improvement", priority: "High", requesting_department: "Engineering", plant: "Plant 1", target_implementation_date: "2026-10-01", chnage_description: "Improve bracket", reason_for_change: "Durability", ecr_owner: "engineer@example.com", ecr_workflow_version: "extended_v1", select_pxfp: "Technical Approved", modified: "2026-09-15 12:00:00", approval_requirements: [{ name: "engineer-task", approval_role: "Engineer", required: 1, status: "Pending" }] },
      businessCase: { ...emptyECRBusinessCasePayload(), name: "BC-1", business_case_id: "BC-1", ecr_reference: "ECR-2026-00001", status: "Draft", expected_annual_savings: 0, roi: null, payback_period: null, finance_status: "Pending", procurement_status: "Pending", quality_status: "Not Required", created_by: "engineer@example.com", creation: "2026-09-15", modified: "2026-09-15" },
    } satisfies ECRBusinessCaseAggregate;
  });
  it("lets only the owning engineer prepare the technically approved ECR", () => {
    const html = render();
    expect(html).toContain("Save draft"); expect(html).toContain("Submit Business Case"); expect(html).toContain("Upload supporting document");
    fixture.user.email = "other@example.com"; fixture.user.name = "other@example.com";
    expect(render()).not.toContain("Save draft");
  });
  it("shows Finance decisions only at the Finance review stage", () => {
    setReview("Finance Review", "finance", "Finance Manager");
    const html = render();
    expect(html).toContain("Finance Business Case review");
    expect(html.match(/Approve Business Case/g)).toHaveLength(1);
    expect(html).not.toContain("Save draft");
    aggregate().ecr.select_pxfp = "Quality Review";
    expect(render()).not.toContain("Approve Business Case");
  });
  it("hides Finance decisions when the saved assignment or review status is no longer pending", () => {
    setReview("Finance Review", "finance", "Finance Manager");
    aggregate().ecr.approval_requirements = [];
    expect(render()).not.toContain("Approve Business Case");
    setReview("Finance Review", "finance", "Finance Manager");
    aggregate().businessCase!.finance_status = "Approved";
    expect(render()).not.toContain("Approve Business Case");
  });
  it("keeps review controls disabled when the opened parent revision is stale", () => {
    setReview("Finance Review", "finance", "Finance Manager");
    fixture.loadedRevision = "older-revision";
    const html = render();
    expect(html).toContain("This ECR changed while you were reviewing.");
    const approvalButton = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("Approve Business Case"));
    expect(approvalButton).toMatch(/^<button[^>]*disabled=""/);
  });
  it("captures preliminary procurement sourcing advice separately from the final decision", () => {
    setReview("Procurement BC Review", "procurement", "Procurement Manager");
    const html = render(); expect(html).toContain("Preliminary RFQ recommendation"); expect(html).toContain("final sourcing decision is recorded after ECR approval"); expect(html).toContain("Approve Business Case");
  });
  it("routes the final approver back to ECR actions and keeps Business Case inputs read-only", () => {
    fixture.user.role = "program_manager"; aggregate().ecr.select_pxfp = "Final ECR Approval";
    const html = render(); expect(html).toContain("open the ECR for final approval"); expect(html).not.toContain("Approve Business Case"); expect(html).not.toContain("Save draft");
  });
  it("leaves legacy ECRs in their existing workflow", () => {
    aggregate().ecr.ecr_workflow_version = undefined;
    expect(render()).toContain("This ECR follows the existing review workflow."); expect(render()).not.toContain("Submit Business Case");
  });
  it("requires a reload when the cached ECR revision advances beyond the opened form", () => {
    fixture.loadedRevision = "older-revision";
    const html = render();
    expect(html).toContain("This ECR changed while you were viewing it.");
    expect(html).toContain("Reload saved case (discard local edits)");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Save draft/s);
  });
  it.each(["save", "submit"])("refreshes dashboard counters and all document aliases after Business Case %s", (action) => {
    aggregate().ecr.name = "internal-ecr-id";
    aggregate().ecr.ecr_number = "ECR-2026-00001";
    render();
    const result = structuredClone(aggregate());
    result.ecr.modified = "2026-09-15 12:01:00";
    fixture.mutations[0].onSuccess!(result, action);

    for (const identifier of ["internal-ecr-id", "ECR-2026-00001"]) {
      expect(fixture.qc.setQueryData).toHaveBeenCalledWith(["ecr-business-case", identifier], result);
      expect(fixture.qc.setQueryData).toHaveBeenCalledWith(["ecr", identifier], result.ecr);
      expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["ecr-comments", identifier] });
    }
    for (const queryKey of ["ecr-urgent-dashboard-list", "ecr-badge-counts", "procurement-team-ecrs-secondary", "ecr-notifications"]) {
      expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: [queryKey] });
    }
  });
});
