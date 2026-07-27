import { describe, expect, it } from "vitest";
import { resolveStatusTone } from "./StatusBadge";

describe("resolveStatusTone", () => {
  it("maps core procurement statuses to enterprise tones", () => {
    expect(resolveStatusTone("Draft")).toBe("neutral");
    expect(resolveStatusTone("Submitted")).toBe("success");
    expect(resolveStatusTone("Pending Approval")).toBe("pending");
    expect(resolveStatusTone("In Review")).toBe("review");
    expect(resolveStatusTone("Under Legal Review")).toBe("review");
    expect(resolveStatusTone("Rejected")).toBe("danger");
    expect(resolveStatusTone("Cancelled")).toBe("cancelled");
    expect(resolveStatusTone("Awarded")).toBe("awarded");
    expect(resolveStatusTone("Closed")).toBe("closed");
  });

  it("is case-insensitive", () => {
    expect(resolveStatusTone("submitted")).toBe("success");
    expect(resolveStatusTone("CANCELLED")).toBe("cancelled");
  });
});
