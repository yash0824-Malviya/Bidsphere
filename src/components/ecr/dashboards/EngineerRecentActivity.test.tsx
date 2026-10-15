import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../../types/erpnext";
import type { EngineerECRActivityEvent } from "./engineerEcrActivity";

interface ActivityQueryOptions {
  queryKey: unknown[];
  queryFn: () => Promise<EngineerECRActivityEvent[]>;
  enabled: boolean;
}

const fixture = vi.hoisted(() => ({
  options: undefined as ActivityQueryOptions | undefined,
  query: {
    data: undefined as EngineerECRActivityEvent[] | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  getComments: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: ActivityQueryOptions) => {
    fixture.options = options;
    return fixture.query;
  },
}));
vi.mock("../../../api/ecr", () => ({ getECRComments: fixture.getComments }));

import EngineerRecentActivity from "./EngineerRecentActivity";

const records = Array.from({ length: 7 }, (_, index) => ({
  name: `private-${index}`,
  ecr_number: `ECR-2026-${100000 + index}`,
  modified: `2026-09-${String(index + 1).padStart(2, "0")} 10:00:00`,
}) as EngineeringChangeRequest);

function render(ecrs = records, loading = false) {
  return renderToStaticMarkup(<MemoryRouter><EngineerRecentActivity ecrs={ecrs} loading={loading} /></MemoryRouter>);
}

beforeEach(() => {
  fixture.options = undefined;
  fixture.query.data = undefined;
  fixture.query.isLoading = false;
  fixture.query.isError = false;
  fixture.getComments.mockReset().mockResolvedValue([]);
});

describe("Engineer recent activity", () => {
  it("reads comments only for the newest five supplied records and keys its cache by those records and versions", async () => {
    render();
    expect(fixture.options?.enabled).toBe(true);
    expect(fixture.options?.queryKey).toEqual([
      "engineer-ecr-activity",
      [...records].reverse().slice(0, 5).map((ecr) => [ecr.name, ecr.modified]),
    ]);
    await fixture.options!.queryFn();
    expect(fixture.getComments.mock.calls.map(([name]) => name)).toEqual([
      "private-6", "private-5", "private-4", "private-3", "private-2",
    ]);
  });

  it("keeps an empty scope disabled and renders the explicit empty state", () => {
    expect(render([])).toContain("No recent activity.");
    expect(fixture.options?.enabled).toBe(false);
    expect(fixture.getComments).not.toHaveBeenCalled();
  });

  it("shows loading instead of a false empty state while scoped records load", () => {
    const html = render([], true);
    expect(html).toContain("Loading recent activity");
    expect(html).not.toContain("No recent activity.");
    expect(fixture.options?.enabled).toBe(false);
  });

  it("shows an unavailable state and retry action when the activity query fails", () => {
    fixture.query.isError = true;
    const html = render();
    expect(html).toContain("Recent activity is unavailable.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No recent activity.");
  });

  it("links real events to their public ECR number and renders even encoded HTML as inert text", () => {
    fixture.query.data = [{
      id: "private-6:comment-1",
      ecrNumber: "ECR-2026-100006",
      content: "<img src=x onerror=alert(1)> Approved & recorded",
      timestamp: "2026-09-07T10:00:00",
      time: new Date("2026-09-07T10:00:00").getTime(),
    }];
    const html = render();
    expect(html).toContain('href="/ecr/ECR-2026-100006"');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; Approved &amp; recorded");
    expect(html).not.toContain("<img");
    expect(html).toContain('dateTime="2026-09-07T10:00:00"');
  });
});
