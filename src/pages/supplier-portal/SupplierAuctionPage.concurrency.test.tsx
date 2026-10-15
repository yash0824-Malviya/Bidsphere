import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReverseBidding } from "../../types/reverseBidding";
import type { ItemBidInput } from "../../api/reverseBidding";

type Mutation = {
  mutationFn: (items: ItemBidInput[]) => Promise<ReverseBidding>;
  onSuccess?: (updated: ReverseBidding) => Promise<void>;
  onError?: (error: unknown) => Promise<void>;
  onSettled?: () => void;
};
const fixture = vi.hoisted(() => ({
  auction: {} as ReverseBidding,
  mutations: [] as Mutation[],
  queries: [] as { refetchInterval?: (query: { state: { data?: ReverseBidding } }) => number | false }[],
  mutate: vi.fn(), submit: vi.fn(), setter: vi.fn(),
  qc: { fetchQuery: vi.fn(), setQueryData: vi.fn(), cancelQueries: vi.fn(), invalidateQueries: vi.fn() },
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => undefined,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [typeof value === "object" && value !== null
    ? { COOLANT: "24", OIL: "24" } : value, fixture.setter],
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ auctionName: "RB-TEST" }) }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: (typeof fixture.queries)[number]) => {
    fixture.queries.push(options);
    return { data: fixture.auction, isLoading: false };
  },
  useMutation: (options: Mutation) => {
    fixture.mutations.push(options);
    return { mutate: fixture.mutate, isPending: false };
  },
  useQueryClient: () => fixture.qc,
}));
vi.mock("../../hooks/useSupplierSession", () => ({
  useSupplierSession: () => ({ erpSupplierName: "Titan", supplierName: "Titan", isReady: true, isAuthenticated: true }),
  readSupplierSession: () => null,
}));
vi.mock("../../hooks/useCountdown", () => ({ useCountdown: () => ({ msRemaining: 60000, label: "00:01:00" }) }));
vi.mock("../../hooks/useServerTimeOffset", () => ({ useServerTimeOffset: () => 0 }));
vi.mock("../../hooks/useAuctionCountdownAlerts", () => ({
  useAuctionCountdownAlerts: () => ({ phase: "normal", secondsLeft: 60 }),
}));
vi.mock("../../api/reverseBidding", () => ({
  currentLowestBid: (doc: ReverseBidding) => doc.lowest_bid,
  deriveAuctionStatus: (doc: ReverseBidding) => doc.auction_status,
  ensureBidItems: vi.fn(), maybeAutoComplete: vi.fn(),
  getReverseBidding: vi.fn(), submitBid: vi.fn(), submitItemBids: fixture.submit,
  lowestRateByItem: () => new Map([["COOLANT", 25], ["OIL", 25]]),
  parseErpDateTime: () => Date.now() + 60000,
  sameSupplier: (left: string, right: string) => left === right,
  supplierIsInvited: () => true,
  validateBid: () => ({ ok: true }), validateItemBid: () => ({ ok: true, currentLowest: 25 }),
}));

import SupplierAuctionPage from "./SupplierAuctionPage";
import { ReverseBiddingSubmitApiError } from "../../api/reverseBiddingSubmit";

function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ children?: unknown }>(node)) return textOf(node.props.children);
  return typeof node === "string" ? node : "";
}
function submitButton(node: unknown): ReactElement<{ onClick: () => void; disabled: boolean }> | undefined {
  if (Array.isArray(node)) return node.map(submitButton).find(Boolean);
  if (!isValidElement<{ children?: unknown }>(node)) return undefined;
  if (node.type === "button" && textOf(node.props.children).includes("reverseBidding.submitItemBids")) {
    return node as ReactElement<{ onClick: () => void; disabled: boolean }>;
  }
  return submitButton(node.props.children);
}

describe("Supplier Live Auctions submission concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.mutations = [];
    fixture.queries = [];
    fixture.auction = {
      name: "RB-TEST", rfq: "RFQ-TEST", auction_status: "Live", lowest_bid: 50, currency: "USD",
      invited_suppliers: [{ supplier: "Titan", current_bid: 50 }], bid_history: [],
      bid_items: [
        { name: "ROW-COOLANT", supplier: "Titan", item_code: "COOLANT", current_rate: 25, qty: 1 },
        { name: "ROW-OIL", supplier: "Titan", item_code: "OIL", current_rate: 25, qty: 1 },
      ],
    };
    fixture.qc.cancelQueries.mockResolvedValue(undefined);
    fixture.qc.fetchQuery.mockResolvedValue(fixture.auction);
    fixture.submit.mockResolvedValue(fixture.auction);
  });

  it("blocks a second click synchronously until the transaction settles, while keeping live polling", () => {
    const button = submitButton(SupplierAuctionPage())!;
    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    button.props.onClick();
    expect(fixture.mutate).toHaveBeenCalledTimes(1);
    expect(fixture.mutate).toHaveBeenCalledWith([{ item_code: "COOLANT", rate: 24 }, { item_code: "OIL", rate: 24 }]);
    expect(fixture.queries[0].refetchInterval!({ state: { data: fixture.auction } })).toBe(2000);
    fixture.mutations[1].onSettled!();
    button.props.onClick();
    expect(fixture.mutate).toHaveBeenCalledTimes(2);
  });

  it("submits both item inputs in one action without sending browser document versions", async () => {
    SupplierAuctionPage();
    const items = [{ item_code: "COOLANT", rate: 24 }, { item_code: "OIL", rate: 24 }];
    await fixture.mutations[1].mutationFn(items);
    expect(fixture.submit).toHaveBeenCalledTimes(1);
    expect(fixture.submit).toHaveBeenCalledWith({
      auctionName: "RB-TEST", items,
      clientSnapshot: { totalLowest: 50, lowestByItem: { COOLANT: 25, OIL: 25 } },
    });
  });

  it("cancels an older display fetch before publishing the transaction response and refreshing", async () => {
    SupplierAuctionPage();
    let finishCancel!: () => void;
    fixture.qc.cancelQueries.mockReturnValue(new Promise<void>((resolve) => { finishCancel = resolve; }));
    const updated = { ...fixture.auction, lowest_bid: 48 };
    const completion = fixture.mutations[1].onSuccess!(updated);
    expect(fixture.qc.cancelQueries).toHaveBeenCalledWith({ queryKey: ["supplier-auction", "RB-TEST"] });
    expect(fixture.qc.setQueryData).not.toHaveBeenCalled();
    finishCancel();
    await completion;
    expect(fixture.qc.setQueryData).toHaveBeenCalledWith(["supplier-auction", "RB-TEST"], updated);
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["supplier-auction", "RB-TEST"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["supplier-auctions"] });
  });

  it("publishes a conflict's authoritative state and preserves the supplier's typed bids", async () => {
    SupplierAuctionPage();
    const current = { ...fixture.auction, lowest_bid: 46 };
    await fixture.mutations[1].onError!(new ReverseBiddingSubmitApiError(
      "Another supplier submitted a lower bid. Current lowest is $23.00.", 409, { auction: current },
    ));
    expect(fixture.qc.cancelQueries).toHaveBeenCalledWith({ queryKey: ["supplier-auction", "RB-TEST"] });
    expect(fixture.qc.setQueryData).toHaveBeenCalledWith(["supplier-auction", "RB-TEST"], current);
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["supplier-auction", "RB-TEST"] });
    expect(fixture.setter).not.toHaveBeenCalled();
  });
});
