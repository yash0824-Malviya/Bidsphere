# Reverse-bid item version conflict — verified fix

## Result

**RB-2026-00023 successfully accepted Titan's two $24 item bids in one ERP transaction.** RFQ: `PUR-RFQ-2026-00092`.

| Item | Item code | Previous rate | Accepted rate | Persisted history row |
|---|---|---:|---:|---|
| Engine Coolant | CF002 | $25 | $24 | 70o4rrpuje |
| Gear Oil | CL002 | $25 | $24 | 70oqd0j5k5 |

Both history rows are `Accepted`, supplier round 1, with bid time `2026-09-18 13:03:07`. The parent readback version is `2026-09-18 13:03:09.674315`. Titan's total and the auction's lowest supplier total are **$48**; each item lowest is **$24**. FEMSA remains at $25 per item / $50 total.

The original window expired at 12:58 PM. With the user's explicit approval, the existing scheduling/start functions reopened the auction from **13:03:07 to 13:13:07** for the acceptance test. No expiry rule was bypassed.

## Root cause

`saveChildDocument()` deleted `modified` from existing Reverse Bid Item rows before calling `frappe.client.save`. Frappe checks the supplied original timestamp against the stored document timestamp. Removing it caused the version check to fail without any competing writer.

The reported two timestamps were not proof of a second database update: Frappe's error displays the stored version and the attempted save time. The live inspection still showed parent and all four child rows at `12:51:34.256440`, with no bid history. No Reverse Bidding-related Server Scripts were installed.

The old persistence function also split one submission across separately committed item saves, history inserts, supplier updates and a parent lowest-value update. That exposed partial-update and actual concurrent-supplier races. A separate generic parent-update helper retried old child arrays with a newly fetched timestamp, which could overwrite a concurrently accepted bid.

Installed versions: Frappe **16.20.0**, ERPNext **16.22.0**. Frappe's normal parent save loads the prior document with `for_update=True` and checks the original `modified` before writing parent/children. The fix uses this existing mechanism. [Frappe version check and locked document load](https://github.com/frappe/frappe/blob/v16.20.0/frappe/model/document.py), [standard save endpoint](https://github.com/frappe/frappe/blob/v16.20.0/frappe/client.py).

## Final debug answers

| Requested check | Finding |
|---|---|
| Document | Parent `RB-2026-00023`; Titan item rows `jh1dinqtgj` (CF002), `jh14ugpfgq` (CL002). Rank updates can also affect FEMSA's rows. |
| Concurrent writer | No concurrent writer was required for the reported failure. The defective submission path itself stripped versions and used separate child/parent writes. Real competing suppliers/lifecycle actions are now protected. |
| Frontend stale save | **NO** for the Supplier Portal action. It sends auction ID and item/rate inputs, plus diagnostic displayed prices—not full documents or timestamps. |
| Backend atomic transaction | **YES**, one standard parent save includes rates, totals, ranks and appended history. Previously NO. |
| Child-table concurrency | Former independent child writes removed; changes now commit through the parent. |
| Multi-item parallel write | **NO** frontend `Promise.all` submission. Both items were already one HTTP action; the backend had split the writes. |
| Optimistic locking preserved | **YES**. Exact microsecond parent `modified` is retained. No ignore flags or direct SQL updates. |
| Retry logic | One fresh read/revalidation/rebuild after a retryable failure. A second conflict returns current auction state and a meaningful business message. It never attaches a fresh timestamp to an old payload. |
| Current lowest at verification | **$24 per item; $48 supplier total**. |
| Bid submission | **SUCCESS**, actual ERP save and readback, with two accepted history records. |

## Changes

- Replaced independent child/history/lowest writes with one full parent transaction from freshly fetched ERP state.
- Preserved all existing history rows, names and timestamp precision; append only the new item history rows.
- Kept authenticated supplier resolution in the existing endpoint. No supplier identity or displayed lowest price from the browser controls server validation.
- Reused the existing supplier round and exact accepted item/rate set to recognize duplicate requests or a lost response after commit. No new schema or idempotency table.
- Reject malformed/duplicate item inputs as a complete batch. Both production and Vite now use the same handler and structured conflict response.
- Added a synchronous double-click guard. A successful response replaces older display fetches, updates the query cache and refreshes. Failed bids preserve entered values.
- Kept 2-second supplier polling, 5-second buyer polling and local countdown behavior. These reads/timers do not save bid items.
- Removed the generic parent helper's unsafe stale-array retry; conflicting lifecycle/target edits require refresh/review instead of overwriting newer bids.

## Verification

- **Live current case passed:** one parent save, two $24 accepted Titan history rows, latest state read back from ERP.
- Repeating the exact accepted batch caused **zero further writes** and no duplicate history.
- Real negative checks for FEMSA at $25 and $24 against the $24 lowest were rejected, without writes.
- **21 backend regression tests passed**, including controlled concurrent $24/$23 submissions, both commit orderings, preservation of both valid bids, rejection of an outbid retry, duplicate requests, response loss after commit, expiry, and no partial writes.
- **7 frontend/service concurrency tests passed**, including synchronous double-click prevention, response/cache ordering, continued polling and prevention of stale parent-array retries.
- **3 endpoint tests passed**, including whole-batch validation, authenticated supplier attribution and structured conflict state.
- Production build passed. Full regression run: **2,125 passed, 4 pre-existing Legal/Finance handoff failures, 2 intentionally skipped live probes**. The new RB23 live probe passed separately after that run.
- Local development endpoint still returns HTTP 401 without supplier authentication.

The live probe called the production business core with the authorized Titan identity using real ERP transport; browser clicking under a live Titan login is not claimed. Component tests verify the submit handler and cache refresh behavior. The returned state contains the two rows consumed by the portal's “Your Bids” list.

No AI scoring, recommendations, RFQ, e-signature, Finance or PO workflow was changed. No purchase order or award was created.

## Evidence files

- `scratch/rb23-concurrency-before.json`: original parent/child state, schemas, server-script check and installed versions.
- `scratch/rb23-concurrency-live-verified.json`: approved schedule change, exact transaction payload, accepted ERP document, readback, duplicate and negative results.
- `scratch/rb23-concurrency-live.log`: successful live test.
- `scratch/rb23-concurrency-full-tests.json`: full regression report.
- `scratch/rb23-concurrency-final-build.log`: final build output.

The live test is opt-in (`RUN_LIVE_RB23_BID=1`). Reopening additionally requires `REOPEN_RB23_FOR_TEST=1`; normal tests neither reopen auctions nor submit live bids.

## Follow-up verification after the repeated report

At approximately 13:08 on 18 September, a fresh ERP read confirmed the same two accepted Titan history records and unchanged parent version `2026-09-18 13:03:09.674315`. Both Titan item rates remain $24, and the lowest total remains $48. The newly pasted error still names the original 12:52 attempted save.

A read-only runtime audit confirmed that localhost:5175 serves the updated client, uses the same-origin action endpoint, and loads the production handler with the atomic parent-save core. No alternate supplier child-save route, API target override or service-worker cache was found. No additional bids or schedule changes were made during this follow-up.

The preview was signed out. It is now on the Supplier Portal login with Titan selected, awaiting the user's sign-in for visual verification of “Your Bids (2)”.
