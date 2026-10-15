import { describe, it, expect, vi, afterEach } from "vitest";
import { generateId } from "./id";

describe("generateId utility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("uses crypto.randomUUID when available (secure context / localhost)", () => {
    const id = generateId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("falls back to crypto.getRandomValues when crypto.randomUUID is not a function (HTTP VM deployment)", () => {
    // Simulate HTTP non-secure context where randomUUID is undefined
    const mockCrypto = {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = (i * 37) % 256;
        }
        return arr;
      },
    };

    vi.stubGlobal("crypto", mockCrypto);

    const id = generateId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("falls back to RFC4122 v4 math fallback if crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    const id = generateId();
    expect(id).toMatch(UUID_V4_REGEX);
  });
});
