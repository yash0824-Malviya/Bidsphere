import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProcurementTeamDashboard from "./ProcurementTeamDashboard";

const fixture = vi.hoisted(() => ({ role: "procurement_team", queries: [] as Array<{ queryKey: unknown[]; enabled?: boolean }> }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: fixture.role } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryKey: unknown[]; enabled?: boolean }) => {
  fixture.queries.push(options);
  const clm = options.queryKey.includes("procurement-team-pending");
  return {
    data: clm ? { records: [{
      name: "CR-94", supplier: "FEMSA", custom_rfq: "PUR-RFQ-2026-00094", request_status: "Draft",
      custom_clm_data: JSON.stringify({ schema: 1, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
        rfq_source: { rfq: "PUR-RFQ-2026-00094", award: "AWARD-94" },
        rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" } }),
    }] } : undefined,
    isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  };
} }));
vi.mock("../../api/purchasing", () => ({ getPurchaseOrders: vi.fn(), getGrnList: vi.fn() }));
vi.mock("../../api/sourcing", () => ({ getRFQsPaged: vi.fn() }));
vi.mock("../../api/supplier", () => ({ getSuppliers: vi.fn() }));
vi.mock("../../api/ecr", () => ({ fetchECRList: vi.fn() }));
vi.mock("../../api/businessIntake", () => ({ fetchBusinessCases: vi.fn() }));
vi.mock("../../api/clm", () => ({ getClmList: vi.fn(), clmViewerKey: () => fixture.role, clmRecordRoute: (_doctype: string, name: string) => `/contract-requests/${name}` }));

const render = (role: string) => {
  fixture.role = role;
  return renderToStaticMarkup(<MemoryRouter><ProcurementTeamDashboard /></MemoryRouter>);
};
const pendingQuery = () => fixture.queries.find(row => row.queryKey.includes("procurement-team-pending"));

describe("Procurement Team dashboard CLM role routing", () => {
  beforeEach(() => { fixture.queries.length = 0; });
  it.each(["procurement.team", "procurement_team", "Procurement Team", "procurement team"])("loads and displays the same assigned request for %s", role => {
    const html = render(role);
    expect(pendingQuery()?.enabled).toBe(true);
    expect(html).toContain('aria-label="Pending CLM Requests"');
    expect(html).toContain('tabular-nums">1</span>');
    expect(html).toContain('href="/contract-requests/CR-94"');
    expect(html).toContain("Pending Procurement Team");
  });
  it.each(["procurement", "Procurement Manager", "admin", "legal", "finance"])("does not load or display the Team request queue for %s", role => {
    const html = render(role);
    expect(pendingQuery()?.enabled).toBe(false);
    expect(html).not.toContain('aria-label="Pending CLM Requests"');
    expect(html).not.toContain('href="/contract-requests/CR-94"');
  });
});
