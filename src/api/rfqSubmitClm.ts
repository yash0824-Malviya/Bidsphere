import { submitRFQ } from "./sourcing";
import type { RFQ } from "../types/erpnext";

/** RFQ submission only opens sourcing. CLM starts after the separately persisted supplier award. */
export async function submitRfqWithContractConfirmation(name: string): Promise<{ rfq: RFQ; message: string }> {
  const rfq = await submitRFQ(name);
  if (rfq.name !== name || Number(rfq.docstatus) !== 1) throw new Error("The RFQ service did not confirm submission. Refresh the RFQ before retrying.");
  return { rfq, message: "RFQ submitted successfully." };
}
