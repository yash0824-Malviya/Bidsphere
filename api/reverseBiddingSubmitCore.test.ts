import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitItemBidsCore } from "./reverseBiddingSubmitCore";

vi.mock("./reverseBiddingNamingCore.js", () => ({
  ensureReverseBiddingChildNaming: vi.fn(async () => undefined),
}));

type Auction = Awaited<ReturnType<typeof submitItemBidsCore>>;
type SaveDocument = Auction & { doctype?: string; custom_context?: string };
const AUCTION = "RB-CONCURRENCY-TEST";
const SUPPLIER_A = "Titan Industrial Products LLC";
const SUPPLIER_B = "FEMSA";
const ITEM_CODES = ["ENGINE-COOLANT", "GEAR-OIL"];
const ORIGINAL_VERSION = "2026-09-18 12:51:34.256440";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function fixture(): SaveDocument {
  return {
    doctype: "Reverse Bidding",
    name: AUCTION,
    rfq: "PUR-RFQ-CONCURRENCY-TEST",
    modified: ORIGINAL_VERSION,
    custom_context: "Preserve fields outside this business action",
    auction_status: "Live",
    start_date_time: new Date(Date.now() - 60_000).toISOString(),
    end_date_time: new Date(Date.now() + 3_600_000).toISOString(),
    minimum_decrement: 1,
    lowest_bid: 50,
    currency: "USD",
    bid_items: [SUPPLIER_A, SUPPLIER_B].flatMap((supplier, supplierIndex) =>
      ITEM_CODES.map((item_code, itemIndex) => ({
        doctype: "Reverse Bid Item",
        name: `persisted-item-${supplierIndex}-${itemIndex}`,
        supplier,
        item_code,
        item_name: itemIndex === 0 ? "Engine Coolant" : "Gear Oil",
        qty: 1,
        current_rate: 25,
        latest_rate: 25,
        amount: 25,
        rank: supplierIndex + 1,
        is_lowest: 1 as const,
        status: "Leading",
        round_number: 0,
      })),
    ),
    invited_suppliers: [SUPPLIER_A, SUPPLIER_B].map((supplier, index) => ({
      doctype: "Reverse Bidding Supplier",
      name: `persisted-supplier-${index}`,
      supplier,
      current_bid: 50,
      joined_auction: 1,
      invitation_status: "Accepted",
      rank: index + 1,
    })),
    bid_history: [SUPPLIER_A, SUPPLIER_B].flatMap((supplier, supplierIndex) =>
      ITEM_CODES.map((item_code, itemIndex) => ({
        doctype: "Reverse Bids",
        name: `persisted-history-${supplierIndex}-${itemIndex}`,
        supplier,
        item_code,
        bid_amount: 25,
        round_number: 0,
        status: "Accepted",
        bid_time: "2026-09-18 12:50:00.123456",
      })),
    ),
  };
}

function request(supplier = SUPPLIER_A, rate = 24) {
  return {
    auctionName: AUCTION,
    supplier,
    items: ITEM_CODES.map((item_code) => ({ item_code, rate })),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A transactional ERP fake: one parent save either commits every child or none. */
function erpStore(initial = fixture()) {
  let persisted = copy(initial);
  let commits = 0;
  let reads = 0;
  const writes: { path: string; body: unknown }[] = [];
  const saves: SaveDocument[] = [];
  let beforeSave: (doc: SaveDocument) => Promise<Response | undefined> = async () => undefined;
  let afterCommit: (doc: SaveDocument) => Promise<void> = async () => undefined;

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/api\//, "");
    if ((init?.method ?? "GET") === "GET" && path === `resource/Reverse Bidding/${AUCTION}`) {
      reads += 1;
      return Response.json({ data: copy(persisted) });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { doc?: SaveDocument | string };
    writes.push({ path, body: copy(body) });
    if (path !== "method/frappe.client.save") {
      throw new Error(`Unexpected non-atomic write: ${path}`);
    }
    const document = typeof body.doc === "string" ? JSON.parse(body.doc) as SaveDocument : body.doc;
    if (document?.doctype !== "Reverse Bidding" || document.name !== AUCTION) {
      return Response.json({ message: "Only the authoritative parent document may be saved." }, { status: 400 });
    }
    saves.push(copy(document));
    const rejected = await beforeSave(document);
    if (rejected) return rejected;
    if (document.modified !== persisted.modified) {
      return Response.json({
        exc_type: "TimestampMismatchError",
        message: `Document has been modified after you opened it (${document.modified}, ${persisted.modified}).`,
      }, { status: 409 });
    }
    commits += 1;
    persisted = {
      ...copy(document),
      modified: `2026-09-18 12:52:37.${String(316765 + commits).padStart(6, "0")}`,
      bid_history: document.bid_history?.map((row, index) => ({
        ...copy(row),
        name: row.name ?? `history-commit-${commits}-${index}`,
      })),
    };
    await afterCommit(copy(persisted));
    return Response.json({ message: copy(persisted) });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    get document() { return copy(persisted); },
    get commits() { return commits; },
    get reads() { return reads; },
    writes,
    saves,
    fetchMock,
    beforeSave(callback: typeof beforeSave) { beforeSave = callback; },
    afterCommit(callback: typeof afterCommit) { afterCommit = callback; },
    update(callback: (doc: SaveDocument) => SaveDocument) { persisted = callback(copy(persisted)); },
  };
}

/** Both callers read the original version; choose which transaction reaches CAS first. */
function orderConcurrentFirstSaves(store: ReturnType<typeof erpStore>, firstSupplier: string) {
  const bothArrived = deferred();
  const firstCommitted = deferred();
  const initialSuppliers = new Set<string>();
  store.beforeSave(async (doc) => {
    const supplier = String(doc.bid_history?.at(-1)?.supplier);
    if (!initialSuppliers.has(supplier)) {
      initialSuppliers.add(supplier);
      if (initialSuppliers.size === 2) bothArrived.resolve();
      await bothArrived.promise;
      if (supplier !== firstSupplier) await firstCommitted.promise;
    }
    return undefined;
  });
  store.afterCommit(async (doc) => {
    if (doc.bid_history?.at(-1)?.supplier === firstSupplier) firstCommitted.resolve();
  });
}

beforeEach(() => {
  vi.stubEnv("ERPNEXT_URL", "https://erp.test");
  vi.stubEnv("ERP_API_KEY", "test-key");
  vi.stubEnv("ERP_API_SECRET", "test-secret");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("submitItemBidsCore atomic parent concurrency", () => {
  it("saves two items, history, supplier totals and ranks in one parent transaction with the exact version", async () => {
    const original = fixture();
    const store = erpStore(original);
    const saved = await submitItemBidsCore(request());

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].path).toBe("method/frappe.client.save");
    expect(store.saves[0]).toMatchObject({
      doctype: "Reverse Bidding",
      name: AUCTION,
      modified: ORIGINAL_VERSION,
      custom_context: original.custom_context,
      lowest_bid: 48,
    });
    expect(store.saves[0].bid_history?.slice(0, 4)).toEqual(original.bid_history);
    expect(saved.bid_history).toHaveLength(6);
    expect(saved.bid_history?.slice(4).map((row) => [row.item_code, row.bid_amount])).toEqual([
      ["ENGINE-COOLANT", 24], ["GEAR-OIL", 24],
    ]);
    expect(saved.bid_items?.filter((row) => row.supplier === SUPPLIER_A)).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_code: "ENGINE-COOLANT", current_rate: 24, amount: 24, is_lowest: 1, rank: 1 }),
      expect.objectContaining({ item_code: "GEAR-OIL", current_rate: 24, amount: 24, is_lowest: 1, rank: 1 }),
    ]));
    expect(saved.invited_suppliers).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: SUPPLIER_A, current_bid: 48, rank: 1 }),
      expect.objectContaining({ supplier: SUPPLIER_B, current_bid: 50, rank: 2 }),
    ]));
    expect(saved.modified).toBe(store.document.modified);
    expect(saved.modified).not.toBe(ORIGINAL_VERSION);
  });

  it("leaves all items and history unchanged if the atomic save fails", async () => {
    const original = fixture();
    const store = erpStore(original);
    store.beforeSave(async () => Response.json({ message: "History validation rejected this transaction." }, { status: 422 }));
    await expect(submitItemBidsCore(request())).rejects.toThrow(/History validation/);
    expect(store.commits).toBe(0);
    expect(store.document).toEqual(original);
    expect(store.writes).toHaveLength(1);
  });

  it("reloads the fresh version and revalidates once after an optimistic-lock conflict", async () => {
    const store = erpStore();
    let first = true;
    store.beforeSave(async () => {
      if (first) {
        first = false;
        store.update((doc) => ({ ...doc, modified: "2026-09-18 12:52:00.999999" }));
      }
      return undefined;
    });
    const saved = await submitItemBidsCore(request());
    expect(store.saves.map((doc) => doc.modified)).toEqual([ORIGINAL_VERSION, "2026-09-18 12:52:00.999999"]);
    expect(store.commits).toBe(1);
    expect(saved.bid_history).toHaveLength(6);
    expect(store.reads).toBeGreaterThanOrEqual(2);
  });

  it("bounds automatic conflict retries to one and never ignores the database version", async () => {
    const store = erpStore();
    let conflicts = 0;
    store.beforeSave(async () => {
      conflicts += 1;
      store.update((doc) => ({ ...doc, modified: `2026-09-18 12:52:00.${String(conflicts).padStart(6, "0")}` }));
      return undefined;
    });
    await expect(submitItemBidsCore(request())).rejects.toMatchObject({ status: 409 });
    expect(store.saves).toHaveLength(2);
    expect(store.saves.map((doc) => doc.modified)).toEqual([ORIGINAL_VERSION, "2026-09-18 12:52:00.000001"]);
    expect(store.commits).toBe(0);
    expect(store.document.bid_history).toHaveLength(4);
  });

  it("refuses to save an authoritative document with a missing version", async () => {
    const initial = fixture();
    delete initial.modified;
    const store = erpStore(initial);
    await expect(submitItemBidsCore(request())).rejects.toMatchObject({ status: 409 });
    expect(store.writes).toHaveLength(0);
  });

  it("preserves both suppliers' valid concurrent batches when 24 commits before 23", async () => {
    const store = erpStore();
    orderConcurrentFirstSaves(store, SUPPLIER_A);
    await Promise.all([
      submitItemBidsCore(request(SUPPLIER_A, 24)),
      submitItemBidsCore(request(SUPPLIER_B, 23)),
    ]);
    expect(store.commits).toBe(2);
    expect(store.saves).toHaveLength(3);
    const saved = store.document;
    expect(saved.lowest_bid).toBe(46);
    expect(saved.bid_history).toHaveLength(8);
    for (const item of ITEM_CODES) {
      expect(saved.bid_history?.filter((row) => row.item_code === item && row.round_number === 1)).toEqual(expect.arrayContaining([
        expect.objectContaining({ supplier: SUPPLIER_A, bid_amount: 24 }),
        expect.objectContaining({ supplier: SUPPLIER_B, bid_amount: 23 }),
      ]));
      expect(saved.bid_items?.find((row) => row.item_code === item && row.supplier === SUPPLIER_A)).toMatchObject({ current_rate: 24, rank: 2, is_lowest: 0 });
      expect(saved.bid_items?.find((row) => row.item_code === item && row.supplier === SUPPLIER_B)).toMatchObject({ current_rate: 23, rank: 1, is_lowest: 1 });
    }
    expect(saved.invited_suppliers?.find((row) => row.supplier === SUPPLIER_B)).toMatchObject({ current_bid: 46, rank: 1 });
  });

  it("rejects the stale 24 bid meaningfully when the competing 23 batch commits first", async () => {
    const store = erpStore();
    orderConcurrentFirstSaves(store, SUPPLIER_B);
    const results = await Promise.allSettled([
      submitItemBidsCore(request(SUPPLIER_A, 24)),
      submitItemBidsCore(request(SUPPLIER_B, 23)),
    ]);
    expect(results[1].status).toBe("fulfilled");
    expect(results[0]).toMatchObject({ status: "rejected", reason: { status: 409, latestLowestBid: 23, reasonCode: "outbid" } });
    if (results[0].status === "rejected") {
      expect(String(results[0].reason.message)).toMatch(/23\.00/);
      expect(String(results[0].reason.message)).not.toMatch(/modified after|Please refresh/i);
    }
    expect(store.commits).toBe(1);
    expect(store.saves).toHaveLength(2);
    expect(store.document.bid_history).toHaveLength(6);
    expect(store.document.bid_history?.slice(4).every((row) => row.supplier === SUPPLIER_B && row.bid_amount === 23)).toBe(true);
    expect(store.document.lowest_bid).toBe(46);
  });

  it("replays the same accepted batch without duplicate history or a second write", async () => {
    const store = erpStore();
    await submitItemBidsCore(request());
    const replay = await submitItemBidsCore(request());
    expect(store.commits).toBe(1);
    expect(store.writes).toHaveLength(1);
    expect(replay.bid_history).toHaveLength(6);
    expect(replay.lowest_bid).toBe(48);
  });

  it("handles simultaneous duplicate requests with one committed batch", async () => {
    const store = erpStore();
    const bothArrived = deferred();
    let arrivals = 0;
    store.beforeSave(async () => {
      arrivals += 1;
      if (arrivals === 2) bothArrived.resolve();
      if (arrivals <= 2) await bothArrived.promise;
      return undefined;
    });
    const results = await Promise.all([submitItemBidsCore(request()), submitItemBidsCore(request())]);
    expect(store.commits).toBe(1);
    expect(store.saves).toHaveLength(2);
    expect(results.every((result) => result.bid_history?.length === 6 && result.lowest_bid === 48)).toBe(true);
    expect(store.document.bid_history).toHaveLength(6);
  });

  it("recognizes a committed batch after its HTTP response is lost", async () => {
    const store = erpStore();
    let loseResponse = true;
    store.afterCommit(async () => {
      if (loseResponse) {
        loseResponse = false;
        throw new Error("ETIMEDOUT: response lost after ERP transaction committed");
      }
    });
    const saved = await submitItemBidsCore(request());
    expect(store.commits).toBe(1);
    expect(store.writes).toHaveLength(1);
    expect(saved.bid_history).toHaveLength(6);
    expect(saved.lowest_bid).toBe(48);
  });

  it("rejects duplicate item codes before writing any part of the batch", async () => {
    const store = erpStore();
    await expect(submitItemBidsCore({
      ...request(),
      items: [{ item_code: ITEM_CODES[0], rate: 24 }, { item_code: ITEM_CODES[0], rate: 23 }],
    })).rejects.toThrow(/duplicate|once|same item/i);
    expect(store.writes).toHaveLength(0);
    expect(store.document.bid_history).toHaveLength(4);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])("rejects a mixed batch with invalid rate %s rather than silently dropping it", async (rate) => {
    const store = erpStore();
    await expect(submitItemBidsCore({
      ...request(),
      items: [{ item_code: ITEM_CODES[0], rate: 24 }, { item_code: ITEM_CODES[1], rate }],
    })).rejects.toMatchObject({ status: 400 });
    expect(store.writes).toHaveLength(0);
  });

  it.each([24, 25])("rejects a %s bid against the server's current 24, regardless of stale client display", async (rate) => {
    const initial = fixture();
    initial.bid_items = initial.bid_items?.map((row) => row.supplier === SUPPLIER_B ? { ...row, current_rate: 24, latest_rate: 24, amount: 24 } : row);
    const store = erpStore(initial);
    await expect(submitItemBidsCore({
      ...request(SUPPLIER_A, rate),
      clientSnapshot: { totalLowest: 100, lowestByItem: { "ENGINE-COOLANT": 50, "GEAR-OIL": 50 } },
    })).rejects.toMatchObject({ status: 409, latestLowestBid: 24 });
    expect(store.writes).toHaveLength(0);
  });

  it("rejects an expired auction with no write", async () => {
    const initial = fixture();
    initial.end_date_time = new Date(Date.now() - 1_000).toISOString();
    const store = erpStore(initial);
    await expect(submitItemBidsCore(request())).rejects.toMatchObject({ reasonCode: "not_live" });
    expect(store.writes).toHaveLength(0);
  });

  it("rechecks expiry on conflict instead of retrying a now-closed auction", async () => {
    const store = erpStore();
    store.beforeSave(async () => {
      store.update((doc) => ({ ...doc, modified: "2026-09-18 12:59:00.000001", end_date_time: new Date(Date.now() - 1_000).toISOString() }));
      return undefined;
    });
    await expect(submitItemBidsCore(request())).rejects.toMatchObject({ reasonCode: "not_live" });
    expect(store.saves).toHaveLength(1);
    expect(store.commits).toBe(0);
    expect(store.document.bid_history).toHaveLength(4);
  });

  it("rejects a missing item without partially saving other valid items", async () => {
    const store = erpStore();
    await expect(submitItemBidsCore({ ...request(), items: [...request().items, { item_code: "NOT-ON-BID-SHEET", rate: 1 }] })).rejects.toMatchObject({ reasonCode: "missing_item" });
    expect(store.writes).toHaveLength(0);
  });

  it("rejects a supplier who is not invited", async () => {
    const store = erpStore();
    await expect(submitItemBidsCore(request("Uninvited Supplier"))).rejects.toMatchObject({ status: 403 });
    expect(store.writes).toHaveLength(0);
  });
});
