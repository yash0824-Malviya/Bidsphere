/**
 * Supplier real-time notify when a reverse auction becomes Live.
 * Architecture: React Query polling (no WebSocket in this project).
 * Detects Draft/Scheduled → Live and "first appearance as Live".
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { createNotification } from "../api/notifications";
import {
  deriveAuctionStatus,
  getSupplierAuctions,
} from "../api/reverseBidding";
import type { AuctionStatus, ReverseBidding } from "../types/reverseBidding";
import {
  markAuctionStartedNotified,
  wasAuctionStartedNotified,
} from "../utils/auctionStartedNotifyOnce";
import { playAuctionStartedSound } from "../utils/auctionStartedSound";

/** Poll aggressively so Start Now → supplier alert lands in ~1–2s. */
const LIVE_NOTIFY_POLL_MS = 2_000;

function auctionRoute(name: string): string {
  return `/supplier/auctions/${encodeURIComponent(name)}`;
}

function rfqLabel(doc: ReverseBidding): string {
  return String(doc.rfq || doc.name || "RFQ").trim();
}

function showAuctionStartedToast(
  doc: ReverseBidding,
  onOpen: () => void,
): void {
  const name = doc.name;
  const rfq = rfqLabel(doc);
  // eslint-disable-next-line no-console
  console.log("[Auction Notify] Toast displayed", { auction: name, rfq });

  toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? "animate-enter" : "animate-leave"
        } pointer-events-auto w-full max-w-sm cursor-pointer rounded-xl border border-sky-200 bg-white p-4 shadow-lg ring-1 ring-sky-100`}
        role="status"
        onClick={() => {
          toast.dismiss(t.id);
          onOpen();
        }}
      >
        <p className="text-sm font-semibold text-neutral-900">
          Reverse Auction Started
        </p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-600">
          RFQ <span className="font-semibold text-neutral-800">{rfq}</span> is
          now live.
          <br />
          Click to participate.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toast.dismiss(t.id);
              onOpen();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700"
          >
            Open Auction
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toast.dismiss(t.id);
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    ),
    { duration: 12_000, id: `auction-started-${name}` },
  );
}

function ensureNotificationPermission(): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {});
  }
}

function showBrowserNotification(
  doc: ReverseBidding,
  onOpen: () => void,
): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    // eslint-disable-next-line no-console
    console.log(
      "[Auction Notify] Browser notification skipped (permission:",
      Notification.permission,
      ") — toast + sound fallback",
    );
    return;
  }
  try {
    const rfq = rfqLabel(doc);
    const n = new Notification("Reverse Auction Started", {
      body: `RFQ ${rfq} is now live. Click to participate.`,
      tag: `auction-started-${doc.name}`,
    });
    // eslint-disable-next-line no-console
    console.log("[Auction Notify] Browser notification shown", {
      auction: doc.name,
      rfq,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      onOpen();
      n.close();
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[Auction Notify] Browser notification failed", err);
  }
}

function invalidateSupplierAuctionViews(
  queryClient: ReturnType<typeof useQueryClient>,
  supplierId: string,
): void {
  const keys = [
    ["supplier-auctions", supplierId],
    ["supplier-auctions-live-notify", supplierId],
    ["supplier-portal-auctions-kpi", supplierId],
    ["supplier-portal-dashboard", supplierId],
    ["supplier-portal-notifications", supplierId],
  ];
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
  // eslint-disable-next-line no-console
  console.log("[Auction Notify] Dashboard updated (queries invalidated)", {
    supplierId,
    keys,
  });
}

function fireAuctionStartedAlert(
  supplierId: string,
  doc: ReverseBidding,
  open: () => void,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  const name = doc.name;
  if (!name || wasAuctionStartedNotified(supplierId, name)) {
    // eslint-disable-next-line no-console
    console.log("[Auction Notify] Duplicate suppressed", {
      auction: name,
      supplierId,
    });
    return;
  }
  markAuctionStartedNotified(supplierId, name);

  // eslint-disable-next-line no-console
  console.log("[Auction Notify] Auction event received → firing alerts", {
    auction: name,
    rfq: doc.rfq,
    status: doc.auction_status,
    supplierId,
  });

  playAuctionStartedSound();
  // eslint-disable-next-line no-console
  console.log("[Auction Notify] Sound played", { auction: name });

  showAuctionStartedToast(doc, open);
  showBrowserNotification(doc, open);

  createNotification({
    title: "Reverse Auction Started",
    description: `RFQ ${rfqLabel(doc)} is now live. Click to participate.`,
    module: "Live Auction",
    event_type: "auction_started",
    target_role: "supplier",
    supplier_id: supplierId,
    document_type: "Reverse Bidding",
    document_name: name,
    route_path: auctionRoute(name),
    read_status: false,
  });

  invalidateSupplierAuctionViews(queryClient, supplierId);
}

/**
 * While a supplier is logged in, poll invited auctions and notify once when
 * an auction becomes Live (clock, force-start, or first appearance as Live).
 */
export function useLiveAuctionStartedNotification(
  supplierId: string | undefined,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<Map<string, AuctionStatus>>(new Map());
  const primedRef = useRef(false);

  const enabled = !!supplierId?.trim();

  useEffect(() => {
    if (enabled) ensureNotificationPermission();
  }, [enabled]);

  const query = useQuery({
    // Shared with Live Auctions list so list refreshes from the same poll.
    queryKey: ["supplier-auctions", supplierId],
    queryFn: () => getSupplierAuctions(supplierId!),
    enabled,
    refetchInterval: LIVE_NOTIFY_POLL_MS,
    staleTime: 1_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!enabled || !supplierId || !query.data) return;

    const openAuction = (name: string) => {
      invalidateSupplierAuctionViews(queryClient, supplierId);
      navigate(auctionRoute(name));
    };

    const prev = prevStatusRef.current;
    const nextMap = new Map<string, AuctionStatus>();

    for (const doc of query.data) {
      const name = doc.name;
      if (!name) continue;
      const status = deriveAuctionStatus(doc);
      nextMap.set(name, status);

      if (!primedRef.current) {
        // Baseline — already-Live auctions must not replay on login/refresh.
        if (status === "Live") {
          markAuctionStartedNotified(supplierId, name);
        }
        continue;
      }

      const prior = prev.get(name);
      // Cover: Scheduled/Draft → Live, AND first visibility as Live
      // (Start Now from Draft often appears only after invitation promotion).
      const becameLive =
        status === "Live" &&
        (prior === undefined ||
          prior === "Scheduled" ||
          prior === "Draft");

      if (becameLive) {
        // eslint-disable-next-line no-console
        console.log("[Auction Notify] Auction event received", {
          auction: name,
          prior: prior ?? "(new)",
          status,
          rfq: doc.rfq,
        });
        fireAuctionStartedAlert(supplierId, doc, () => openAuction(name), queryClient);
      }
    }

    primedRef.current = true;
    prevStatusRef.current = nextMap;
  }, [enabled, supplierId, query.data, navigate, queryClient]);
}

/** Mount-only helper for the supplier portal shell. */
export function LiveAuctionStartedNotifier({
  supplierId,
}: {
  supplierId: string;
}) {
  useLiveAuctionStartedNotification(supplierId);
  return null;
}
