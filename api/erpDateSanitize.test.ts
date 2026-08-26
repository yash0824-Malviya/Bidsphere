import { describe, expect, it } from "vitest";

import { sanitizeErpPayloadDates } from "./erpDateSanitize";

describe("server ERP date sanitizer", () => {
  it("preserves Frappe optimistic-lock stamps byte-for-byte", () => {
    const modified = "2026-08-26 10:30:00.331567";
    const creation = "2026-08-25 09:15:12.987654";

    const sanitized = sanitizeErpPayloadDates({
      modified,
      creation,
      approval_requirements: [{ modified, creation }],
      reviewed_at: "2026-08-26T10:30:00.331Z",
    });

    expect(sanitized.modified).toBe(modified);
    expect(sanitized.creation).toBe(creation);
    expect(sanitized.approval_requirements).toEqual([{ modified, creation }]);
    expect(sanitized.reviewed_at).toMatch(/^2026-08-26 \d{2}:\d{2}:\d{2}$/);
  });

  it("also preserves a lock stamp passed with a key hint", () => {
    const stamp = "2026-08-26 10:30:00.331567";
    expect(sanitizeErpPayloadDates(stamp, "modified")).toBe(stamp);
  });
});
