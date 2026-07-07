/**
 * Reverse Bidding (reverse auction) domain types.
 *
 * These mirror the EXACT field schema of the three existing custom ERPNext
 * DocTypes — no fields are invented:
 *   • Reverse Bidding          (master, autoname RB-.YYYY.-.#####)
 *   • Reverse Bidding Supplier (child table → invited_suppliers)
 *   • Reverse Bids             (child table → bid_history)
 */
import type { ErpDoc } from "./erpnext";

export type AuctionStatus =
  | "Draft"
  | "Scheduled"
  | "Live"
  | "Completed"
  | "Cancelled";

export const AUCTION_STATUSES: AuctionStatus[] = [
  "Draft",
  "Scheduled",
  "Live",
  "Completed",
  "Cancelled",
];

export type InvitationStatus = "Pending" | "Sent" | "Accepted" | "Declined";

export type ReverseBidStatus = "Accepted" | "Rejected" | "Superseded";

/** Child row of `Reverse Bidding.invited_suppliers`. */
export interface ReverseBiddingSupplier {
  /** Present on rows returned by ERPNext (child row id). */
  name?: string;
  doctype?: "Reverse Bidding Supplier";
  supplier: string;
  initial_quotation_amount?: number;
  current_bid?: number;
  rank?: number;
  invitation_status?: InvitationStatus;
  /** ERPNext datetime when the invitation was sent. */
  invitation_sent_at?: string;
  joined_auction?: 0 | 1;
  final_rank?: number;
}

/**
 * Child row of `Reverse Bidding.bid_history` (DocType "Reverse Bids").
 *
 * History is append-only: every submitted bid adds one row per item (plus, for
 * legacy total-amount auctions, a single row with no `item_code`). `bid_amount`
 * holds the NEW price for that row; item-level fields carry the item, previous
 * price and reduction so the full negotiation trail is preserved.
 */
export interface ReverseBid {
  name?: string;
  doctype?: "Reverse Bids";
  reverse_bidding?: string;
  supplier: string;
  /** New price recorded by this bid (item rate for item rows, else total). */
  bid_amount: number;
  bid_time?: string;
  round_number?: number;
  ip_address?: string;
  status?: ReverseBidStatus;
  /** Item-level history (empty on legacy total-amount rows). */
  item_code?: string;
  item_name?: string;
  /** Price before this bid (for the same item / supplier total). */
  previous_rate?: number;
  reduction_amount?: number;
  reduction_pct?: number;
}

export type BidItemStatus =
  | "Waiting"
  | "Active"
  | "Leading"
  | "Outbid"
  | "Winner";

/**
 * Child row of `Reverse Bidding.bid_items` (DocType "Reverse Bid Item").
 * One row per (supplier, RFQ item) holding the live item-wise price state.
 */
export interface ReverseBidItem {
  name?: string;
  doctype?: "Reverse Bid Item";
  reverse_bidding?: string;
  supplier: string;
  item_code: string;
  item_name?: string;
  rfq_item?: string;
  qty?: number;
  uom?: string;
  initial_rate?: number;
  current_rate?: number;
  latest_rate?: number;
  /** Procurement-set target price for the item (visible to suppliers). */
  target_rate?: number;
  amount?: number;
  rank?: number;
  is_lowest?: 0 | 1;
  bid_time?: string;
  round_number?: number;
  status?: BidItemStatus;
}

/** The "Reverse Bidding" master document. */
export interface ReverseBidding extends ErpDoc {
  naming_series?: string;
  rfq: string;
  procurement_manager?: string;
  company?: string;
  start_date_time?: string;
  end_date_time?: string;
  auction_status?: AuctionStatus;
  starting_price?: number;
  minimum_decrement?: number;
  lowest_bid?: number;
  winning_supplier?: string;
  winner_price?: number;
  currency?: string;
  remarks?: string;
  invited_suppliers?: ReverseBiddingSupplier[];
  bid_history?: ReverseBid[];
  /** Item-wise live bid state (DocType "Reverse Bid Item"). */
  bid_items?: ReverseBidItem[];
}
