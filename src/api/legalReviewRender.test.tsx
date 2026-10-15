import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isLoading: true, data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { role: "legal", email: "legal@example.test" } }),
}));
vi.mock("../components/enterprise", () => ({
  AppLoading: () => <div>Loading review</div>,
  EnterpriseError: () => null,
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LegalReviewDetailPage from "../pages/legal/LegalReviewDetailPage";
import LegalESignModal from "../components/legal/LegalESignModal";

describe("RFQ Legal Review initialization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("evaluates all derived signing/checklist hooks without a temporal-dead-zone error", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const render = () => renderToString(<MemoryRouter><LegalReviewDetailPage /></MemoryRouter>);
    expect(render).not.toThrow();
    expect(render()).toContain("Loading review");
  });

  it("RFQ signing uses electronic-signature consent and initially requires confirmation", () => {
    const html = renderToString(<LegalESignModal open workflow="rfq" defaultFullName="Legal Counsel" onClose={() => {}} onContinue={() => {}} />);
    expect(html).toContain("RFQ DOCUMENT E-SIGNATURE");
    expect(html).toContain("typed PDF electronic signature");
    expect(html).toContain("Finance approval follows");
    expect(html).not.toContain("Business Case");
    expect(html).toContain('disabled=""');
  });

  it("preserves the existing Business Case modal default instead of applying the RFQ variant globally", () => {
    const html = renderToString(<LegalESignModal open defaultFullName="Legal Counsel" onClose={() => {}} onContinue={() => {}} />);
    expect(html).toContain("Business Case");
    expect(html).toContain("LEGAL APPROVAL &amp; E-SIGNATURE");
    expect(html).not.toContain("RFQ DOCUMENT E-SIGNATURE");
    expect(html).not.toContain('disabled=""');
  });
});
