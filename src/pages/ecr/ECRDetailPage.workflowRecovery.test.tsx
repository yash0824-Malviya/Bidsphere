import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ECRWorkflowActionResult } from "../../api/ecr";

const fixture = vi.hoisted(() => ({
  ecr: {
    name: "internal-ecr-id", ecr_number: "ECR-2026-100010", ecr_title: "Latch update",
    ecr_owner: "engineer@example.com", select_pxfp: "Draft", ecr_workflow_version: "extended_v1",
    modified: "2026-09-15 12:00:00", approval_requirements: [],
  },
  mutations: [] as Array<{
    onSuccess?: (result: ECRWorkflowActionResult) => void;
    onError?: (error: Error) => void;
    onSettled?: (result: ECRWorkflowActionResult | undefined, error: Error | null) => Promise<void>;
  }>,
  refresh: vi.fn(async () => undefined),
  notify: vi.fn(),
  qc: { setQueryData: vi.fn(), getQueryData: vi.fn(), invalidateQueries: vi.fn() },
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { role: "engineer", name: "engineer@example.com", email: "engineer@example.com" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "ecr" ? fixture.ecr : [], isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMutation: (options: (typeof fixture.mutations)[number]) => {
    fixture.mutations.push(options);
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => fixture.qc,
}));
vi.mock("../../utils/ecrQueryCache", () => ({ refreshECRQueries: fixture.refresh }));
vi.mock("../../api/ecrBusinessCase", () => ({ notifyECRStageChange: fixture.notify }));
import ECRDetailPage from "./ECRDetailPage";

function workflow() {
  renderToStaticMarkup(<MemoryRouter initialEntries={["/ecr/ECR-2026-100010"]}><Routes>
    <Route path="/ecr/:name" element={<ECRDetailPage />} />
  </Routes></MemoryRouter>);
  return fixture.mutations.find((mutation) => mutation.onSettled)!;
}

describe("ECR detail workflow response recovery", () => {
  beforeEach(() => {
    fixture.mutations = [];
    vi.clearAllMocks();
    fixture.qc.getQueryData.mockReturnValue({ ...fixture.ecr, select_pxfp: "Engineering Review" });
  });

  it("re-reads the persisted stage after a reported workflow failure without notifying a transition", async () => {
    const action = workflow();
    const failure = { success: false, message: "ERPNext did not persist the extended ECR workflow data." };
    action.onSuccess!(failure);
    await action.onSettled!(failure, null);

    expect(fixture.refresh).toHaveBeenCalledWith(fixture.qc, ["ECR-2026-100010", "internal-ecr-id", "ECR-2026-100010"]);
    expect(fixture.qc.setQueryData).not.toHaveBeenCalled();
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  it("refreshes after a thrown response error without claiming success", async () => {
    const action = workflow();
    const failure = new Error("Connection closed after save");
    action.onError!(failure);
    await action.onSettled!(undefined, failure);

    expect(fixture.refresh).toHaveBeenCalledTimes(1);
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  it("refreshes counters after success and uses the refreshed ECR for the stage notification", async () => {
    const action = workflow();
    const result = { success: true, newStatus: "Engineering Review" as const };
    action.onSuccess!(result);
    await action.onSettled!(result, null);

    expect(fixture.refresh).toHaveBeenCalledTimes(1);
    expect(fixture.notify).toHaveBeenCalledWith(expect.objectContaining({ select_pxfp: "Engineering Review" }));
  });
});
