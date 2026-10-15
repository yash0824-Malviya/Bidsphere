import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ user: { role: "engineer", email: "engineer@example.com" } }));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
}));
vi.mock("./EngineerMyECRsPage", () => ({
  default: () => <main data-page="my-ecrs">My ECR list</main>,
}));
vi.mock("./EngineerBusinessCasesPage", () => ({
  default: () => <main data-page="business-cases">Business Case queue</main>,
}));
vi.mock("./EngineerTechnicalReviewPage", () => ({
  default: () => <main data-page="technical-review">Technical Review queue</main>,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}));

import ECRListPage from "./ECRListPage";

describe("Engineer ECR page routing", () => {
  beforeEach(() => {
    fixture.user.role = "engineer";
  });

  it.each([
    ["/ecr", "my-ecrs"],
    ["/ecr?filter=mine", "my-ecrs"],
    ["/ecr?filter=draft", "my-ecrs"],
    ["/ecr?filter=pending-approval", "my-ecrs"],
    ["/ecr?filter=sent-back", "my-ecrs"],
    ["/ecr?filter=approved", "my-ecrs"],
    ["/ecr?filter=closed", "my-ecrs"],
    ["/ecr?filter=technical-review", "technical-review"],
    ["/ecr?filter=engineering", "technical-review"],
    ["/ecr?filter=eng_review", "technical-review"],
    ["/ecr?filter=business-case", "business-cases"],
    ["/ecr?filter=business-case-preparation", "business-cases"],
    ["/ecr?filter=business_case_approved", "business-cases"],
  ])("renders only the matching page on %s", (route, page) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><ECRListPage /></MemoryRouter>);
    expect(html).toContain(`data-page="${page}"`);
    expect(html.match(/data-page=/g)).toHaveLength(1);
    expect(html).not.toContain("Engineering Action Center");
    expect(html).not.toContain("ECR Status Overview");
  });

  it("changes the page with query navigation and browser back/forward history", async () => {
    const router = createMemoryRouter([{ path: "/ecr", element: <ECRListPage /> }], {
      initialEntries: ["/ecr"],
    });
    const html = () => renderToStaticMarkup(<RouterProvider router={router} />);
    try {
      expect(html()).toContain('data-page="my-ecrs"');
      await router.navigate("/ecr?filter=business-case");
      expect(html()).toContain('data-page="business-cases"');
      expect(html()).not.toContain('data-page="my-ecrs"');
      await router.navigate("/ecr?filter=technical-review");
      expect(html()).toContain('data-page="technical-review"');
      expect(html()).not.toContain('data-page="business-cases"');
      await router.navigate(-1);
      expect(html()).toContain('data-page="business-cases"');
      await router.navigate(-1);
      expect(html()).toContain('data-page="my-ecrs"');
      await router.navigate(1);
      expect(html()).toContain('data-page="business-cases"');
    } finally {
      router.dispose();
    }
  });

  it("retains the existing list for other roles", () => {
    fixture.user.role = "procurement";
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr?filter=business-case"]}><ECRListPage /></MemoryRouter>);
    expect(html).toContain("ECR Reference");
    expect(html).not.toContain("data-page=");
  });
});
