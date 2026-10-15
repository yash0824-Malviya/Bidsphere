import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SupplierLoginPage from "./SupplierLoginPage";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      { name: "SUP-00001", supplier_name: "Acme Corp" },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      hasHydrated: true,
      isAuthenticated: false,
      user: null,
    }),
}));

vi.mock("../../hooks/useDocumentTitle", () => ({
  useDocumentTitle: () => {},
}));

vi.mock("../../hooks/useSupplierSession", () => ({
  readSupplierSession: () => null,
  writeSupplierSession: () => {},
}));

vi.mock("../../utils/portalAuth", () => ({
  readStoredPortalAffinity: () => null,
  detectAuthSource: () => null,
  getActivePortal: () => null,
  logPortalAuthDecision: () => {},
  PORTAL_LOGIN_PATH: "/supplier/login",
  replacePreviousStaffSession: () => {},
  setActivePortal: () => {},
  setLoginPortalAffinity: () => {},
}));

describe("SupplierLoginPage - 4-digit Company PIN UI", () => {
  it("renders exactly 4 PIN input boxes in a 4-column layout", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/supplier/login?tab=pin"]}>
        <SupplierLoginPage />
      </MemoryRouter>
    );

    // Verify 4-column grid
    expect(html).toContain("grid-cols-4");

    // Match all input elements that have supplier-login-pin-box class
    const pinMatches = html.match(/supplier-login-pin-box/g);
    expect(pinMatches).not.toBeNull();
    expect(pinMatches?.length).toBe(4);

    // Verify exactly 4 input type="password" fields
    const inputMatches = html.match(/type="password"[^>]*supplier-login-pin-box/g) ||
      html.match(/supplier-login-pin-box[^>]*type="password"/g);
    expect(inputMatches).not.toBeNull();
    expect(inputMatches?.length).toBe(4);
  });

  it("does not render 5 or 6 PIN boxes", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/supplier/login?tab=pin"]}>
        <SupplierLoginPage />
      </MemoryRouter>
    );

    const pinMatches = html.match(/supplier-login-pin-box/g);
    expect(pinMatches?.length).not.toBe(5);
    expect(pinMatches?.length).not.toBe(6);
    expect(pinMatches?.length).toBe(4);
  });
});
