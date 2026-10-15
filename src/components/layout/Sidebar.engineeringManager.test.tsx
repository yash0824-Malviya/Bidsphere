import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: { user: { role: string } }) => unknown) => selector({ user: { role: "engineering" } }),
}));
vi.mock("../../hooks/useProcurementBadges", () => ({ useProcurementBadges: () => ({}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../i18n/navLabels", () => ({ translateNavLabel: (_t: unknown, label: string) => label }));

import Sidebar, { type SidebarVariant } from "./Sidebar";
import { canAccessPath } from "../../config/roles";

function renderSidebar(route: string, variant: SidebarVariant = "full") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><Sidebar variant={variant} /></MemoryRouter>);
}

function activeLinks(html: string): string[] {
  return [...html.matchAll(/<a\b([^>]*)>/g)]
    .filter(([, attrs]) => attrs.includes('aria-current="page"'))
    .map(([, attrs]) => attrs.match(/href="([^"]+)"/)?.[1] ?? "");
}

describe("Engineering Manager sidebar page separation", () => {
  it.each<SidebarVariant>(["full", "compact", "drawer"])("shows separate workspace and action/list links in %s mode", (variant) => {
    const html = renderSidebar("/ecr", variant);
    for (const heading of ["WORKSPACE", "BUSINESS INTAKE", "ENGINEERING CHANGES", "Help"]) {
      expect(html).toContain(`>${heading}</p>`);
    }
    for (const destination of ["/dashboard", "/intake/business-cases", "/ecr?filter=engineering", "/ecr", "/ecr?filter=business-case", "/support/help-desk"]) {
      expect(html).toContain(`href="${destination}"`);
    }
    expect(html).toContain(">Engineering Approvals</span>");
    expect(html).toContain(">Engineering Review</span>");
    expect(html).toContain(">All ECRs</span>");
    expect(html).toContain(">Business Cases</span>");
    expect(html).not.toContain(">Engineering Changes</span>");
    expect(html).not.toContain(">Business Intake</span>");
    // Existing manager permissions remain authoritative; only Engineer can create ECRs.
    expect(html).not.toContain('href="/ecr/new"');
    expect(canAccessPath("engineering", "/ecr/new")).toBe(false);
    // Contract access remains unchanged, but the Engineering workspace has no Contract navigation.
    expect(html).not.toContain(">CONTRACTS</p>");
    expect(html).not.toContain(">Contract Lifecycle</span>");
    expect(html).not.toContain('href="/contracts"');
  });

  it.each([
    ["/dashboard", "/dashboard"],
    ["/ecr", "/ecr"],
    ["/ecr?filter=mine", "/ecr"],
    ["/ecr?filter=pending-approval", "/ecr"],
    ["/ecr?filter=sent-back", "/ecr"],
    ["/ecr?filter=approved", "/ecr"],
    ["/ecr?filter=closed", "/ecr"],
    ["/ecr?filter=engineering", "/ecr?filter=engineering"],
    ["/ecr?filter=eng_review", "/ecr?filter=engineering"],
    ["/ecr?filter=technical-review", "/ecr?filter=engineering"],
    ["/ecr?filter=business-case", "/ecr?filter=business-case"],
    ["/ecr?filter=business-case-preparation", "/ecr?filter=business-case"],
    ["/ecr?filter=business_case_approved", "/ecr?filter=business-case"],
    ["/ecr/ECR-001", "/ecr"],
    ["/ecr/ECR-001/review", "/ecr?filter=engineering"],
    ["/ecr/ECR-001/business-case", "/ecr?filter=business-case"],
    ["/intake/business-cases/BC-001", "/intake/business-cases"],
    ["/support/help-desk", "/support/help-desk"],
  ])("highlights exactly one page link for %s", (route, expected) => {
    expect(activeLinks(renderSidebar(route))).toEqual([expected]);
  });

  it("retains accessible independent links in the collapsed sidebar", () => {
    const html = renderSidebar("/ecr?filter=engineering", "collapsed");
    for (const label of ["Engineering Approvals", "Engineering Review", "All ECRs", "Business Cases", "Help"]) {
      expect(html).toContain(`title="${label}"`);
    }
    expect(activeLinks(html)).toEqual(["/ecr?filter=engineering"]);
  });
});
