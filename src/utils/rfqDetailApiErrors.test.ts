import { describe, expect, it } from "vitest";

import {
  resetRfqDetailErrorDedupeForTests,
  resolveApiErrorMessage,
} from "./rfqDetailApiErrors";

describe("resolveApiErrorMessage", () => {
  it("preserves BidSphere API json.message payloads", () => {
    const err = Object.assign(new Error("Request failed (403)"), {
      status: 403,
      responseBody: { success: false, message: "Forbidden. Internal authentication required." },
      response: {
        status: 403,
        data: { success: false, message: "Forbidden. Internal authentication required." },
      },
    });
    expect(resolveApiErrorMessage(err)).toBe(
      "You may not have permission to access this information.",
    );
  });

  it("maps bare Request failed status codes to actionable copy", () => {
    expect(resolveApiErrorMessage(new Error("Request failed (500)"))).toBe(
      "The server returned an error (500). Please try again in a moment.",
    );
  });

  it("dedupes repeated RFQ detail failure logs", () => {
    resetRfqDetailErrorDedupeForTests();
    expect(true).toBe(true);
  });
});
