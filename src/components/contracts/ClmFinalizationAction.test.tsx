import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ClmActionPanel from "./ClmActionPanel";
import ClmPurchaseOrderSummary from "./ClmPurchaseOrderSummary";

describe("Procurement finalization opens the existing PO form", () => {
  it.each(["create_purchase_order", "finalize_procurement"])("uses the saved Contract context for the %s grant, without an existing-PO selector", action => {
    const onAction = vi.fn();
    const html = renderToStaticMarkup(<MemoryRouter><ClmActionPanel actions={[{ action, label: "Create Purchase Order" }]} busy={false} contractName="CON-2026-00001" onAction={onAction} /></MemoryRouter>);
    expect(html).toContain('href="/p2p/purchase-orders/new?contract=CON-2026-00001"');
    expect(html).toContain("Create Purchase Order");
    expect(html).not.toContain("Existing Purchase Order"); expect(html).not.toContain("Search purchase order");
    expect(html).not.toContain("<form"); expect(onAction).not.toHaveBeenCalled();
  });
  it("does not expose PO creation without the backend action grant or persisted Contract", () => {
    const render = (actions: Parameters<typeof ClmActionPanel>[0]["actions"], contractName?: string) => renderToStaticMarkup(<MemoryRouter><ClmActionPanel actions={actions} contractName={contractName} busy={false} onAction={vi.fn()} /></MemoryRouter>);
    expect(render([], "CON-1")).not.toContain("Create Purchase Order");
    expect(render([{ action: "create_purchase_order", label: "Create Purchase Order" }])).not.toContain("Create Purchase Order");
  });
  it("shows the persisted PO receipt only after completion, including its exact View link", () => {
    const data = { rfq_workflow: { version: 1, phase: "completed" }, procurement_completion: { purchase_order: "PUR-PO-00001", supplier: "SUP-1", supplier_name: "Atlantic", grand_total: 4500, currency: "USD", created_at: "2026-09-29 12:00:00" } };
    const record = { name: "CON-1", custom_rfq: "RFQ-1", custom_clm_data: JSON.stringify(data) };
    const render = () => renderToStaticMarkup(<MemoryRouter><ClmPurchaseOrderSummary record={record} /></MemoryRouter>);
    const html = render();
    for (const value of ["PO Created Successfully", "PUR-PO-00001", "Atlantic", "4,500.00", "2026-09-29 12:00:00", 'href="/p2p/purchase-orders/PUR-PO-00001"']) expect(html).toContain(value);
    data.rfq_workflow.phase = "procurement"; record.custom_clm_data = JSON.stringify(data);
    expect(render()).not.toContain("PO Created Successfully");
  });
});
