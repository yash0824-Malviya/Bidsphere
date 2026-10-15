import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../types/erpnext";

const fixture = vi.hoisted(() => ({
  user: { name: "engineering@netlink.com", full_name: "Engineering Manager", email: "engineering@netlink.com", role: "engineering" as const },
  data: [] as EngineeringChangeRequest[], isLoading: false, isError: false,
  options: undefined as undefined | { queryKey: unknown[]; queryFn: () => Promise<unknown> },
  fetch: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: { user: typeof fixture.user }) => unknown) => select({ user: fixture.user }) }));
vi.mock("../../api/ecr", () => ({ fetchECRList: fixture.fetch }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: NonNullable<typeof fixture.options>) => {
  fixture.options = options;
  return { data: fixture.data, isLoading: fixture.isLoading, isError: fixture.isError, error: new Error("ECR service unavailable"), isFetching: false, refetch: vi.fn() };
} }));
import EngineeringReviewPage from "./EngineeringReviewPage";
import EngineeringECRListPage from "./EngineeringECRListPage";
import { filterEngineeringECRRows, getEngineeringECRApprovedOn } from "./engineeringEcrListPresentation";

function ecr(name: string, extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return { name, ecr_number: name, ecr_title: `Change ${name}`, ecr_owner: "engineer@netlink.com", select_pxfp: "Draft",
    ecr_type: "Part Change", priority: "High", requesting_department: "Engineering", supplier_response_required: "Yes",
    target_implementation_date: "2026-09-30", creation: "2026-01-01", approval_requirements: [], ...extra } as EngineeringChangeRequest;
}
const pendingTask = { name: "task", approval_role: "Engineering Manager", required: 1 as const, status: "Pending" as const };
function render(review = false, query = "") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[`/ecr${query}`]}>{review ? <EngineeringReviewPage /> : <EngineeringECRListPage />}</MemoryRouter>);
}
function body(html: string) { return html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]; }

beforeEach(() => {
  fixture.data = [
    ecr("ECR-DRAFT", { ecr_owner: fixture.user.email }),
    ecr("ECR-PENDING", { select_pxfp: "Engineering Review", approval_requirements: [pendingTask] }),
    ecr("ECR-EXTENDED", { ecr_workflow_version: "extended_v1", select_pxfp: "Engineering Review", approval_requirements: [pendingTask] }),
    ecr("ECR-UNASSIGNED", { select_pxfp: "Engineering Review" }),
    ecr("ECR-OTHER-ROLE", { select_pxfp: "Procurement Review", approval_requirements: [{ ...pendingTask, approval_role: "Procurement Team" }] }),
    ecr("ECR-CLOSED", { ecr_workflow_version: "extended_v1", select_pxfp: "Closed", priority: "Medium", approval_requirements: [{ ...pendingTask, status: "Approved", approval_date: "2026-09-22 15:23:00" }] }),
  ];
  fixture.isLoading = false; fixture.isError = false; fixture.fetch.mockClear();
});

describe("Engineering Manager separate list pages", () => {
  it("shows only currently assigned legacy and extended review tasks in the action queue", () => {
    const html = render(true, "?filter=engineering");
    expect(html).toContain("<h1>Engineering Review</h1>");
    expect(html).toContain("Review technical feasibility and engineering impact of change requests.");
    expect(body(html)).toContain("Change ECR-PENDING");
    expect(body(html)).toContain("Change ECR-EXTENDED");
    for (const excluded of ["ECR-DRAFT", "ECR-UNASSIGNED", "ECR-OTHER-ROLE", "ECR-CLOSED"]) expect(body(html)).not.toContain(excluded);
    for (const heading of ["ECR #", "Title", "Department", "Priority", "Supplier Required", "Target Date", "Current Stage", "Action"]) expect(html).toContain(`<th scope="col">${heading}</th>`);
    expect(html).toMatch(/class="engineer-ecr-row-action" href="\/ecr\/ECR-[^"]+"[^>]*>Review/);
    expect(html).not.toContain('aria-label="ECR queues"');
    expect(html).not.toContain("engineer-ecr-kpis");
  });

  it("does not let stale or ambiguous approval rows become current review tasks", () => {
    fixture.data = [ecr("ECR-OLD", { select_pxfp: "RFQ", approval_requirements: [pendingTask] }),
      ecr("ECR-AMBIGUOUS", { select_pxfp: "Engineering Review", approval_requirements: [pendingTask, { ...pendingTask, name: "another-task" }] }),
      ecr("ECR-NOT-REQUIRED", { select_pxfp: "Engineering Review", approval_requirements: [{ ...pendingTask, required: 0 }] })];
    const html = render(true, "?filter=engineering");
    expect(html).toContain("No ECRs awaiting engineering review");
    expect(body(html)).not.toContain("Change ECR-");
  });

  it("renders the full existing API list on All ECRs without dashboard or review-only content", async () => {
    const html = render();
    expect(html).toContain("<h1>Engineering Change Requests</h1>");
    expect(html).toContain("Create, track and manage your engineering change requests.");
    for (const item of fixture.data) expect(body(html)).toContain(item.ecr_title);
    for (const tab of ["All", "My ECRs", "Pending Approval", "Sent Back", "Approved", "Closed"]) expect(html).toContain(`${tab}<span>`);
    for (const heading of ["Approval Status", "Approved On"]) expect(html).toContain(`<th scope="col">${heading}</th>`);
    expect(html).not.toContain("<h2>Engineering Review Queue</h2>");
    expect(html).not.toContain("engineer-ecr-kpis");
    expect(fixture.options!.queryKey).toEqual(["ecr-list", "engineering", "all"]);
    await fixture.options!.queryFn();
    expect(fixture.fetch).toHaveBeenCalledWith({ limit: 300 });
    expect(body(html)).toContain("2026-09-22");
    expect(body(html)).not.toContain("2026-01-01");
  });

  it("keeps All ECRs tabs scoped to existing ownership and queue predicates", () => {
    const mine = render(false, "?filter=mine");
    expect(body(mine)).toContain("ECR-DRAFT");
    expect(body(mine)).not.toContain("ECR-PENDING");
    const pending = render(false, "?filter=pending-approval");
    expect(pending).toContain('aria-current="page">Pending Approval');
    expect(body(pending)).toContain("ECR-PENDING");
    expect(body(pending)).not.toContain("ECR-UNASSIGNED");
    const closed = render(false, "?filter=closed");
    expect(body(closed)).toContain("ECR-CLOSED");
    expect(body(closed)).not.toContain("ECR-DRAFT");
  });

  it("restores URL search and all five filters, without widening the review assignment scope", () => {
    const params = "q=pending&priority=High&department=Engineering&supplier=Yes&type=Part+Change&target-date=2026-09-30";
    const html = render(true, `?filter=engineering&${params}`);
    expect(body(html)).toContain("ECR-PENDING");
    expect(body(html)).not.toContain("ECR-EXTENDED");
    for (const label of ["Priority", "Department", "Supplier Required", "ECR Type", "Target Date"]) expect(html).toContain(`>${label}<`);
    expect(filterEngineeringECRRows(fixture.data, new URLSearchParams("supplier=No"), "")).toEqual([]);
    expect(filterEngineeringECRRows(fixture.data, new URLSearchParams("priority=Medium"), "").map((item) => item.name)).toEqual(["ECR-CLOSED"]);
  });

  it("shows only genuine saved approval dates, never creation or a sent-back timestamp", () => {
    expect(getEngineeringECRApprovedOn(ecr("ECR", { select_pxfp: "Procurement Review" }))).toBe("—");
    expect(getEngineeringECRApprovedOn(ecr("ECR", { select_pxfp: "Draft", approval_requirements: [{ ...pendingTask, status: "Sent Back", approval_date: "2026-09-21" }] }))).toBe("—");
    expect(getEngineeringECRApprovedOn(ecr("ECR", { select_pxfp: "RFQ Pending", approval_requirements: [
      { ...pendingTask, status: "Approved", approval_date: "2026-09-20" },
      { ...pendingTask, name: "procurement", status: "Approved", approval_date: "2026-09-22" },
    ] }))).toBe("2026-09-22");
  });

  it("preserves loading and error states rather than presenting failure as an empty queue", () => {
    fixture.isLoading = true;
    expect(body(render(true))).toContain("Loading engineering change requests");
    expect(body(render(true))).not.toContain("ECR-PENDING");
    fixture.isLoading = false; fixture.isError = true;
    expect(render(true)).toContain("ECR service unavailable");
    expect(body(render(true))).toContain("Requests are unavailable");
    expect(body(render(true))).not.toContain("No ECRs awaiting engineering review");
  });
});
