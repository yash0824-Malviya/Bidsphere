import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicAppUrl,
  getConfiguredPublicOrigin,
  getPublicAppOrigin,
  isPublicAppOriginLoopback,
} from "./publicAppUrl";

describe("publicAppUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads configured origin from VITE_PUBLIC_URL / VITE_APP_BASE_URL", () => {
    vi.stubEnv("VITE_PUBLIC_URL", "http://192.168.1.50:5175/");
    expect(getConfiguredPublicOrigin()).toBe("http://192.168.1.50:5175");

    vi.stubEnv("VITE_PUBLIC_URL", "");
    vi.stubEnv("VITE_APP_BASE_URL", "https://bidsphere.example.com");
    expect(getConfiguredPublicOrigin()).toBe("https://bidsphere.example.com");
  });

  it("prefers active non-loopback window origin over env", () => {
    vi.stubEnv("VITE_PUBLIC_URL", "http://10.0.0.1:5175");
    vi.stubGlobal("window", {
      location: { origin: "http://192.168.10.20:5175" },
    });
    expect(getPublicAppOrigin()).toBe("http://192.168.10.20:5175");
    expect(isPublicAppOriginLoopback()).toBe(false);
  });

  it("falls back to env when browsing localhost", () => {
    vi.stubEnv("VITE_PUBLIC_URL", "http://192.168.10.20:5175");
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5175" },
    });
    expect(getPublicAppOrigin()).toBe("http://192.168.10.20:5175");
    expect(buildPublicAppUrl("/verify/material-issue?issue=X")).toBe(
      "http://192.168.10.20:5175/verify/material-issue?issue=X",
    );
  });

  it("flags loopback when no public origin is configured", () => {
    vi.stubEnv("VITE_PUBLIC_URL", "");
    vi.stubEnv("VITE_APP_BASE_URL", "");
    vi.stubEnv("VITE_SITE_URL", "");
    vi.stubEnv("VITE_APP_URL", "");
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:5175" },
    });
    expect(isPublicAppOriginLoopback()).toBe(true);
  });
});
