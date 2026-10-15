import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../types/erpnext";

interface QueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<EngineeringChangeRequest[]>;
}

const fixture = vi.hoisted(() => ({
  user: { id: "engineer-id", name: "Engineer User", email: "engineer@netlink.com", username: "engineer-user", role: "engineer" },
  options: undefined as QueryOptions | undefined,
  fetchList: vi.fn(),
  query: {
    data: [] as EngineeringChangeRequest[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }),
}));
vi.mock("../../api/ecr", () => ({ fetchECRList: fixture.fetchList }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: QueryOptions) => {
    fixture.options = options;
    return fixture.query;
  },
}));

import EngineerTechnicalReviewPage from "./EngineerTechnicalReviewPage";
import { isEngineerTechnicalReviewAssignment } from "./engineerTechnicalReviewPresentation";

function request(extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name: "ECR-2026-100001",
    ecr_number: "ECR-2026-100001",
    ecr_title: "Assigned bracket review",
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: fixture.user.email,
    owner: fixture.user.email,
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-30",
    chnage_description: "Revise bracket dimensions.",
    reason_for_change: "Durability",
    select_pxfp: "Engineering Review",
    ecr_workflow_version: "extended_v1",
    supplier_response_required: "No",
    docstatus: 0,
    approval_requirements: [{
      name: "TECHNICAL-APPROVAL",
      approval_role: "Engineering Manager",
      approver: fixture.user.email,
      status: "Pending",
      required: 1,
    }],
    ...extra,
  };
}

function render() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr?filter=technical-review"]}><EngineerTechnicalReviewPage /></MemoryRouter>);
}

beforeEach(() => {
  fixture.query.data = [];
  fixture.query.isLoading = false;
  fixture.query.isFetching = false;
  fixture.query.isError = false;
  fixture.query.error = null;
  fixture.options = undefined;
  fixture.fetchList.mockReset().mockResolvedValue([]);
});

describe("Engineer Technical Review assignments", () => {
  it.each(["engineer-id", "Engineer User", " ENGINEER@NETLINK.COM ", "engineer-user"])("recognizes an explicit required pending assignment to %s", (approver) => {
    const ecr = request();
    ecr.approval_requirements![0].approver = approver;
    expect(isEngineerTechnicalReviewAssignment(ecr, fixture.user)).toBe(true);
  });

  it.each([
    ["unassigned manager task", { approver: undefined }],
    ["another user's task", { approver: "other@netlink.com" }],
    ["an optional task", { required: 0 }],
    ["an approved task", { status: "Approved" }],
    ["a different review role", { approval_role: "Finance Manager" }],
  ] as const)("excludes %s", (_name, changes) => {
    const ecr = request();
    Object.assign(ecr.approval_requirements![0], changes);
    expect(isEngineerTechnicalReviewAssignment(ecr, fixture.user)).toBe(false);
  });

  it("excludes stale technical tasks at other stages and requests outside the Engineer owner scope", () => {
    expect(isEngineerTechnicalReviewAssignment(request({ select_pxfp: "Draft" }), fixture.user)).toBe(false);
    expect(isEngineerTechnicalReviewAssignment(request({ select_pxfp: "Technical Approved" }), fixture.user)).toBe(false);
    expect(isEngineerTechnicalReviewAssignment(request({ ecr_owner: "other@netlink.com", owner: "other@netlink.com" }), fixture.user)).toBe(false);
    expect(isEngineerTechnicalReviewAssignment(request(), { ...fixture.user, role: "engineering" })).toBe(false);
  });
});

describe("Engineer Technical Review page", () => {
  it("keeps the existing owner-scoped read query and shared list cache", async () => {
    render();
    expect(fixture.options?.queryKey).toEqual(["ecr-list", "engineer", fixture.user.email]);
    await fixture.options!.queryFn();
    expect(fixture.fetchList).toHaveBeenCalledExactlyOnceWith({ limit: 300, owner: fixture.user.email });
  });

  it("renders only the technical queue with search, filters and its requested columns", () => {
    const html = render();
    expect(html).toContain("<h1>Technical Review</h1>");
    expect(html).toContain("Technical Review Queue");
    expect(html).toContain('placeholder="Search ECR, title, department..."');
    for (const column of ["ECR #", "Title", "Priority", "Department", "Supplier Required", "Target Date", "Current Stage", "Action"]) {
      expect(html).toContain(`<th scope="col">${column}</th>`);
    }
    expect(html).toContain('aria-label="Technical Review filters"');
    expect(html).toContain("All Priorities");
    expect(html).toContain("All Departments");
    expect(html).toContain('type="date"');
    expect(html).toContain("No ECRs are currently assigned to you for technical review.");
    for (const dashboardContent of ["Engineering Action Center", "ECR Status Overview", "Recent ECR Activity", "engineer-ecr-kpis"]) {
      expect(html).not.toContain(dashboardContent);
    }
  });

  it("shows an explicit assignment using the unchanged View action and hides role-only tasks", () => {
    fixture.query.data = [
      request(),
      request({ name: "ECR-2026-100002", ecr_title: "Manager assigned review", approval_requirements: [{ name: "MANAGER-TASK", approval_role: "Engineering Manager", status: "Pending", required: 1 }] }),
      request({ name: "ECR-2026-100003", ecr_title: "Other owner's review", ecr_owner: "other@netlink.com", owner: "other@netlink.com" }),
    ];
    const html = render();
    expect(html).toContain("Assigned bracket review");
    expect(html).not.toContain("Manager assigned review");
    expect(html).not.toContain("Other owner&#x27;s review");
    expect(html).toMatch(/class="engineer-ecr-row-action" href="\/ecr\/ECR-2026-100001"[^>]*>View/);
    expect(html).not.toContain('href="/ecr/ECR-2026-100001/edit"');
    expect(html).toContain("Showing <strong>1</strong> of <strong>1</strong> requests");
  });

  it("keeps loading distinct from an empty queue", () => {
    fixture.query.isLoading = true;
    const html = render();
    expect(html).toContain("Loading Technical Review requests");
    expect(html).not.toContain("No ECRs are currently assigned");
    expect(html).not.toContain("Showing <strong>0</strong>");
  });

  it("hides stale rows on a failed refresh and offers retry", () => {
    fixture.query.data = [request()];
    fixture.query.isError = true;
    fixture.query.error = new Error("Technical queue unavailable");
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Technical queue unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Assigned bracket review");
    expect(html).not.toContain("No ECRs are currently assigned");
  });
});
