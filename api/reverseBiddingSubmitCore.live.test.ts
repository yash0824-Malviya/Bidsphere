/** Opt-in live acceptance for the user-authorized RB-2026-00023 test. */
import { expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { submitItemBidsCore } from "./reverseBiddingSubmitCore";
import { scheduleAuction, startAuctionNow } from "../src/api/reverseBidding";

const transport = vi.hoisted(() => ({ api: null as null | ((method: string, path: string, body?: unknown) => Promise<any>) }));
vi.mock("../src/api/erpnext", async (original) => {
  const actual = await original<typeof import("../src/api/erpnext")>();
  return { ...actual,
    apiGet: (path: string) => transport.api!("GET", path.replace(/^\/api\//, "")),
    apiPut: (path: string, body: unknown) => transport.api!("PUT", path.replace(/^\/api\//, ""), body),
  };
});

it.skipIf(process.env.RUN_LIVE_RB23_BID !== "1")("records Titan's two authorized $24 item bids atomically and verifies ERP history", async () => {
  const module = await import(/* @vite-ignore */ `${process.cwd().replaceAll("\\", "/")}/scripts/ecr-schema-erp-client.mjs`);
  const api = module.createEcrSchemaErpClient(); // reads credentials without printing them
  const name = "RB-2026-00023";
  const path = `resource/Reverse%20Bidding/${name}`;
  const before = await api("GET", path);
  const evidence: any = { before, writes: [] };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: any, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const endpoint = decodeURIComponent(new URL(String(url)).pathname);
      if (endpoint === `/api/resource/Reverse Bidding/${name}` && method === "PUT" && process.env.REOPEN_RB23_FOR_TEST === "1") {
        if (!body.modified || Object.keys(body).some((key) => !["modified", "start_date_time", "end_date_time", "minimum_decrement", "auction_status", "invited_suppliers"].includes(key))) throw new Error("Unexpected schedule mutation in live probe.");
      } else if (endpoint === "/api/method/frappe.client.save" && body.doc?.doctype === "Reverse Bidding" && body.doc.name === name && method === "POST") {
        expect(body.doc.modified).toBeTruthy();
        expect(body.doc.bid_history.filter((row: any) => !row.name).every((row: any) => row.supplier === '"Titan Industrial Products LLC"' && row.bid_amount === 24)).toBe(true);
      } else throw new Error(`Live probe disallows mutation ${method} ${endpoint}`);
      evidence.writes.push({ endpoint, method, body });
    }
    return realFetch(url, init);
  });
  transport.api = api;
  try {
    expect(before.rfq).toBe("PUR-RFQ-2026-00092");
    if (process.env.REOPEN_RB23_FOR_TEST === "1") {
      const now = Date.now();
      await scheduleAuction(name, { startDateTime: new Date(now + 30_000).toISOString(), endDateTime: new Date(now + 10 * 60_000).toISOString(), minimumDecrement: before.minimum_decrement ?? 0 });
      evidence.reopened = await startAuctionNow(name);
    }
    const input = { auctionName: name, supplier: '"Titan Industrial Products LLC"', items: [{ item_code: "CF002", rate: 24 }, { item_code: "CL002", rate: 24 }] };
    evidence.input = input;
    evidence.result = await submitItemBidsCore(input);
    evidence.persisted = await api("GET", path);
    const mine = evidence.persisted.bid_items.filter((row: any) => row.supplier === input.supplier);
    expect(mine).toHaveLength(2);
    expect(mine.every((row: any) => row.current_rate === 24 && row.latest_rate === 24)).toBe(true);
    const history = evidence.persisted.bid_history.filter((row: any) => row.supplier === input.supplier);
    expect(history).toHaveLength(2);
    expect(history.map((row: any) => row.item_code).sort()).toEqual(["CF002", "CL002"]);
    expect(history.every((row: any) => row.bid_amount === 24 && row.previous_rate === 25 && row.name && row.bid_time && row.status === "Accepted")).toBe(true);
    expect(evidence.persisted.lowest_bid).toBe(48);
    expect(evidence.persisted.invited_suppliers.find((row: any) => row.supplier === input.supplier).current_bid).toBe(48);
    expect(evidence.persisted.invited_suppliers.find((row: any) => row.supplier === "FEMSA").current_bid).toBe(50);
    const writesAfterSave = evidence.writes.length;
    const replay = await submitItemBidsCore(input);
    expect(replay.bid_history).toEqual(evidence.persisted.bid_history);
    expect(evidence.writes).toHaveLength(writesAfterSave);
    for (const rate of [25, 24]) {
      await expect(submitItemBidsCore({ ...input, supplier: "FEMSA", items: [{ item_code: "CF002", rate }] })).rejects.toThrow(/lower|previous/);
    }
    expect(evidence.writes).toHaveLength(writesAfterSave);
    evidence.duplicate_replayed_without_write = true;
    evidence.equal_and_higher_bids_rejected = true;
    evidence.parent_save_count = evidence.writes.filter((write: any) => write.endpoint === "/api/method/frappe.client.save").length;
    expect(evidence.parent_save_count).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    writeFileSync("scratch/rb23-concurrency-live-verified.json", JSON.stringify(evidence, null, 2));
  }
}, 120000);
