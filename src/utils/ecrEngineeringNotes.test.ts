import { describe, expect, it } from "vitest";

import {
  parseECREngineeringNotes,
  serializeECREngineeringNotes,
} from "./ecrEngineeringNotes";

describe("ECR engineering note sections", () => {
  it("hydrates legacy labeled sections and preserves multiline values", () => {
    const parsed = parseECREngineeringNotes([
      "General engineer note.",
      "",
      "Cost Impact: 1200 USD",
      "Customer Impact: First line",
      "second line",
      "Technical Requirements: PPAP level 3",
      "Quality Requirements: Cpk >= 1.67",
    ].join("\n"));

    expect(parsed.engineeringNotes).toBe("General engineer note.");
    expect(parsed.costImpact).toBe("1200 USD");
    expect(parsed.customerImpact).toBe("First line\nsecond line");
    expect(parsed.technicalRequirements).toBe("PPAP level 3");
    expect(parsed.qualityRequirements).toBe("Cpk >= 1.67");
  });

  it("round-trips without duplicating structured labels", () => {
    const once = serializeECREngineeringNotes({
      engineeringNotes: "Base note",
      supplierImpact: "New source needed",
      commercialRequirements: "Net 30",
    });
    const twice = serializeECREngineeringNotes(parseECREngineeringNotes(once));

    expect(twice).toBe(once);
    expect(twice.match(/Supplier Impact:/g)).toHaveLength(1);
  });
});
