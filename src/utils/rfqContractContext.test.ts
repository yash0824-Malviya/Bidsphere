import { describe, expect, it } from "vitest";
import { RFQ_CONTRACT_TYPES, validateRfqContractDetails } from "./rfqContractContext";

const valid = { contract_type: RFQ_CONTRACT_TYPES[0], contract_purpose: "Procure steel", description: "The awarded scope", contract_start_date: "2028-02-29", contract_end_date: "2028-03-31" };
describe("RFQ award contract details", () => {
  it("requires an explicit supported type and nonblank purpose/description", () => {
    expect(validateRfqContractDetails({ ...valid, contract_type: "", contract_purpose: "  ", description: "" })).toHaveProperty("contract_type");
    expect(validateRfqContractDetails({ ...valid, contract_type: "Supplier Agreement" })).toHaveProperty("contract_type");
    expect(validateRfqContractDetails({ ...valid, contract_type: "Supplier Agreement" }, { requireType: false })).toEqual({});
    for (const contract_type of RFQ_CONTRACT_TYPES) expect(validateRfqContractDetails({ ...valid, contract_type })).toEqual({});
  });
  it("validates real calendar dates, leap years, and the date order", () => {
    expect(validateRfqContractDetails(valid)).toEqual({});
    expect(validateRfqContractDetails({ ...valid, contract_start_date: "2027-02-29" })).toHaveProperty("contract_start_date");
    expect(validateRfqContractDetails({ ...valid, contract_end_date: "2028-04-31" })).toHaveProperty("contract_end_date");
    expect(validateRfqContractDetails({ ...valid, contract_end_date: "2028-02-28" })).toHaveProperty("contract_end_date");
    expect(validateRfqContractDetails({ ...valid, contract_end_date: "2028-02-29" })).toHaveProperty("contract_end_date");
  });
});
