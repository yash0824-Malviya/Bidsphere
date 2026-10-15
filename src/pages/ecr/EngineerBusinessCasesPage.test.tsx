import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyECRBusinessCasePayload, type ECRBusinessCase, type ECRBusinessCaseAggregate } from "../../types/ecrBusinessCase";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import { EMPTY_BUSINESS_CASE_FILTERS, loadEngineerBusinessCaseQueue, matchesBusinessCaseFilters, type EngineerBusinessCaseQueue } from "./engineerBusinessCaseQueue";

interface QueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<EngineerBusinessCaseQueue>;
  enabled: boolean;
}
const fixture = vi.hoisted(() => ({
  user: { name: "engineer@netlink.com", email: "engineer@netlink.com", role: "engineer" },
  options: undefined as QueryOptions | undefined,
  query: { data: undefined as EngineerBusinessCaseQueue | undefined, isLoading: false, isFetching: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  fetchList: vi.fn(), fetchCase: vi.fn(),
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }) }));
vi.mock("../../api/ecr", () => ({ fetchECRList: fixture.fetchList }));
vi.mock("../../api/ecrBusinessCase", () => ({ fetchECRBusinessCase: fixture.fetchCase }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: QueryOptions) => { fixture.options = options; return fixture.query; } }));

import EngineerBusinessCasesPage from "./EngineerBusinessCasesPage";

function ecr(id: number, extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name: `internal-ecr-${id}`, ecr_number: `ECR-2026-${String(id).padStart(5, "0")}`, ecr_title: `Bracket improvement ${id}`,
    requesting_department: "Engineering", priority: "High", ecr_owner: fixture.user.email, owner: fixture.user.email,
    plant: "Main Plant", target_implementation_date: "2026-10-01", select_pxfp: "Technical Approved", docstatus: 0,
    ecr_workflow_version: "extended_v1", chnage_description: "Improve durability", reason_for_change: "Durability",
    ecr_business_case: "", ...extra,
  };
}
function businessCase(record: EngineeringChangeRequest, status: ECRBusinessCase["status"] = "Draft"): ECRBusinessCase {
  return {
    ...emptyECRBusinessCasePayload(), name: `case-${record.name}`, business_case_id: `BC-${record.ecr_number}`, ecr_reference: record.name,
    status, expected_annual_savings: 0, roi: null, payback_period: null, finance_status: "Pending", procurement_status: "Pending", quality_status: "Not Required",
    created_by: fixture.user.email, creation: "2026-09-30", modified: "2026-09-30",
  };
}
function saved(id: number, extra: Partial<EngineeringChangeRequest> = {}, status: ECRBusinessCase["status"] = "Draft") {
  const record = ecr(id, extra);
  const savedCase = businessCase(record, status);
  record.ecr_business_case = JSON.stringify(savedCase);
  return { ecr: record, businessCase: savedCase };
}
function render(path = "/ecr?filter=business-case") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><EngineerBusinessCasesPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.user.role = "engineer";
  fixture.query.data = { cases: [], readyToPrepare: [] };
  fixture.query.isLoading = false; fixture.query.isError = false; fixture.query.error = null;
  fixture.options = undefined;
  fixture.fetchList.mockResolvedValue([]);
});

describe("Engineer Business Case page", () => {
  it("reuses existing Engineering Manager read access without exposing preparation actions", async () => {
    fixture.user.role = "engineering";
    const other = saved(2, { ecr_owner: "other@netlink.com", owner: "other@netlink.com", select_pxfp: "Business Case Preparation" });
    fixture.fetchList.mockResolvedValue([other.ecr, ecr(3)]);
    fixture.query.data = { cases: [other], readyToPrepare: [] };
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr?filter=business-case"]}><EngineerBusinessCasesPage role="engineering" /></MemoryRouter>);
    expect(html).toContain("View business cases linked to engineering change requests.");
    expect(html).toContain("BC-ECR-2026-00002");
    expect(html).not.toContain("Prepare Business Case");
    expect(html).not.toContain("Ready to prepare</h2>");
    expect(html).toMatch(/href="\/ecr\/ECR-2026-00002\/business-case"[^>]*>View/);
    expect(fixture.options!.queryKey).toEqual(["ecr-list", "engineering-business-cases", "all"]);
    expect(fixture.options!.enabled).toBe(true);
    expect(await fixture.options!.queryFn()).toEqual({ cases: [other], readyToPrepare: [] });
    expect(fixture.fetchList).toHaveBeenCalledWith({ limit: 300, owner: undefined });
  });

  it("renders the dedicated list, required columns and filters without dashboard cards", () => {
    fixture.query.data = { cases: [saved(1)], readyToPrepare: [ecr(2)] };
    const html = render();
    expect(html).toContain("<h1>Business Cases</h1>");
    expect(html).toContain("Prepare and manage business cases for technically approved ECRs.");
    expect(html).toContain('placeholder="Search Business Case..."');
    for (const column of ["Business Case #", "ECR #", "Title", "Department", "Status", "Priority", "Target Date", "Current Stage", "Action"]) expect(html).toContain(`scope="col">${column}</th>`);
    for (const filter of ["Status", "Department", "Priority", "ECR"]) expect(html).toContain(`<label>${filter}<select`);
    expect(html).toContain('<label>Target Date<input type="date"');
    expect(html).not.toContain("Engineering Action Center");
    expect(html).not.toContain("engineer-ecr-kpis");
    expect(html).not.toContain("ECR Status Overview");
    expect(html).toContain('href="/ecr/ECR-2026-00001/business-case"');
    expect(html).toContain('href="/ecr/ECR-2026-00002/business-case"');
    const caseBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
    expect(caseBody).toContain("BC-ECR-2026-00001");
    expect(caseBody).not.toContain("ECR-2026-00002");
    expect(html).toContain("Ready to prepare</h2>");
  });

  it("uses the existing owner-scoped list and workflow-invalidated cache prefix", async () => {
    const own = saved(1);
    const other = saved(2, { ecr_owner: "other@netlink.com", owner: "other@netlink.com" });
    fixture.fetchList.mockResolvedValue([own.ecr, other.ecr]);
    render();
    expect(fixture.options!.queryKey).toEqual(["ecr-list", "engineer-business-cases", fixture.user.email]);
    expect(fixture.options!.enabled).toBe(true);
    expect(await fixture.options!.queryFn()).toEqual({ cases: [own], readyToPrepare: [] });
    expect(fixture.fetchList).toHaveBeenCalledWith({ limit: 300, owner: fixture.user.email });
    expect(fixture.fetchCase).not.toHaveBeenCalled();
  });

  it("keeps an empty backend result empty and renders loading and failure states", () => {
    expect(render()).toContain("No Business Cases yet.");
    expect(render()).toContain('<table class="engineer-ecr-table-empty">');
    expect(render()).not.toContain("Ready to prepare</h2>");
    fixture.query.isLoading = true;
    expect(render()).toContain("Loading Business Cases…");
    expect(render()).toContain('<table class="engineer-ecr-table-empty">');
    expect(render()).not.toContain("No Business Cases yet.");
    fixture.query.isLoading = false; fixture.query.isError = true; fixture.query.error = new Error("Backend unavailable");
    expect(render()).toContain('role="alert"');
    expect(render()).toContain("Backend unavailable");
    expect(render()).toContain('<table class="engineer-ecr-table-empty">');
    expect(render()).not.toContain("No Business Cases yet.");
  });

  it("preserves preparation and approved queues from their existing URL filters", () => {
    fixture.query.data = {
      cases: [saved(1), saved(2, { select_pxfp: "Finance Review" }, "Finance Review"), saved(3, { select_pxfp: "Business Case Approved" }, "Approved"), saved(4, { select_pxfp: "Closed" }, "Approved")],
      readyToPrepare: [ecr(5)],
    };
    const preparation = render("/ecr?filter=business-case-preparation");
    expect(preparation).toContain("Business Case Preparation</h2>");
    expect(preparation).toContain("Bracket improvement 1");
    expect(preparation).toContain("Bracket improvement 5");
    for (const id of [2, 3, 4]) expect(preparation).not.toContain(`Bracket improvement ${id}`);
    const approved = render("/ecr?filter=business-case-approved");
    expect(approved).toContain("Approved Business Cases</h2>");
    expect(approved).toContain("Bracket improvement 3");
    for (const id of [1, 2, 4, 5]) expect(approved).not.toContain(`Bracket improvement ${id}`);
    expect(approved).not.toContain("Ready to prepare</h2>");
    for (const id of [1, 2, 3, 4, 5]) expect(render()).toContain(`Bracket improvement ${id}`);
  });

  it("opens saved Business Cases from the row action even after ECR approval or closure", () => {
    fixture.query.data = { cases: [saved(1, { select_pxfp: "Business Case Approved" }, "Approved"), saved(2, { select_pxfp: "Closed" }, "Approved")], readyToPrepare: [] };
    const html = render();
    expect(html).toContain('class="engineer-ecr-row-action" href="/ecr/ECR-2026-00001/business-case" data-discover="true">View');
    expect(html).toContain('class="engineer-ecr-row-action" href="/ecr/ECR-2026-00002/business-case" data-discover="true">View');
    expect(html).not.toContain('<table class="engineer-ecr-table-empty">');
  });
});

describe("Engineer Business Case backend presentation", () => {
  it("hydrates missing cases on completed ECRs through the existing read endpoint", async () => {
    const completed = ecr(1, { select_pxfp: "Closed", ecr_business_case: undefined });
    const current = ecr(2, { ecr_business_case: undefined });
    const persisted = { ecr: completed, businessCase: businessCase(completed, "Approved") };
    const reader = vi.fn(async (name: string): Promise<ECRBusinessCaseAggregate> => name === completed.name ? persisted : { ecr: current, businessCase: null });
    expect(await loadEngineerBusinessCaseQueue([completed, current], fixture.user, reader)).toEqual({ cases: [persisted], readyToPrepare: [current] });
    expect(reader).toHaveBeenCalledTimes(2);
    expect(reader).toHaveBeenCalledWith(completed.name);
  });

  it("never invents cases from technically approved ECRs and excludes other owners and legacy records", async () => {
    const ready = ecr(1);
    const unrelated = [
      ecr(2, { select_pxfp: "Engineering Review", ecr_business_case: undefined }),
      ecr(3, { select_pxfp: "Draft", ecr_business_case: undefined }),
      ecr(4, { ecr_owner: "other@netlink.com", owner: "other@netlink.com", ecr_business_case: undefined }),
      ecr(5, { ecr_workflow_version: undefined, select_pxfp: "Approved", ecr_business_case: undefined }),
      ecr(6, { select_pxfp: "Finance Review" }),
    ];
    const reader = vi.fn();
    expect(await loadEngineerBusinessCaseQueue([ready, ...unrelated], fixture.user, reader)).toEqual({ cases: [], readyToPrepare: [ready] });
    expect(reader).not.toHaveBeenCalled();
  });

  it("does not treat a failed read as an absent Business Case", async () => {
    const reader = vi.fn().mockRejectedValue(new Error("Unable to load persisted case"));
    await expect(loadEngineerBusinessCaseQueue([ecr(1, { ecr_business_case: undefined })], fixture.user, reader)).rejects.toThrow("Unable to load persisted case");
  });

  it("rejects a case linked to a different ECR and rechecks owner after hydration", async () => {
    const record = ecr(1, { ecr_business_case: undefined });
    const mismatched = businessCase(ecr(2));
    const reader = vi.fn().mockResolvedValue({ ecr: record, businessCase: mismatched });
    expect(await loadEngineerBusinessCaseQueue([record], fixture.user, reader)).toEqual({ cases: [], readyToPrepare: [] });
    reader.mockResolvedValue(saved(1, { ecr_owner: "other@netlink.com", owner: "other@netlink.com" }));
    expect(await loadEngineerBusinessCaseQueue([record], fixture.user, reader)).toEqual({ cases: [], readyToPrepare: [] });
  });

  it("filters persisted cases by their own status and ECR fields, including search", () => {
    const aggregate = saved(1, { select_pxfp: "Technical Approved" }, "Sent Back");
    for (const [key, value] of Object.entries({ search: "bc-ecr-2026-00001", status: "Sent Back", department: "Engineering", priority: "High", ecr: aggregate.ecr.name, targetDate: "2026-10-01" })) {
      expect(matchesBusinessCaseFilters(aggregate.ecr, aggregate.businessCase, { ...EMPTY_BUSINESS_CASE_FILTERS, [key]: value })).toBe(true);
      expect(matchesBusinessCaseFilters(aggregate.ecr, aggregate.businessCase, { ...EMPTY_BUSINESS_CASE_FILTERS, [key]: "not-a-match" })).toBe(false);
    }
    expect(matchesBusinessCaseFilters(aggregate.ecr, aggregate.businessCase, { ...EMPTY_BUSINESS_CASE_FILTERS, status: "Technical Approved" })).toBe(false);
    expect(matchesBusinessCaseFilters(ecr(2), null, { ...EMPTY_BUSINESS_CASE_FILTERS, status: "Ready to prepare" })).toBe(true);
    expect(matchesBusinessCaseFilters(ecr(2), null, { ...EMPTY_BUSINESS_CASE_FILTERS, status: "Draft" })).toBe(false);
  });
});
