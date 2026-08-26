import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: {
    name: "procurement@netlink.com",
    email: "procurement@netlink.com",
    full_name: "Procurement Manager",
    // Exercise the supported legacy value at the actual page boundary.
    role: "Procurement Manager",
  },
}));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

vi.mock("../../components/dashboard/ProcurementDashboard", () => ({
  default: ({ greetingName }: { greetingName: string }) => (
    <div>Procurement Manager Dashboard — {greetingName}</div>
  ),
}));

import DashboardPage from "./DashboardPage";

async function renderPage(): Promise<string> {
  const stream = await renderToReadableStream(<DashboardPage />);
  await stream.allReady;
  return new Response(stream).text();
}

describe("DashboardPage Procurement Manager routing", () => {
  it("renders the procurement overview instead of RFQ Creation", async () => {
    const html = await renderPage();

    expect(html).toContain("Procurement Manager Dashboard");
    expect(html).not.toContain("RFQ Creation");
  });
});
