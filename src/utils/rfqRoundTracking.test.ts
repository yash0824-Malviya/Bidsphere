import { describe, expect, it } from "vitest";

import {
  buildRfqRoundTrackingId,
  formatRfqRoundLabel,
  parseRfqRoundNumberFromTrackingId,
} from "./rfqRoundTracking";

describe("rfqRoundTracking", () => {
  it("builds tracking IDs with zero-padded round suffix", () => {
    expect(buildRfqRoundTrackingId("PUR-RFQ-2026-00074", 1)).toBe(
      "PUR-RFQ-2026-00074-R01",
    );
    expect(buildRfqRoundTrackingId("PUR-RFQ-2026-00074", 3)).toBe(
      "PUR-RFQ-2026-00074-R03",
    );
  });

  it("formats round labels", () => {
    expect(formatRfqRoundLabel(2)).toBe("R02");
  });

  it("parses round number from tracking ID", () => {
    expect(parseRfqRoundNumberFromTrackingId("PUR-RFQ-2026-00074-R04")).toBe(4);
    expect(parseRfqRoundNumberFromTrackingId("invalid")).toBeNull();
  });
});
