import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  submitItemBidsCore,
  ReverseBiddingSubmitError,
} from "./reverseBiddingSubmitCore.js";
import { RbacError, requireSupplierAuth } from "./rbacAuth.js";

function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body as Record<string, unknown>);
  }
  return (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ReverseBiddingSubmitError("Invalid JSON body.", 400);
    }
  })();
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST /api/reverse-bidding-submit-item-bids.",
    });
    return;
  }

  try {
    const principal = requireSupplierAuth(
      req.headers as Record<string, unknown>,
    );
    const body = await readJsonBody(req);
    const auctionName = String(
      body.auction_name ?? body.auctionName ?? "",
    ).trim();
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items = itemsRaw
      .map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return {
          item_code: String(r.item_code ?? "").trim(),
          rate: Number(r.rate),
        };
      })
      .filter((i) => i.item_code && Number.isFinite(i.rate));

    const supplier = String(principal.supplier || principal.sub || "").trim();

    const clientTotalRaw = body.client_total_lowest ?? body.clientTotalLowest;
    const clientLowestRaw =
      body.client_lowest_by_item ?? body.clientLowestByItem;
    const clientSnapshot =
      clientTotalRaw != null ||
      (clientLowestRaw && typeof clientLowestRaw === "object")
        ? {
            totalLowest:
              clientTotalRaw != null ? Number(clientTotalRaw) : undefined,
            lowestByItem:
              clientLowestRaw && typeof clientLowestRaw === "object"
                ? Object.fromEntries(
                    Object.entries(
                      clientLowestRaw as Record<string, unknown>,
                    ).map(([k, v]) => [k, Number(v)]),
                  )
                : undefined,
          }
        : undefined;

    console.log("[reverse-bidding-submit] auth ok", {
      authenticatedUser: principal.sub,
      supplier,
      auctionId: auctionName,
      itemCount: items.length,
      hasAccessToken: true,
    });

    const auction = await submitItemBidsCore({
      auctionName,
      supplier,
      items,
      clientSnapshot,
    });

    res.status(200).json({ success: true, auction });
  } catch (err) {
    const status =
      err instanceof ReverseBiddingSubmitError
        ? err.status
        : err instanceof RbacError
          ? err.status
          : 500;
    const message =
      err instanceof Error ? err.message : "Could not submit item bids.";

    console.error("[reverse-bidding-submit] failed", {
      status,
      message,
      submittedBid:
        err instanceof ReverseBiddingSubmitError ? err.submittedBid : undefined,
      latestLowestBid:
        err instanceof ReverseBiddingSubmitError ? err.latestLowestBid : undefined,
      itemCode: err instanceof ReverseBiddingSubmitError ? err.itemCode : undefined,
      reasonCode:
        err instanceof ReverseBiddingSubmitError ? err.reasonCode : undefined,
      error: err instanceof Error ? err.stack : err,
    });

    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
      ...(err instanceof ReverseBiddingSubmitError
        ? {
            submitted_bid: err.submittedBid,
            latest_lowest_bid: err.latestLowestBid,
            item_code: err.itemCode,
            reason_code: err.reasonCode,
            auction: err.auction,
          }
        : {}),
    });
  }
}
