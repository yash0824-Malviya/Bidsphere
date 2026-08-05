/**
 * SLA integration glue — maps live workflow state to SLA timers.
 *
 * Kept separate from `sla.ts` so the engine has no dependency on individual
 * workflow modules. Pages/dashboards call these when they already have the
 * documents loaded; the calls are idempotent and safe to run on every load.
 */
import {
  completeSlaTimer,
  ensureSlaTimer,
  listSlaConfigurations,
  type SlaConfiguration,
} from "./sla";
import {
  getMaterialRequestWorkflowStatus,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import { parseErpDateTime } from "./reverseBidding";
import type { ReverseBidding } from "../types/reverseBidding";

const MR_DOCTYPE = "Material Request";

/**
 * Ensure the right SLA timer exists for a Material Request's current stage and
 * close timers for stages it has moved past.
 */
export async function syncMaterialRequestSla(
  mr: MaterialRequestWorkflowRecord,
  configs?: SlaConfiguration[]
): Promise<void> {
  const status = getMaterialRequestWorkflowStatus(mr);
  const priority = mr.custom_priority || "Medium";
  const department = mr.custom_department || "";
  const base = {
    referenceDoctype: MR_DOCTYPE,
    referenceName: mr.name,
    priority,
    department,
    configs,
  };

  switch (status) {
    case "Draft":
      return;

    case "Admin Review":
    case "Submitted":
    case "Under Warehouse Review":
      await ensureSlaTimer({
        ...base,
        workflow: "Warehouse Review",
        role: "warehouse",
      });
      return;

    // "Procurement Required" = shortage identified, but Warehouse hasn't
    // awaiting Confirm & Process — the Warehouse Review SLA timer
    // (started above) keeps running untouched until the actual forward.
    case "Procurement Required":
      return;

    case "Forwarded to Procurement":
      await completeSlaTimer(MR_DOCTYPE, mr.name, { workflow: "Warehouse Review" });
      await completeSlaTimer(MR_DOCTYPE, mr.name, { workflow: "Material Request" });
      await ensureSlaTimer({
        ...base,
        workflow: "Procurement Review",
        role: "procurement",
      });
      return;

    case "RFQ Created":
      await completeSlaTimer(MR_DOCTYPE, mr.name, { workflow: "Procurement Review" });
      return;

    case "Stock Available":
    case "Material Issued":
    case "Completed":
      await completeSlaTimer(MR_DOCTYPE, mr.name);
      return;

    case "Cancelled":
      await completeSlaTimer(MR_DOCTYPE, mr.name);
      return;

    default:
      return;
  }
}

/** Sync a batch of Material Requests, loading active configs only once. */
export async function syncMaterialRequestSlaBatch(
  mrs: MaterialRequestWorkflowRecord[]
): Promise<void> {
  if (mrs.length === 0) return;
  const configs = await listSlaConfigurations();
  if (configs.length === 0) return; // nothing configured — skip the writes entirely
  for (const mr of mrs) {
    try {
      await syncMaterialRequestSla(mr, configs);
    } catch {
      /* per-doc failures shouldn't block the batch */
    }
  }
}

/**
 * A reverse auction has its own scheduled end — use that as the SLA due time so
 * the countdown matches the live auction clock. Completes when the auction is
 * no longer live.
 */
export async function syncReverseAuctionSla(
  auction: Pick<ReverseBidding, "name"> &
    Partial<Pick<ReverseBidding, "auction_status" | "start_date_time" | "end_date_time">>
): Promise<void> {
  const status = auction.auction_status ?? "Draft";
  if (status === "Completed" || status === "Cancelled") {
    await completeSlaTimer("Reverse Bidding", auction.name, {
      workflow: "Reverse Auction",
    });
    return;
  }
  const start = parseErpDateTime(auction.start_date_time);
  const end = parseErpDateTime(auction.end_date_time);
  if (start == null || end == null || end <= start) return;
  await ensureSlaTimer({
    workflow: "Reverse Auction",
    referenceDoctype: "Reverse Bidding",
    referenceName: auction.name,
    role: "procurement",
    startTime: start,
    dueTime: end,
  });
}
