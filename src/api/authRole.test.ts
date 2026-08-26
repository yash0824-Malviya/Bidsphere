import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  post: vi.fn(),
  writeAccessToken: vi.fn(),
}));

vi.mock("./erpnext", () => ({
  default: { post: mocks.post },
  apiGet: mocks.apiGet,
}));

vi.mock("../utils/accessToken", () => ({
  writeAccessToken: mocks.writeAccessToken,
}));

import {
  loginWithPassword,
  restoreAuthenticatedUserProfile,
  type LoginResponse,
} from "./auth";

function loginResponse(data: LoginResponse) {
  return { data, status: 200 };
}

describe("server-owned client role resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["procurement.team@netlink.com", "procurement_team"],
    ["procurement.manager@netlink.com", "procurement"],
  ] as const)("keeps the server-issued %s role authoritative", async (email, role) => {
    mocks.post.mockResolvedValue(loginResponse({
      message: "Logged In",
      name: email,
      email,
      role,
      access_token: `signed-${role}`,
      erpnext_roles: ["Procurement Manager", "Procurement Team"],
    }));

    await expect(loginWithPassword(email, "valid-password")).resolves.toMatchObject({
      email,
      role,
      erpnext_roles: ["Procurement Manager", "Procurement Team"],
    });
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(mocks.writeAccessToken).toHaveBeenCalledWith(`signed-${role}`, false);
  });

  it("uses ERP role resolution only for a legacy response without a server role", async () => {
    mocks.post.mockResolvedValue(loginResponse({
      message: "Logged In",
      name: "legacy.manager@netlink.com",
      email: "legacy.manager@netlink.com",
    }));
    mocks.apiGet.mockResolvedValue({
      enabled: 1,
      roles: [{ role: "Purchase Manager" }, { role: "Purchase User" }],
    });

    await expect(loginWithPassword(
      "legacy.manager@netlink.com",
      "valid-password",
    )).resolves.toMatchObject({
      role: "procurement",
      erpnext_roles: ["Purchase Manager", "Purchase User"],
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it.each(["procurement_team", "procurement"] as const)(
    "preserves %s during session restore even when raw ERP roles are ambiguous",
    (role) => {
      expect(restoreAuthenticatedUserProfile({
        name: `${role}@netlink.com`,
        email: `${role}@netlink.com`,
        full_name: "Procurement User",
        role,
        erpnext_roles: ["Procurement Manager", "Procurement Team"],
      })).toMatchObject({
        role,
        erpnext_roles: ["Procurement Manager", "Procurement Team"],
      });
    },
  );
});
