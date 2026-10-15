import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: "engineering" } }) }));
vi.mock("./EngineeringReviewPage", () => ({ default: () => <main data-page="review">Engineering Review queue</main> }));
vi.mock("./EngineeringECRListPage", () => ({ default: () => <main data-page="all">All ECR list</main> }));
vi.mock("./EngineerBusinessCasesPage", () => ({ default: ({ role }: { role: string }) => <main data-page="business-cases" data-role={role}>Business Case list</main> }));
import ECRListPage from "./ECRListPage";

describe("Engineering Manager page separation", () => {
  it.each([
    ["/ecr", "all"], ["/ecr?filter=all", "all"], ["/ecr?filter=mine", "all"],
    ["/ecr?filter=pending-approval", "all"], ["/ecr?filter=sent-back", "all"],
    ["/ecr?filter=approved", "all"], ["/ecr?filter=closed", "all"],
    ["/ecr?filter=engineering", "review"], ["/ecr?filter=eng_review", "review"],
    ["/ecr?filter=technical-review", "review"], ["/ecr?filter=business-case", "business-cases"],
  ])("renders the correct standalone page at %s", (route, page) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><ECRListPage /></MemoryRouter>);
    expect(html).toContain(`data-page="${page}"`);
    expect(html.match(/data-page=/g)).toHaveLength(1);
    if (page === "business-cases") expect(html).toContain('data-role="engineering"');
    expect(html).not.toContain("Engineering Review Queue</h2>");
    expect(html).not.toContain("ECR queues");
  });

  it("replaces pages and restores the right component with back/forward", async () => {
    const router = createMemoryRouter([{ path: "/ecr", element: <ECRListPage /> }], { initialEntries: ["/ecr"] });
    const html = () => renderToStaticMarkup(<RouterProvider router={router} />);
    try {
      expect(html()).toContain('data-page="all"');
      await router.navigate("/ecr?filter=engineering");
      expect(html()).toContain('data-page="review"');
      expect(html()).not.toContain('data-page="all"');
      await router.navigate("/ecr?filter=business-case");
      expect(html()).toContain('data-page="business-cases"');
      expect(html()).not.toContain('data-page="review"');
      await router.navigate(-1);
      expect(html()).toContain('data-page="review"');
      await router.navigate(-1);
      expect(html()).toContain('data-page="all"');
      await router.navigate(1);
      expect(html()).toContain('data-page="review"');
    } finally { router.dispose(); }
  });
});
