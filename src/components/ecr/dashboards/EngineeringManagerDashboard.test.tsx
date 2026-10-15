import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../../types/erpnext";

interface QueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<EngineeringChangeRequest[]>;
  staleTime: number;
}

const fixture = vi.hoisted(() => ({
  user: {
    name: "engineering@netlink.com",
    email: "engineering@netlink.com",
    full_name: "Engineering Manager",
    role: "engineering" as const,
  },
  options: undefined as QueryOptions | undefined,
  query: {
    data: [] as EngineeringChangeRequest[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined as Error | undefined,
    refetch: vi.fn(),
  },
  fetchList: vi.fn(),
}));

vi.mock("../../../store/authStore", () => ({
  useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) => selector({ user: fixture.user }),
}));
vi.mock("../../../api/ecr", () => ({ fetchECRList: fixture.fetchList }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: QueryOptions) => {
    fixture.options = options;
    return fixture.query;
  },
}));

import EngineeringManagerDashboard from "./EngineeringManagerDashboard";
import { engineeringManagerDashboardData } from "./engineeringManagerDashboardPresentation";
import { getECRListActionLabel, isPendingApprovalForRole } from "../../../config/ecrQueues";
import { getEngineeringECRMetrics } from "../../../pages/ecr/engineeringEcrMetrics";
import EngineeringECRListPage from "../../../pages/ecr/EngineeringECRListPage";
import EngineeringReviewPage from "../../../pages/ecr/EngineeringReviewPage";

function ecr(name: string, status: EngineeringChangeRequest["select_pxfp"], extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name,
    ecr_number: name,
    ecr_title: `Title ${name}`,
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-10-15",
    chnage_description: "Revise bracket dimensions.",
    reason_for_change: "Durability",
    select_pxfp: status,
    docstatus: 1,
    approval_requirements: [],
    ...extra,
  };
}

function task(role = "Engineering Manager", status: "Pending" | "Approved" | "Rejected" | "Sent Back" = "Pending", required: 0 | 1 = 1, approver?: string) {
  return { name: `TASK-${role}`, approval_role: role, status, required, approver };
}

function records(): EngineeringChangeRequest[] {
  return [
    ecr("ECR-LEGACY-REVIEW", "Engineering Review", { approval_requirements: [task()] }),
    ecr("ECR-EXTENDED-REVIEW", "Engineering Review", { ecr_workflow_version: "extended_v1", approval_requirements: [task()] }),
    ecr("ECR-MY-DRAFT", "Draft", { ecr_owner: fixture.user.email }),
    ecr("ECR-HISTORICAL", "Closed", { ecr_workflow_version: "extended_v1", approval_requirements: [task()] }),
    ecr("ECR-PROCUREMENT", "Procurement Review", { approval_requirements: [task("Procurement Team")] }),
    ecr("ECR-UNASSIGNED", "Engineering Review"),
    ecr("ECR-REVIEW-DONE", "Engineering Review", { approval_requirements: [task("Engineering Manager", "Approved")] }),
    ecr("ECR-OPTIONAL", "Engineering Review", { approval_requirements: [task("Engineering Manager", "Pending", 0)] }),
    ecr("ECR-WRONG-ROLE", "Engineering Review", { approval_requirements: [task("Finance Manager")] }),
    ecr("ECR-AMBIGUOUS", "Engineering Review", { approval_requirements: [task(), task("Finance Manager")] }),
    ecr("ECR-WITH-RFQ", "Engineering Review", { rfq: "PUR-RFQ-EXISTING", approval_requirements: [task()] }),
  ];
}

function render() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/dashboard"]}><EngineeringManagerDashboard /></MemoryRouter>);
}

function section(html: string, labelledBy: string) {
  return html.match(new RegExp(`<section[^>]*aria-labelledby="${labelledBy}"[\\s\\S]*?<\\/section>`))?.[0] || "";
}

function tableBody(html: string) {
  return html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] || "";
}

function cardCounts(html: string) {
  return [...html.matchAll(/<strong(?: class="engineer-ecr-number")?>(\d+|—)<\/strong>/g)].map((match) => match[1]);
}

beforeEach(() => {
  fixture.query.data = records();
  fixture.query.isLoading = false;
  fixture.query.isFetching = false;
  fixture.query.isError = false;
  fixture.query.error = undefined;
  fixture.options = undefined;
  fixture.fetchList.mockReset().mockResolvedValue([]);
});

describe("Engineering Manager dashboard", () => {
  it("renders a dedicated dashboard heading, five KPIs and four action cards without the review-page layout", () => {
    const html = render();
    expect(html).toContain(">Engineering Manager Dashboard</h1>");
    expect(html).toContain("Monitor engineering changes, technical reviews and downstream business-case activities.");
    expect(html).toContain(">Refresh</button>");
    const overview = section(html, "engineering-overview-heading");
    expect(overview).toContain(">Engineering Overview</h2>");
    expect([...overview.matchAll(/<a /g)]).toHaveLength(5);
    for (const label of ["My ECRs", "Pending Approval", "Sent Back", "Approved", "Closed"]) {
      expect(overview).toContain(`>${label}</span>`);
    }
    const actions = section(html, "engineering-manager-actions-heading");
    expect(actions).toContain(">Engineering Action Center</h2>");
    expect(actions).toContain("ECRs and downstream activities requiring your attention.");
    expect([...actions.matchAll(/<article /g)]).toHaveLength(4);
    for (const label of ["Pending Approval", "Sent Back", "Business Cases to Prepare", "Approved ECRs"]) {
      expect(actions).toContain(`>${label}</h3>`);
    }
    expect(html).not.toContain(">Engineering Review</h1>");
    expect(html).not.toContain("Engineering Review Queue");
    expect(html).not.toContain("Contract Lifecycle");
    expect(html).not.toContain('href="/contracts');
    expect(html).not.toContain('type="search"');
  });

  it("uses the list's canonical metrics for KPI and matching action counts", () => {
    fixture.query.data.push(ecr("ECR-RETURNED", "Technical Approved", {
      ecr_workflow_version: "extended_v1", approval_requirements: [task("Engineering Manager", "Sent Back")],
    }));
    const summary = getEngineeringECRMetrics(fixture.query.data, fixture.user);
    expect(summary).toEqual({ all: 12, mine: 1, pending: 2, sentBack: 1, approved: 2, closed: 2 });
    const html = render();
    expect(cardCounts(section(html, "engineering-overview-heading")))
      .toEqual([summary.mine, summary.pending, summary.sentBack, summary.approved, summary.closed].map(String));
    expect(cardCounts(section(html, "engineering-manager-actions-heading")))
      .toEqual([String(summary.pending), String(summary.sentBack), "1", String(summary.approved)]);
  });

  it("renders dashboard KPI totals matching every list tab and the review queue", () => {
    fixture.query.data.push(ecr("ECR-RETURNED", "Technical Approved", {
      ecr_workflow_version: "extended_v1", approval_requirements: [task("Engineering Manager", "Sent Back")],
    }));
    const dashboardCounts = cardCounts(section(render(), "engineering-overview-heading"));
    const tabs = ["mine", "pending-approval", "sent-back", "approved", "closed"];
    const labels = ["My ECRs", "Pending Approval", "Sent Back", "Approved", "Closed"];
    for (const [index, filter] of tabs.entries()) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/ecr?filter=${filter}`]}><EngineeringECRListPage /></MemoryRouter>);
      const count = html.match(new RegExp(`${labels[index]}<span>(\\d+)</span>`))?.[1];
      expect(count).toBe(dashboardCounts[index]);
      expect([...tableBody(html).matchAll(/<tr>/g)]).toHaveLength(Number(count));
      expect(html).toContain(`aria-current="page">${labels[index]}`);
    }
    const review = renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr?filter=engineering"]}><EngineeringReviewPage /></MemoryRouter>);
    expect([...tableBody(review).matchAll(/<tr>/g)]).toHaveLength(Number(dashboardCounts[1]));
    expect(tableBody(review)).not.toContain("ECR-HISTORICAL");
  });

  it("links actions to existing separated pages without enabling Business Case preparation", () => {
    const html = render();
    const actions = section(html, "engineering-manager-actions-heading");
    expect(actions).toMatch(/href="\/ecr\?filter=engineering"[^>]*>Review ECRs/);
    expect(actions).toMatch(/href="\/ecr\?filter=sent-back"[^>]*>View Revisions/);
    expect(actions).toMatch(/href="\/ecr\?filter=business-case"[^>]*>Prepare Business Cases/);
    expect(actions).toMatch(/href="\/ecr\?filter=approved"[^>]*>View Approved ECRs/);
    expect(actions).not.toContain("business-case-preparation");
    expect(html).not.toContain('href="/ecr/new"');
  });

  it("preserves exact legacy and extended pending scope in counts and recent actions", () => {
    expect(records().filter((row) => isPendingApprovalForRole("engineering", row)).map((row) => row.name))
      .toEqual(["ECR-LEGACY-REVIEW", "ECR-EXTENDED-REVIEW"]);
    const body = tableBody(render());
    for (const row of records().slice(0, 3)) expect(body).toContain(row.name);
    for (const row of records().slice(3)) expect(body).not.toContain(row.name);
    expect([...body.matchAll(/>Review<svg/g)]).toHaveLength(2);
    expect(body).toContain(">View<svg");
    expect(body).not.toContain(">Edit<");
  });

  it("shows compact empty states without pulling unrelated history into My ECRs", () => {
    fixture.query.data = records().slice(3);
    const html = render();
    expect(html).toContain("No engineering actions pending");
    expect(html).toContain("All assigned engineering reviews are up to date.");
    expect(html).toContain("No recent ECRs to display");
    expect(html).not.toContain("Title ECR-HISTORICAL");
    expect(html).not.toContain("No ECRs awaiting engineering review");
    expect(tableBody(html)).not.toContain('class="engineer-ecr-reference"');
    expect([...section(html, "engineering-manager-actions-heading").matchAll(/<article /g)]).toHaveLength(4);
  });

  it("shows compact My ECRs columns and at most five newest relevant records", () => {
    fixture.query.data = [
      ecr("ECR-OWN-OLDEST", "Draft", { ecr_owner: fixture.user.email, creation: "2026-09-01 08:00:00" }),
      ecr("ECR-REVIEWED", "Procurement Review", { modified: "2026-09-28 08:00:00", approval_requirements: [task("Engineering Manager", "Approved", 1, fixture.user.email)] }),
      ecr("ECR-OWN-NEWEST", "Draft", { ecr_owner: fixture.user.email, modified: "2026-09-30 08:00:00" }),
      ecr("ECR-ASSIGNED", "Engineering Review", { modified: "2026-09-29 08:00:00", approval_requirements: [task()] }),
      ecr("ECR-OWN-CREATED", "Draft", { ecr_owner: fixture.user.email, creation: "2026-09-27T08:00:00" }),
      ecr("ECR-SENT-BACK", "Technical Approved", { ecr_workflow_version: "extended_v1", modified: "2026-09-26 08:00:00", approval_requirements: [task("Engineering Manager", "Sent Back", 1, fixture.user.email)] }),
      ecr("ECR-UNRELATED-LATEST", "Closed", { ecr_workflow_version: "extended_v1", modified: "2026-09-30 23:00:00" }),
    ];
    const expected = ["ECR-OWN-NEWEST", "ECR-ASSIGNED", "ECR-REVIEWED", "ECR-OWN-CREATED", "ECR-SENT-BACK"];
    const data = engineeringManagerDashboardData(fixture.query.data, fixture.user);
    expect(data.recent.map((row) => row.name)).toEqual(expected);
    expect(data.relevantCount).toBe(6);
    const html = render();
    const recent = section(html, "engineering-manager-recent-heading");
    expect(recent).toContain(">My ECRs</h2>");
    expect(recent).toContain("Your engineering changes, current stages and next actions.");
    expect(recent).toMatch(/href="\/ecr"[^>]*>View Queue/);
    expect([...recent.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((match) => match[1]))
      .toEqual(["ECR #", "Title", "Priority", "Current Stage", "Target Date", "Action"]);
    const body = tableBody(html);
    expect([...body.matchAll(/<tr>/g)]).toHaveLength(5);
    expect([...body.matchAll(/class="engineer-ecr-title-cell"><span>Title ([^<]+)<\/span>/g)].map((match) => match[1])).toEqual(expected);
    expect(body).not.toContain("ECR-OWN-OLDEST");
    expect(body).not.toContain("ECR-UNRELATED-LATEST");
    expect(recent).toContain("Showing 5 of 6 relevant ECRs");
  });

  it("requires exact saved reviewer identity and engineering role for historical decisions", () => {
    const valid = ["Approved", "Rejected", "Sent Back"] as const;
    const rows = valid.map((status) => ecr(`ECR-MY-${status}`, "Closed", {
      ecr_workflow_version: "extended_v1", approval_requirements: [task("Engineering_Manager", status, 1, ` ${fixture.user.email.toUpperCase()} `)],
    }));
    const excluded = [
      ecr("ECR-OTHER-REVIEWER", "Closed", { approval_requirements: [task("Engineering Manager", "Approved", 1, "other.engineering@netlink.com")] }),
      ecr("ECR-PARTIAL-IDENTITY", "Closed", { approval_requirements: [task("Engineering Manager", "Approved", 1, "engineering")] }),
      ecr("ECR-DISPLAY-NAME", "Closed", { approval_requirements: [task("Engineering Manager", "Approved", 1, "Engineering Manager")] }),
      ecr("ECR-FINANCE-DECISION", "Closed", { approval_requirements: [task("Finance Manager", "Approved", 1, fixture.user.email)] }),
      ecr("ECR-PENDING-HISTORICAL", "Closed", { approval_requirements: [task("Engineering Manager", "Pending", 1, fixture.user.email)] }),
      ecr("ECR-MISSING-APPROVER", "Closed", { approval_requirements: [task("Engineering Manager", "Approved")] }),
    ];
    const data = engineeringManagerDashboardData([...rows, ...excluded], fixture.user);
    expect(data.relevantCount).toBe(3);
    expect(data.recent.map((row) => row.name).sort()).toEqual(rows.map((row) => row.name).sort());
    expect(engineeringManagerDashboardData([...rows, ...excluded], null).recent).toEqual([]);
  });

  it("counts only extended cases at saved preparation stages as downstream visibility", () => {
    const ready = [
      ecr("ECR-BC-TECHNICAL", "Technical Approved", { ecr_workflow_version: "extended_v1" }),
      ecr("ECR-BC-PREP", "Business Case Preparation", { ecr_workflow_version: "extended_v1" }),
    ];
    const excluded = [
      ecr("ECR-LEGACY-PREP", "Technical Approved"),
      ecr("ECR-BC-FINANCE", "Finance Review", { ecr_workflow_version: "extended_v1" }),
      ecr("ECR-BC-APPROVED", "Business Case Approved", { ecr_workflow_version: "extended_v1" }),
      ecr("ECR-BC-RFQ", "Technical Approved", { ecr_workflow_version: "extended_v1", rfq: "PUR-RFQ-EXISTING" }),
      ecr("ECR-BC-DRAFT", "Draft", { ecr_workflow_version: "extended_v1" }),
    ];
    fixture.query.data = [...ready, ...excluded];
    expect(engineeringManagerDashboardData(fixture.query.data, fixture.user).businessCasesToPrepare).toBe(2);
    for (const row of ready) expect(getECRListActionLabel("engineering", row, fixture.user)).toBe("View");
    expect(cardCounts(section(render(), "engineering-manager-actions-heading"))[2]).toBe("2");
    expect(tableBody(render())).not.toContain("ECR-BC-TECHNICAL");
  });

  it("does not announce all actions complete while review or revision is pending", () => {
    expect(render()).not.toContain("No engineering actions pending");
    fixture.query.data = [ecr("ECR-REVISION", "Technical Approved", {
      ecr_workflow_version: "extended_v1", approval_requirements: [task("Engineering Manager", "Sent Back")],
    })];
    expect(render()).not.toContain("No engineering actions pending");
  });

  it("shares the existing manager ECR list fetch, cache key and permission scope", async () => {
    render();
    expect(fixture.options?.queryKey).toEqual(["ecr-list", "engineering", "all"]);
    expect(fixture.options?.staleTime).toBe(30_000);
    await fixture.options?.queryFn();
    expect(fixture.fetchList).toHaveBeenCalledExactlyOnceWith({ limit: 300 });
  });

  it("shows unavailable counts and a compact loading row rather than fabricated zeros or stale records", () => {
    fixture.query.isLoading = true;
    const html = render();
    expect(html).toContain(">Engineering Manager Dashboard</h1>");
    expect(cardCounts(section(html, "engineering-overview-heading"))).toEqual(Array(5).fill("—"));
    expect(cardCounts(section(html, "engineering-manager-actions-heading"))).toEqual(Array(4).fill("—"));
    expect(tableBody(html)).toContain("Loading engineering changes…");
    expect(tableBody(html)).not.toContain("ECR-LEGACY-REVIEW");
    expect(html).not.toContain("No engineering actions pending");
  });

  it("preserves actionable error feedback and hides stale counts and rows until retry succeeds", () => {
    fixture.query.isError = true;
    let html = render();
    expect(html).toContain("Unable to load dashboard data.");
    expect(html).toContain(">Retry</button>");
    expect(cardCounts(section(html, "engineering-overview-heading"))).toEqual(Array(5).fill("—"));
    expect(cardCounts(section(html, "engineering-manager-actions-heading"))).toEqual(Array(4).fill("—"));
    expect(tableBody(html)).toContain("Engineering changes are unavailable. Retry above.");
    expect(tableBody(html)).not.toContain("ECR-LEGACY-REVIEW");
    expect(html).not.toContain("No engineering actions pending");
    fixture.query.error = new Error("ECR service timed out");
    html = render();
    expect(html).toContain("ECR service timed out");
  });

  it("keeps a compact disabled Refresh control while a refresh is in flight", () => {
    fixture.query.isFetching = true;
    expect(render()).toMatch(/<button[^>]*class="engineer-ecr-button"[^>]*disabled=""/);
  });
});
