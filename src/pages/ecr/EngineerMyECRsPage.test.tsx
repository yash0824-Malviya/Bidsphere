import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../types/erpnext";

const fixture = vi.hoisted(() => ({
  user: { name: "engineer@netlink.com", full_name: "Engineer", email: "engineer@netlink.com", role: "engineer" as const },
  data: [] as EngineeringChangeRequest[], isLoading: false, isError: false,
  options: undefined as undefined | { queryKey: unknown[]; queryFn: () => Promise<unknown> },
  fetch: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (value: { user: typeof fixture.user }) => unknown) => select({ user: fixture.user }) }));
vi.mock("../../api/ecr", () => ({ fetchECRList: fixture.fetch }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: NonNullable<typeof fixture.options>) => {
  fixture.options = options;
  return { data: fixture.data, isLoading: fixture.isLoading, isError: fixture.isError, error: new Error("ECR service unavailable"), isFetching: false, refetch: vi.fn() };
} }));
import EngineerMyECRsPage from "./EngineerMyECRsPage";
import { filterEngineerMyECRs } from "./engineerMyEcrList";

function ecr(id: string, extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return { name: id, ecr_number: id, ecr_title: `Change ${id}`, ecr_owner: fixture.user.email,
    select_pxfp: "Draft", ecr_type: "Part Change", priority: "High", requesting_department: "Engineering",
    supplier_response_required: "Yes", target_implementation_date: "2026-09-30", approval_requirements: [],
    ...extra } as EngineeringChangeRequest;
}
function render(query = "") { return renderToStaticMarkup(<MemoryRouter initialEntries={[`/ecr${query}`]}><EngineerMyECRsPage /></MemoryRouter>); }
function body(html: string) { return html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]; }

beforeEach(() => {
  fixture.data = [ecr("ECR-1"), ecr("ECR-2", { select_pxfp: "Engineering Review", approval_requirements: [{ name: "approval-1", approval_role: "Engineering Manager", required: 1, status: "Pending" }] }),
    ecr("ECR-3", { select_pxfp: "Closed", ecr_workflow_version: "extended_v1", priority: "Medium" }),
    ecr("ECR-OTHER", { ecr_owner: "other@netlink.com", owner: "other@netlink.com" })];
  fixture.isError = false; fixture.isLoading = false; fixture.fetch.mockClear();
});

describe("Engineer My ECRs dedicated list", () => {
  it("renders the actual list and existing actions without any dashboard panels", async () => {
    const html = render();
    expect(html).toContain("<h1>My ECRs</h1>");
    expect(html).toContain("View and manage engineering change requests created by you.");
    for (const column of ["ECR #", "Title", "Department", "Type", "Priority", "Current Stage", "Target Date", "Approval Status", "Action"]) expect(html).toContain(`<th scope="col">${column}</th>`);
    for (const dashboard of ["Engineering Action Center", "ECR Status Overview", "Recent ECR Activity", "engineer-ecr-kpis"]) expect(html).not.toContain(dashboard);
    expect(html).not.toContain("ECR-OTHER");
    expect(html).toContain('href="/ecr/ECR-1/edit"');
    expect(html).toContain('href="/ecr/ECR-2"');
    expect(html).toContain('href="/ecr/new"');
    expect(fixture.options!.queryKey).toEqual(["ecr-list", "engineer", fixture.user.email]);
    await fixture.options!.queryFn();
    expect(fixture.fetch).toHaveBeenCalledWith({ limit: 300, owner: fixture.user.email });
  });
  it("renders Draft as its own queue and preserves role-exact Pending Approval", () => {
    const drafts = render("?filter=draft");
    expect(drafts).toContain('aria-current="page">Draft<span>1</span>');
    expect(body(drafts)).toContain("Change ECR-1");
    expect(body(drafts)).not.toContain("Change ECR-2");
    expect(body(render("?filter=pending-approval"))).not.toContain("Change ECR-2");
    expect(body(render("?filter=closed"))).toContain("Change ECR-3");
    expect(render("?filter=mine")).toContain('aria-current="page">All<span>3</span>');
  });
  it("restores and combines all six filters and search from the URL", () => {
    const html = render("?q=ECR-1&status=Draft&priority=High&department=Engineering&supplier=Yes&type=Part+Change&target-date=2026-09-30");
    expect(body(html)).toContain("Change ECR-1");
    expect(body(html)).not.toContain("Change ECR-2");
    for (const label of ["Status", "Priority", "Department", "Supplier Required", "ECR Type", "Target Date"]) expect(html).toContain(`>${label}<`);
    const params = new URLSearchParams("status=Draft&priority=High&department=Engineering&supplier=No&type=Part+Change&target-date=2026-09-30");
    expect(filterEngineerMyECRs([fixture.data[0]], params, fixture.user)).toEqual([]);
  });
  it("keeps loading/errors distinct from an empty queue", () => {
    fixture.isLoading = true;
    expect(body(render())).toContain("Loading your ECRs");
    expect(body(render())).not.toContain("Change ECR-1");
    fixture.isLoading = false; fixture.isError = true;
    expect(render()).toContain("ECR service unavailable");
    expect(body(render())).not.toContain("Change ECR-1");
  });
});
