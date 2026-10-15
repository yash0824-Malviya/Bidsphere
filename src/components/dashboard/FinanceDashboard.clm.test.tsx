import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ queries: [] as Array<{ queryKey: unknown[]; queryFn: () => unknown; refetchInterval?: number }>, list: vi.fn(), records: [] as Array<Record<string, unknown>> }));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (data: unknown) => data,
  useQuery: (query: (typeof fixture.queries)[number]) => { fixture.queries.push(query); return { data: query.queryKey[0] === "clm" ? { records: fixture.records } : undefined, isLoading: false, isError: false }; },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../api/clm", () => ({ getClmList: fixture.list, clmViewerKey: () => "finance-session", clmRecordRoute: (_type: string, name: string) => `/contracts/${name}` }));
vi.mock("../../api/financeWorkflow", () => ({ FINANCE_DASHBOARD_METRICS_KEY: "finance-metrics", getFinanceDashboardMetrics: vi.fn(), getOutstandingPayables: vi.fn(), invoiceOutstandingAmount: vi.fn() }));
vi.mock("../../api/businessIntake", () => ({ fetchRoleBusinessCases: vi.fn() }));
vi.mock("../../api/approvalWorkflow", () => ({ APPROVAL_WORKFLOW_QUERY_KEY: "approval-workflow" }));
vi.mock("../../store/voucherSyncStore", () => ({ useVoucherSyncStore: () => 1 }));
vi.mock("../../config/dashboardRoles", () => ({ getExecutiveDashboardLayout: () => ({ quickActions: [] }) }));
vi.mock("./FinanceDashboardGrid", () => ({ default: () => <section>Existing RFQ Finance queues</section> }));
vi.mock("./FinanceKpiRow", () => ({ default: () => <section>Existing Finance KPIs</section> }));
vi.mock("../ecr/dashboards/FinanceECRDashboard", () => ({ default: () => <section>Existing ECR Finance queue</section> }));
import FinanceDashboard from "./FinanceDashboard";

beforeEach(() => { fixture.queries = []; fixture.records = []; vi.clearAllMocks(); });
describe("Finance dashboard CLM queue integration", () => {
  it("loads the real session-scoped Contract list and renders the persisted Finance task alongside existing queues", async () => {
    fixture.records = [{ name: "CON-2026-00001", custom_rfq: "RFQ-104", custom_contract_status: "Pending Finance", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase: "finance_review" }, signatures: [{ party: "inteva", file_id: "LEGAL-SIGNED" }] }) }];
    const html = renderToStaticMarkup(<MemoryRouter><FinanceDashboard greetingName="Finance Manager" /></MemoryRouter>);
    const query = fixture.queries.find(item => item.queryKey[0] === "clm")!;
    expect(query.queryKey).toEqual(["clm", "list", "Contract", false, "finance-session"]);
    expect(query.refetchInterval).toBe(30_000);
    await query.queryFn(); expect(fixture.list).toHaveBeenCalledExactlyOnceWith("Contract");
    expect(html).toContain('href="/contracts/CON-2026-00001"'); expect(html).toContain("Pending Finance Approval");
    for (const existing of ["Existing RFQ Finance queues", "Existing Finance KPIs", "Existing ECR Finance queue"]) expect(html).toContain(existing);
  });
});
