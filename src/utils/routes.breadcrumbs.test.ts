import { describe, expect, it } from "vitest";

import { getBreadcrumbs } from "./routes";

describe("getBreadcrumbs", () => {
  it("builds RFQ detail trail with Sourcing (RFx) and raw document id", () => {
    expect(getBreadcrumbs("/sourcing/rfq/PUR-RFQ-2026-00067")).toEqual([
      { label: "Sourcing (RFx)", to: "/sourcing" },
      { label: "RFQs", to: "/sourcing/rfq" },
      { label: "PUR-RFQ-2026-00067", to: "/sourcing/rfq/PUR-RFQ-2026-00067" },
    ]);
  });

  it("preserves document ids across detail modules", () => {
    expect(getBreadcrumbs("/sourcing/rfi/RFI-2026-00001").at(-1)?.label).toBe(
      "RFI-2026-00001",
    );
    expect(getBreadcrumbs("/sourcing/rfp/RFP-2026-00001").at(-1)?.label).toBe(
      "RFP-2026-00001",
    );
    expect(
      getBreadcrumbs("/p2p/purchase-orders/PUR-ORD-2026-00013").at(-1)?.label,
    ).toBe("PUR-ORD-2026-00013");
    expect(getBreadcrumbs("/p2p/grn/MAT-GRN-2026-00002").at(-1)?.label).toBe(
      "MAT-GRN-2026-00002",
    );
    expect(
      getBreadcrumbs("/material-requests/MAT-MR-2026-00001").at(-1)?.label,
    ).toBe("MAT-MR-2026-00001");
    expect(getBreadcrumbs("/p2p/invoices/ACC-PINV-2026-00001").at(-1)?.label).toBe(
      "ACC-PINV-2026-00001",
    );
    expect(getBreadcrumbs("/p2p/payments/ACC-PAY-2026-00001").at(-1)?.label).toBe(
      "ACC-PAY-2026-00001",
    );
  });

  it("builds ECR detail breadcrumb with formatted business ECR Number", () => {
    // Dynamic generated ID like 1j3b9i4moj resolves to ECR-2026-85517
    expect(getBreadcrumbs("/ecr/1j3b9i4moj")).toEqual([
      { label: "ECR", to: "/ecr" },
      { label: "ECR-2026-85517", to: "/ecr/1j3b9i4moj" },
    ]);

    // Already valid ECR Number
    expect(getBreadcrumbs("/ecr/ECR-2026-00042")).toEqual([
      { label: "ECR", to: "/ecr" },
      { label: "ECR-2026-00042", to: "/ecr/ECR-2026-00042" },
    ]);

    // New ECR page
    expect(getBreadcrumbs("/ecr/new")).toEqual([
      { label: "ECR", to: "/ecr" },
      { label: "New Change Request", to: "/ecr/new" },
    ]);
  });
});
