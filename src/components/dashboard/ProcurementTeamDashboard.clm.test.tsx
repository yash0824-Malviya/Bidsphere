import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "procurement_team" as string | undefined, list: vi.fn(), queueQuery: undefined as undefined | { queryKey: unknown[]; enabled?: boolean; queryFn: () => Promise<unknown> } }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: fixture.role } }) }));
vi.mock("../../api/purchasing", () => ({ getPurchaseOrders: vi.fn(), getGrnList: vi.fn() }));
vi.mock("../../api/sourcing", () => ({ getRFQsPaged: vi.fn() }));
vi.mock("../../api/supplier", () => ({ getSuppliers: vi.fn() }));
vi.mock("../../api/ecr", () => ({ fetchECRList: vi.fn() }));
vi.mock("../../api/businessIntake", () => ({ fetchBusinessCases: vi.fn() }));
vi.mock("../../api/clm", () => ({ getClmList: fixture.list, clmViewerKey: () => "current-viewer", clmRecordRoute: (_doctype: string, name: string) => `/contract-requests/${name}` }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (query: { queryKey: unknown[]; enabled?: boolean; queryFn: () => Promise<unknown> }) => {
  const queue = query.queryKey[0] === "clm";
  if (queue) fixture.queueQuery = query;
  return { data: queue ? { records: [{ name: "CR-95", supplier: "Blue Ridge Manufacturing Inc", contract_value: 30, currency: "USD", custom_rfq: "PUR-RFQ-2026-00095", request_status: "Draft", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "PUR-RFQ-2026-00095", award: "LDC2026-00026" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }] }) }] } : [], isLoading: false, isFetching: false, refetch: vi.fn() };
} }));
import ProcurementTeamDashboard from "./ProcurementTeamDashboard";

const render = () => renderToStaticMarkup(<MemoryRouter><ProcurementTeamDashboard /></MemoryRouter>);
describe("Procurement Team CLM queue ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.queueQuery = undefined; });
  it.each(["procurement_team", "procurement.team", "Procurement Team"])("loads the persisted Request queue and exact request route for %s", async role => {
    fixture.role = role; const html = render();
    expect(fixture.queueQuery?.enabled).toBe(true); await fixture.queueQuery?.queryFn();
    expect(fixture.list).toHaveBeenCalledWith("Contract Request");
    expect(fixture.queueQuery?.queryKey).toEqual(["clm", "list", "Contract Request", "procurement-team-pending", "current-viewer"]);
    for (const text of ["Pending CLM Requests", "PUR-RFQ-2026-00095", "Blue Ridge Manufacturing Inc", "LDC2026-00026", "Award Value: USD 30", "Review &amp; Create Contract"]) expect(html).toContain(text);
    expect(html).toContain('href="/contract-requests/CR-95"');
  });
  it.each(["procurement", "Procurement Manager", "finance", "legal", "admin", undefined])("does not query or render the initial Team queue for %s even with stale cached rows", role => {
    fixture.role = role; const html = render();
    expect(fixture.queueQuery?.enabled).toBe(false); expect(fixture.list).not.toHaveBeenCalled();
    expect(html).not.toContain("Pending CLM Requests"); expect(html).not.toContain("CR-95"); expect(html).not.toContain("Review &amp; Create Contract");
  });
});
