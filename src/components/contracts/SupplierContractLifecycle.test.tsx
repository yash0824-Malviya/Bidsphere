import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClmSupplierWorkflow } from "../../types/clm";
import SupplierContractLifecycle from "./SupplierContractLifecycle";

const initial: ClmSupplierWorkflow = { purchase_order: "PO-1", acceptance_status: "Pending", signature_status: "Pending", po_acceptance_status: "Pending", status: "Contract Acceptance Required", current_stage: "Contract Acceptance", next_stage: "Supplier E-Signature", responsible_role: "supplier", responsible: "Supplier", can_accept_contract: true, can_sign_contract: false, can_accept_po: false, version: "1.0" };
const steps = ["Pending Supplier Contract Acceptance", "Supplier Contract Accepted", "Pending Supplier Contract Signature", "Supplier Contract Signed", "Pending Supplier PO Acceptance", "Supplier PO Accepted", "Existing PO Processing", "Completed"];
const render = (patch: Partial<ClmSupplierWorkflow> = {}) => renderToStaticMarkup(<SupplierContractLifecycle workflow={{ ...initial, ...patch }} />);
const stageRows = (html: string) => [...html.matchAll(/<li[^>]*data-state="([^"]+)"[^>]*>(.*?)<\/li>/g)].map(match => ({ state: match[1], content: match[2] }));
describe("Complete supplier Contract to PO lifecycle", () => {
  it("renders all eight required states in order and marks the persisted initial state current", () => {
    const rows = stageRows(render()); expect(rows).toHaveLength(8);
    steps.forEach((label, index) => expect(rows[index].content).toContain(label));
    expect(rows.map(row => row.state)).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });
  it.each([
    [{ acceptance_status: "Accepted", accepted_at: "2026-09-29 10:00:00", current_stage: "Supplier E-Signature", status: "Contract Signature Required" }, 2],
    [{ acceptance_status: "Accepted", signature_status: "Signed", signed_at: "2026-09-29 10:05:00", current_stage: "Purchase Order Acceptance", status: "Purchase Order Acceptance Required" }, 4],
    [{ acceptance_status: "Accepted", signature_status: "Signed", po_acceptance_status: "Accepted", po_accepted_at: "2026-09-29 10:10:00", shipment_status: "Accepted", current_stage: "Existing PO Processing", status: "Purchase Order Accepted" }, 6],
    [{ acceptance_status: "Accepted", signature_status: "Signed", po_acceptance_status: "Accepted", shipment_status: "Completed", current_stage: "Completed", status: "Completed", responsible_role: "", responsible: "None / Completed" }, 7],
  ] as Array<[Partial<ClmSupplierWorkflow>, number]>)("advances display only with persisted acceptance/signature/PO evidence: %j", (patch, index) => {
    const html = render(patch), rows = stageRows(html);
    expect(rows[index].state).toBe("current"); expect(rows[index].content).toContain(steps[index]);
    expect(rows.filter(row => row.state === "current")).toHaveLength(1);
    expect(rows.filter(row => row.state === "completed")).toHaveLength(index);
    expect(html).toContain(patch.status!);
    if (index >= 4) expect(html).toContain("Contract: Fully Signed");
  });
  it("does not advance from action permissions or a status label without its required saved evidence", () => {
    const html = render({ can_accept_po: true, status: "Completed", current_stage: "Completed", shipment_status: "Completed" });
    const rows = stageRows(html); expect(rows[0].state).toBe("current"); expect(rows[7].state).toBe("upcoming"); expect(html).not.toContain("Contract: Fully Signed");
  });
  it("does not mark PO acceptance or completion from Contract signature alone", () => {
    const rows = stageRows(render({ acceptance_status: "Accepted", signature_status: "Signed", shipment_status: "Completed", current_stage: "Completed" }));
    expect(rows[4].state).toBe("current"); expect(rows[5].state).toBe("upcoming"); expect(rows[7].state).toBe("upcoming");
  });
  it("keeps the signed Contract label after PO acceptance revokes the acceptance action", () => {
    const html = render({ acceptance_status: "Accepted", signature_status: "Signed", po_acceptance_status: "Accepted", shipment_status: "Accepted", current_stage: "Existing PO Processing", can_accept_po: false });
    expect(html).toContain("Contract: Fully Signed"); expect(stageRows(html)[6].state).toBe("current");
  });
});
