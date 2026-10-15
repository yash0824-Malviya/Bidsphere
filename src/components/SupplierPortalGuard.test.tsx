import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scenario = vi.hoisted(() => ({
  stateIndex: 0,
  staffBlocked: false,
  supplierAuth: "checking" as "checking" | "ready" | "relogin",
  previouslyVerified: false,
  hydrated: true,
  staffAuthenticated: false,
  sessionPresent: true,
  notificationsEnabled: undefined as boolean | undefined,
}));

// Seed the guard at each authentication checkpoint; SSR deliberately runs no
// token/network effects. The nested routes exercise its rendered access gate.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const checkpoints = [
        scenario.staffBlocked,
        scenario.supplierAuth,
        scenario.previouslyVerified,
      ];
      const index = scenario.stateIndex++;
      return actual.useState(index < checkpoints.length ? checkpoints[index] : initial);
    },
  };
});

vi.mock("../store/authStore", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    hasHydrated: scenario.hydrated,
    isAuthenticated: scenario.staffAuthenticated,
    user: scenario.staffAuthenticated ? { name: "Staff", role: "procurement" } : null,
  }),
}));
vi.mock("../hooks/useSupplierSession", () => ({
  readSupplierSession: () => scenario.sessionPresent
    ? { loggedIn: true, supplierName: "SUPPLIER-TEST", unlocked: true }
    : null,
  clearSupplierSession: vi.fn(),
}));
vi.mock("../hooks/useLiveAuctionStartedNotification", () => ({
  LiveAuctionStartedNotifier: () => <span>Auction notifier active</span>,
}));
vi.mock("../utils/supplierAccessAuth", () => ({
  ensureSupplierAccessToken: vi.fn(),
  forceSupplierRelogin: vi.fn(),
}));
vi.mock("../utils/portalAuth", () => ({
  logPortalAuthDecision: vi.fn(),
  replacePreviousStaffSession: vi.fn(),
  PORTAL_LOGIN_PATH: { supplier: "/supplier/login" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled: boolean }) => {
    scenario.notificationsEnabled = options.enabled;
    return { data: [] };
  },
}));
vi.mock("../api/notifications", () => ({ getNotificationsForViewer: vi.fn() }));
vi.mock("../hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("./LanguageSwitcher", () => ({ default: () => null }));
vi.mock("../pages/supplier-portal/SupplierPortalSidebar", () => ({
  default: () => <aside>Business navigation</aside>,
}));
vi.mock("../pages/supplier-portal/SupplierPortalHeaderActions", () => ({
  default: () => <div>Account actions</div>,
}));

import SupplierPortalGuard from "./SupplierPortalGuard";
import SupplierPortalLayout from "../pages/supplier-portal/SupplierPortalLayout";

function renderGuard() {
  scenario.stateIndex = 0;
  return renderToString(
    <MemoryRouter initialEntries={["/supplier/orders"]}>
      <Routes>
        <Route element={<SupplierPortalGuard />}>
          <Route element={<SupplierPortalLayout />}>
            <Route path="/supplier/orders" element={<main>Protected order data</main>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("supplier portal shell authentication gate", () => {
  beforeEach(() => {
    scenario.staffBlocked = false;
    scenario.supplierAuth = "checking";
    scenario.previouslyVerified = false;
    scenario.hydrated = true;
    scenario.staffAuthenticated = false;
    scenario.sessionPresent = true;
    scenario.notificationsEnabled = undefined;
  });

  it("does not render the shell or protected content before initial verification", () => {
    const html = renderGuard();
    expect(html).toContain("Verifying supplier session");
    expect(html).not.toContain("Business navigation");
    expect(html).not.toContain("Protected order data");
    expect(html).not.toContain("Auction notifier active");
    expect(scenario.notificationsEnabled).toBeUndefined();
  });

  it("keeps business navigation visible while hiding content and notifications during revalidation", () => {
    scenario.previouslyVerified = true;
    const html = renderGuard();
    expect(html).toContain("Business navigation");
    expect(html).toContain("Verifying supplier session");
    expect(html).not.toContain("Protected order data");
    expect(html).not.toContain("Auction notifier active");
    expect(scenario.notificationsEnabled).toBe(false);
  });

  it("renders protected content and notifications only when verification is ready", () => {
    scenario.supplierAuth = "ready";
    scenario.previouslyVerified = true;
    const html = renderGuard();
    expect(html).toContain("Business navigation");
    expect(html).toContain("Protected order data");
    expect(html).toContain("Auction notifier active");
    expect(html).not.toContain("Verifying supplier session");
    expect(scenario.notificationsEnabled).toBe(true);
  });

  it.each(["hydration", "staff", "blocked staff", "relogin", "missing session"])(
    "removes the previously verified shell for the %s gate",
    (gate) => {
      scenario.supplierAuth = "ready";
      scenario.previouslyVerified = true;
      if (gate === "hydration") scenario.hydrated = false;
      if (gate === "staff") scenario.staffAuthenticated = true;
      if (gate === "blocked staff") scenario.staffBlocked = true;
      if (gate === "relogin") scenario.supplierAuth = "relogin";
      if (gate === "missing session") scenario.sessionPresent = false;
      const html = renderGuard();
      expect(html).not.toContain("Business navigation");
      expect(html).not.toContain("Protected order data");
      expect(html).not.toContain("Auction notifier active");
      expect(scenario.notificationsEnabled).toBeUndefined();
    },
  );
});
