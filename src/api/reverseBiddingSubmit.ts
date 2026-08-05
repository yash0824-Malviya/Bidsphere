/**
 * Supplier Portal — submit item bids via the privileged backend.
 * Supplier identity is resolved from the JWT on the server, never from the body.
 */
import type { ReverseBidding } from "../types/reverseBidding";
import { bidsphereApiFetch } from "../utils/bidsphereApiFetch";
import { readSupplierAccessToken } from "../utils/accessToken";
import { readSupplierSession } from "../hooks/useSupplierSession";
import type { ClientBidSnapshot } from "../utils/reverseBiddingSubmitHelpers";

export type { ClientBidSnapshot } from "../utils/reverseBiddingSubmitHelpers";

export type ItemBidInput = { item_code: string; rate: number };

export class ReverseBiddingSubmitApiError extends Error {
  status: number;
  submittedBid?: number;
  latestLowestBid?: number;
  itemCode?: string;
  reasonCode?: string;
  auction?: ReverseBidding;

  constructor(
    message: string,
    status = 400,
    details?: {
      submittedBid?: number;
      latestLowestBid?: number;
      itemCode?: string;
      reasonCode?: string;
      auction?: ReverseBidding;
    },
  ) {
    super(message);
    this.name = "ReverseBiddingSubmitApiError";
    this.status = status;
    this.submittedBid = details?.submittedBid;
    this.latestLowestBid = details?.latestLowestBid;
    this.itemCode = details?.itemCode;
    this.reasonCode = details?.reasonCode;
    this.auction = details?.auction;
  }
}

/** True when the current tab is an authenticated Supplier Portal session. */
export function isSupplierPortalBidSession(): boolean {
  if (readSupplierAccessToken()) return true;
  const session = readSupplierSession();
  return !!(session?.loggedIn && (session.linkedSupplier || session.supplierName));
}

export async function submitItemBidsViaServer(input: {
  auctionName: string;
  items: ItemBidInput[];
  clientSnapshot?: ClientBidSnapshot;
}): Promise<ReverseBidding> {
  const res = await bidsphereApiFetch("/api/reverse-bidding-submit-item-bids", {
    method: "POST",
    json: {
      auction_name: input.auctionName,
      items: input.items,
      client_total_lowest: input.clientSnapshot?.totalLowest,
      client_lowest_by_item: input.clientSnapshot?.lowestByItem,
    },
  });

  let json: {
    success?: boolean;
    message?: string;
    submitted_bid?: number;
    latest_lowest_bid?: number;
    item_code?: string;
    reason_code?: string;
    auction?: ReverseBidding;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {
      success: false,
      message: `Could not submit item bids (HTTP ${res.status}).`,
    };
  }

  if (!res.ok || json.success === false || !json.auction) {
    throw new ReverseBiddingSubmitApiError(
      json.message || `Could not submit item bids (HTTP ${res.status}).`,
      res.status,
      {
        submittedBid: json.submitted_bid,
        latestLowestBid: json.latest_lowest_bid,
        itemCode: json.item_code,
        reasonCode: json.reason_code,
        auction: json.auction,
      },
    );
  }

  return json.auction;
}
