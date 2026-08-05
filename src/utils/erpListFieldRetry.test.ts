import { describe, expect, it } from "vitest";
import {
  extractForbiddenField,
  isFieldPermissionError,
  nextFieldsAfterPermissionError,
} from "./erpListFieldRetry";

describe("erpListFieldRetry", () => {
  it("extracts the forbidden field from ERPNext 417 messages", () => {
    expect(
      extractForbiddenField(
        new Error(
          "frappe.exceptions.DataError: Field not permitted in query: custom_part_name",
        ),
      ),
    ).toBe("custom_part_name");
  });

  it("detects field permission errors", () => {
    expect(
      isFieldPermissionError(
        new Error("Field not permitted in query: custom_part_name"),
      ),
    ).toBe(true);
  });

  it("strips only the named forbidden field for retry", () => {
    const fields = [
      "name",
      "item_code",
      "custom_part_name",
      "custom_procurement_type",
    ];
    const next = nextFieldsAfterPermissionError(
      fields,
      new Error("Field not permitted in query: custom_part_name"),
    );
    expect(next).toEqual({
      fields: ["name", "item_code", "custom_procurement_type"],
      removed: ["custom_part_name"],
    });
  });

  it("drops all custom_* when the error is generic", () => {
    const fields = ["name", "item_code", "custom_part_name", "custom_procurement_type"];
    const next = nextFieldsAfterPermissionError(
      fields,
      new Error("DataError: Unknown column custom_x"),
    );
    expect(next?.removed).toEqual([
      "custom_part_name",
      "custom_procurement_type",
    ]);
    expect(next?.fields).toEqual(["name", "item_code"]);
  });
});
