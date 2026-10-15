import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ user: { role: "engineer" } }));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
vi.mock("../../hooks/useProcurementBadges", () => ({
  useProcurementBadges: () => ({}),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../i18n/navLabels", () => ({
  translateNavLabel: (_t: unknown, label: string) => label,
}));

import Sidebar, { type SidebarVariant } from "./Sidebar";

function renderSidebar(route: string, variant: SidebarVariant = "full") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar variant={variant} />
    </MemoryRouter>,
  );
}

function currentLinks(html: string): string[] {
  return [...html.matchAll(/<a\b([^>]*)>/g)]
    .filter(([, attrs]) => attrs.includes('aria-current="page"'))
    .map(([, attrs]) => attrs.match(/href="([^"]+)"/)?.[1] ?? "");
}

describe("Engineer sidebar presentation", () => {
  beforeEach(() => {
    fixture.user.role = "engineer";
  });

  it.each<SidebarVariant>(["full", "compact", "drawer"])(
    "shows existing Engineer links under compact section headings in %s mode",
    (variant) => {
      const html = renderSidebar("/ecr", variant);

      expect(html).toContain(">WORKSPACE</p>");
      expect(html).toContain(">BUSINESS INTAKE</p>");
      expect(html).toContain(">ENGINEERING CHANGES</p>");
      expect(html).not.toMatch(/contracts|contract lifecycle|clm/i);
      expect(html).toContain(">Help</p>");
      for (const destination of [
        "/dashboard",
        "/ecr?filter=technical-review",
        "/ecr",
        "/ecr/new",
        "/ecr?filter=business-case",
        "/support/help-desk",
      ]) {
        expect(html).toContain(`href="${destination}"`);
      }
      expect(html).toContain(">Technical Review</span>");
      expect(html).not.toContain(">Engineering Changes</span>");
      expect(html).not.toContain(">Business Intake</span>");
      expect(html).not.toContain("/account/profile");
      expect(html).not.toContain("/sourcing/rfq");
    },
  );

  it.each([
    ["/dashboard", "/dashboard"],
    ["/ecr", "/ecr"],
    ["/ecr?filter=mine", "/ecr"],
    ["/ecr?filter=draft", "/ecr"],
    ["/ecr?filter=pending-approval", "/ecr"],
    ["/ecr?filter=sent-back", "/ecr"],
    ["/ecr?filter=approved", "/ecr"],
    ["/ecr?filter=closed", "/ecr"],
    ["/ecr?filter=technical-review", "/ecr?filter=technical-review"],
    ["/ecr?filter=engineering", "/ecr?filter=technical-review"],
    ["/ecr?filter=eng_review", "/ecr?filter=technical-review"],
    ["/ecr?filter=business-case", "/ecr?filter=business-case"],
    ["/ecr?filter=business-case-preparation", "/ecr?filter=business-case"],
    ["/ecr?filter=business_case_approved", "/ecr?filter=business-case"],
    ["/ecr/new", "/ecr/new"],
    ["/ecr/ECR-2026-0001", "/ecr"],
    ["/ecr/ECR-2026-0001/edit", "/ecr"],
    ["/ecr/ECR-2026-0001/business-case", "/ecr?filter=business-case"],
    ["/support/help-desk", "/support/help-desk"],
  ])("highlights only the matching promoted link on %s", (route, destination) => {
    expect(currentLinks(renderSidebar(route))).toEqual([destination]);
  });

  it("keeps promoted links accessible and query-aware when collapsed", () => {
    const html = renderSidebar("/ecr?filter=business-case", "collapsed");

    expect(html).toContain('title="Technical Review"');
    expect(html).toContain('title="My ECRs"');
    expect(html).toContain('title="New ECR"');
    expect(html).toContain('title="Business Cases"');
    expect(html).toContain('title="Help"');
    expect(html).not.toMatch(/contracts|contract lifecycle|clm/i);
    expect(html).not.toContain(">ENGINEERING CHANGES</p>");
    expect(currentLinks(html)).toEqual(["/ecr?filter=business-case"]);
  });

  it("preserves the expandable module navigation for other ECR roles", () => {
    fixture.user.role = "finance";
    const html = renderSidebar("/ecr");

    expect(html).toContain(">Engineering Changes</span>");
    expect(html).toContain(">Business Intake</span>");
    expect(html).not.toContain(">ENGINEERING CHANGES</p>");
    expect(html).not.toContain(">Help</p>");
  });

  it("keeps existing Intake pages independent of the Engineer ECR queues", () => {
    expect(currentLinks(renderSidebar("/intake/business-cases/BC-001"))).toEqual([]);
  });
});
