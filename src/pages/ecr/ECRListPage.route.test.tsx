import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  user: {
    name: "procurement@netlink.com",
    email: "procurement@netlink.com",
    full_name: "Procurement Manager",
    role: "procurement",
  },
  ecr: {
    name: "ECR-2026-100001",
    ecr_number: "ECR-2026-100001",
    ecr_title: "Supplier bracket change",
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-01",
    chnage_description: "Change bracket.",
    reason_for_change: "Durability",
    select_pxfp: "RFQ Pending",
    docstatus: 1,
    approval_requirements: [
      {
        name: "TASK-PROCUREMENT-MANAGER",
        approval_role: "Procurement Manager",
        status: "Pending",
        required: 1,
      },
    ],
  },
}));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: { user: typeof fixture.user }) => unknown) =>
    selector({ user: fixture.user }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [fixture.ecr],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

import ECRListPage from "./ECRListPage";

describe("Procurement Manager ECR Reference route", () => {
  it("renders /ecr as ECR Reference view with View ECR action and no RFQ creation queue tabs", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/ecr"]}>
        <ECRListPage />
      </MemoryRouter>,
    );

    expect(html).toContain("ECR Reference");
    expect(html).toContain("View engineering change records referenced by procurement activities.");
    expect(html).toContain("Referenced RFQ");
    expect(html).toContain("View ECR");
    expect(html).not.toContain("RFQ Creation");
    expect(html).not.toContain("Create RFQ");
  });
});
