import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../../types/erpnext";

interface WorkspaceQueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<EngineeringChangeRequest[]>;
}

const fixture = vi.hoisted(() => ({
  user: {
    name: "engineer@netlink.com",
    email: "engineer@netlink.com",
    full_name: "Engineer",
    role: "engineer" as const,
  },
  options: undefined as WorkspaceQueryOptions | undefined,
  query: {
    data: undefined as EngineeringChangeRequest[] | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  fetchList: vi.fn(),
  invalidateQueries: vi.fn(),
  activityRows: undefined as EngineeringChangeRequest[] | undefined,
}));

vi.mock("../../../store/authStore", () => ({
  useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }),
}));
vi.mock("../../../api/ecr", () => ({ fetchECRList: fixture.fetchList }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: WorkspaceQueryOptions) => {
    fixture.options = options;
    return fixture.query;
  },
  useQueryClient: () => ({ invalidateQueries: fixture.invalidateQueries }),
}));
vi.mock("./EngineerRecentActivity", () => ({
  default: ({ ecrs }: { ecrs: EngineeringChangeRequest[] }) => {
    fixture.activityRows = ecrs;
    return <div data-testid="scoped-activity" />;
  },
}));

import EngineerECRWorkspace from "./EngineerECRWorkspace";
import { engineerECRMetrics } from "./engineerEcrPresentation";

function ecr(index: number, status: EngineeringChangeRequest["select_pxfp"], extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name: `private-${index}`,
    ecr_number: `ECR-2026-${100000 + index}`,
    ecr_title: `Owned request ${index}`,
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: fixture.user.email,
    owner: fixture.user.email,
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-30",
    chnage_description: "Revise bracket dimensions.",
    reason_for_change: "Durability",
    select_pxfp: status,
    docstatus: 0,
    approval_requirements: [],
    ...extra,
  };
}

function ownedRecords() {
  return [
    ecr(1, "Draft"),
    ecr(2, "Technical Approved", { ecr_workflow_version: "extended_v1" }),
    ecr(3, "Draft", {
      ecr_workflow_version: "extended_v1",
      approval_requirements: [{ name: "sent-back", approval_role: "Engineering Manager", status: "Sent Back", required: 1 }],
    }),
    ecr(4, "Engineering Review", {
      ecr_workflow_version: "extended_v1",
      approval_requirements: [{ name: "engineering-task", approval_role: "Engineering Manager", status: "Pending", required: 1 }],
    }),
    ecr(5, "Procurement Review", {
      approval_requirements: [{ name: "procurement-task", approval_role: "Procurement Team", status: "Pending", required: 1 }],
    }),
    ecr(6, "ECR Approved", { ecr_workflow_version: "extended_v1" }),
    ecr(7, "Closed", { ecr_workflow_version: "extended_v1" }),
    ecr(8, "RFQ", { ecr_workflow_version: "extended_v1", rfq: "RFQ-EXISTING" }),
  ];
}

function render(path = "/ecr", dashboard = false) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><EngineerECRWorkspace dashboard={dashboard} /></MemoryRouter>);
}

function tableBody(html: string): string {
  const match = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  expect(match).not.toBeNull();
  return match![1];
}

function renderedMetrics(html: string): string[] {
  return [...html.matchAll(/class="engineer-ecr-number">([^<]+)</g)].map((match) => match[1]);
}

beforeEach(() => {
  fixture.query.data = [
    ...ownedRecords(),
    ecr(9, "Draft", { ecr_owner: "other@netlink.com", owner: "other@netlink.com", ecr_title: "Other engineer private request" }),
  ];
  fixture.query.isLoading = false;
  fixture.query.isFetching = false;
  fixture.query.isError = false;
  fixture.query.error = null;
  fixture.options = undefined;
  fixture.activityRows = undefined;
  fixture.fetchList.mockReset().mockResolvedValue([]);
  fixture.invalidateQueries.mockClear();
});

describe("Engineer ECR workspace data and navigation", () => {
  it("preserves the owned 300-record query and separate dashboard/list cache keys", async () => {
    render();
    expect(fixture.options?.queryKey).toEqual(["ecr-list", "engineer", fixture.user.email]);
    await fixture.options!.queryFn();
    expect(fixture.fetchList).toHaveBeenLastCalledWith({ limit: 300, owner: fixture.user.email });
    render("/dashboard", true);
    expect(fixture.options?.queryKey).toEqual(["ecr-dashboard", "engineer", fixture.user.email]);
    await fixture.options!.queryFn();
    expect(fixture.fetchList).toHaveBeenLastCalledWith({ limit: 300, owner: fixture.user.email });
  });

  it("renders six real workload metrics without treating another role's pending review as the Engineer's", () => {
    expect(engineerECRMetrics(ownedRecords(), fixture.user).map(({ label, value }) => [label, value])).toEqual([
      ["My ECRs", 8], ["Business Cases to Prepare", 1], ["Pending Approval", 0],
      ["Sent Back", 1], ["Approved", 4], ["Closed", 2],
    ]);
    expect(renderedMetrics(render())).toEqual(["8", "1", "0", "1", "4", "2"]);
  });

  it("excludes another engineer's records from the table, metrics and activity scope", () => {
    const html = render();
    expect(html).not.toContain("Other engineer private request");
    expect(html).not.toContain("ECR-2026-100009");
    expect(tableBody(html).match(/<tr>/g)).toHaveLength(8);
    expect(fixture.activityRows?.map((row) => row.name)).toEqual(ownedRecords().map((row) => row.name));
    expect(renderedMetrics(html)[0]).toBe("8");
  });

  it("keeps dashboard rows actionable while the unfiltered queue displays all owned ECRs", () => {
    const dashboardBody = tableBody(render("/dashboard", true));
    expect(dashboardBody.match(/<tr>/g)).toHaveLength(3);
    for (const index of [1, 2, 3]) expect(dashboardBody).toContain(`Owned request ${index}`);
    for (const index of [4, 5, 6, 7, 8]) expect(dashboardBody).not.toContain(`Owned request ${index}`);
    const listBody = tableBody(render("/ecr?filter=mine"));
    expect(listBody.match(/<tr>/g)).toHaveLength(8);
  });

  it("renders the requested columns and preserves create, edit, business-case and view routes", () => {
    const html = render();
    for (const heading of ["ECR #", "Title", "Type", "Priority", "Current Stage", "Assigned To", "Target Date", "Action"]) {
      expect(html).toContain(`<th scope="col">${heading}</th>`);
    }
    expect(html).toContain('href="/ecr/new"');
    expect(html).toContain('href="/ecr?filter=mine"');
    expect(html).toMatch(/href="\/ecr\/ECR-2026-100001\/edit"[^>]*>Edit/);
    expect(html).toMatch(/href="\/ecr\/ECR-2026-100002\/business-case"[^>]*>Prepare Business Case/);
    expect(html).toMatch(/href="\/ecr\/ECR-2026-100004"[^>]*>View/);
    expect(tableBody(html)).toContain("Engineering Manager");
    expect(tableBody(html)).toContain("engineer@netlink.com");
  });

  it.each([
    ["sent-back", [3]],
    ["business-case-preparation", [2]],
    ["approved", [5, 8]],
    ["closed", [7, 8]],
  ])("preserves the existing %s URL queue predicate", (filter, visibleIndexes) => {
    const html = render(`/ecr?filter=${filter}`);
    const body = tableBody(html);
    for (let index = 1; index <= 8; index += 1) {
      if (visibleIndexes.includes(index)) expect(body).toContain(`Owned request ${index}`);
      else expect(body).not.toContain(`Owned request ${index}`);
    }
    // KPI totals stay independent of the list queue, including its legacy Approved predicate.
    expect(renderedMetrics(html)).toEqual(["8", "1", "0", "1", "4", "2"]);
  });

  it("keeps the Engineer pending queue empty even when other reviewers have assigned tasks", () => {
    const html = render("/ecr?filter=pending-approval");
    expect(tableBody(html)).toContain("No ECRs match this queue or your filters.");
    expect(tableBody(html)).not.toContain("Owned request");
    expect(html).toContain('aria-current="page">Pending Approval<span>0</span>');
  });

  it("shows unavailable indicators instead of false zero totals or stale records after a query error", () => {
    fixture.query.isError = true;
    fixture.query.error = new Error("ECR service unavailable");
    const html = render();
    expect(renderedMetrics(html)).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(html).toContain("ECR service unavailable");
    expect(tableBody(html)).toContain("Requests are unavailable. Retry loading above.");
    expect(tableBody(html)).not.toContain("Owned request");
    expect(html).toContain("Status overview unavailable.");
    expect(fixture.activityRows).toBeUndefined();
  });

  it("does not briefly show zero totals while initial records are loading", () => {
    fixture.query.data = undefined;
    fixture.query.isLoading = true;
    const html = render();
    expect(renderedMetrics(html)).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(tableBody(html)).toContain("Loading your engineering changes");
    expect(tableBody(html)).not.toContain("No ECRs yet.");
  });
});
