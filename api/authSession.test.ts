import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateWithPassword } from "./authSession";
import { verifyAccessToken } from "./rbacAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("server-owned ERP authentication", () => {
  beforeEach(() => {
    vi.stubEnv("ERPNEXT_URL", "https://erp.example.test");
    vi.stubEnv("ERP_API_KEY", "api-key");
    vi.stubEnv("ERP_API_SECRET", "api-secret");
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves canonical User.name and actual email for username login", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "Logged In" }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          name: "engineer",
          email: "Engineer@Netlink.com",
          enabled: 1,
          roles: [{ role: "Engineer" }],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await authenticateWithPassword({ usr: "engineer", pwd: "valid" });
    expect(result).toMatchObject({
      name: "engineer",
      email: "engineer@netlink.com",
      role: "engineer",
    });
    expect(verifyAccessToken(result.access_token)).toMatchObject({
      sub: "engineer",
      email: "engineer@netlink.com",
      role: "engineer",
    });
  });

  it.each([
    ["the manager role", ["Procurement Manager"]],
    [
      "mixed manager and team roles",
      ["Procurement Manager", "Procurement Team"],
    ],
  ] as const)(
    "resolves and signs procurement@netlink.com as canonical procurement with %s",
    async (_scenario, erpRoles) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ message: "Logged In" }))
        .mockResolvedValueOnce(jsonResponse({
          data: {
            name: "procurement@netlink.com",
            email: "Procurement@Netlink.com",
            enabled: 1,
            roles: erpRoles.map((role) => ({ role })),
          },
        }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await authenticateWithPassword({
        usr: "procurement@netlink.com",
        pwd: "valid",
      });

      expect(result).toMatchObject({
        name: "procurement@netlink.com",
        email: "procurement@netlink.com",
        role: "procurement",
        erpnext_roles: [...erpRoles],
      });
      expect(verifyAccessToken(result.access_token)).toMatchObject({
        typ: "internal",
        sub: "procurement@netlink.com",
        email: "procurement@netlink.com",
        role: "procurement",
      });
    },
  );

  it("fails closed when server role lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "Logged In" }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503)));

    await expect(authenticateWithPassword({ usr: "engineer", pwd: "valid" }))
      .rejects.toMatchObject({ status: 502 });
  });

  it("does not restore a revoked role from a known email", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "Logged In" }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          name: "procurement@netlink.com",
          email: "procurement@netlink.com",
          enabled: 1,
          roles: [],
        },
      })));

    await expect(authenticateWithPassword({
      usr: "procurement@netlink.com",
      pwd: "valid",
    })).rejects.toMatchObject({ status: 403 });
  });
});
