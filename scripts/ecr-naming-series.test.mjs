import { describe, expect, it, vi } from "vitest";
import {
  ECR_AUTONAME_PATTERN,
  ecrSeriesPrefix,
  ensureEcrNamingSeriesCounter,
} from "./ecr-naming-series.mjs";

describe("ECR naming-series migration", () => {
  it("uses a Frappe-valid disjoint six-digit expression", () => {
    expect(ECR_AUTONAME_PATTERN).toBe("ECR-.YYYY.-1.#####");
    expect(ecrSeriesPrefix(2026)).toBe("ECR-2026-1");
  });

  it("raises the Frappe counter to the greatest persisted document suffix", async () => {
    let current = 2;
    const rows = [{ name: "ECR-2026-100007" }];
    const api = vi.fn(async (method, _path, body) => {
      if (method === "GET") return { modified: "now" };
      const docs = JSON.parse(body.docs);
      if (body.method === "get_current") return current;
      if (body.method === "update_series_start") {
        current = docs.current_value;
        return undefined;
      }
      throw new Error("unexpected method");
    });
    const result = await ensureEcrNamingSeriesCounter({
      api,
      loadRows: async () => rows,
      year: 2026,
    });
    expect(result).toEqual({ prefix: "ECR-2026-1", current: 7, floor: 7 });
    expect(api).toHaveBeenCalledWith(
      "POST",
      "/api/method/run_doc_method",
      expect.objectContaining({ method: "update_series_start" }),
    );
  });

  it("never lowers a counter and fails closed when the band is exhausted", async () => {
    const api = vi.fn(async (method, _path, body) => {
      if (method === "GET") return {};
      if (body.method === "get_current") return 99999;
      throw new Error("counter must not be updated");
    });
    await expect(ensureEcrNamingSeriesCounter({
      api,
      loadRows: async () => [],
      year: 2026,
    })).rejects.toThrow(/exhausted/i);
  });
});
