# Supplier AI scoring correction — 17 September 2026

## Result

Current RFQ: **PUR-RFQ-2026-00091**. Exactly **3 current submitted quotations** and **3 current evaluation rows** were traced through the configured Claude gateway, parser, weighted calculation, ERPNext persistence/readback, frontend normalization and live Recommendation Results page.

Saved result: `SCORE-PUR-RFQ-2026-00091-00115`.

Evaluation run: `86ebda3c-27bb-4acf-a908-0cdb30e4ff55`.

| Supplier | Quotation | Raw Claude overall | Calculated / parsed | ERPNext | Frontend after refresh | Rank | Risk / verdict |
|---|---|---:|---:|---:|---:|---:|---|
| FEMSA | PUR-SQTN-2026-00256 | 100 | 100 | 100 | 100 | 1 | Low / BEST VALUE |
| Titan Industrial Products LLC | PUR-SQTN-2026-00253 | 100 | 100 | 100 | 100 | 2 | Low / GOOD OPTION |
| Eagle Peak Technologies Inc. | PUR-SQTN-2026-00257 | 78 | 84 | 84 | 84 | 3 | Medium / GOOD OPTION |

Supplier IDs are `FEMSA`, `"Titan Industrial Products LLC"`, and `"Eagle Peak Technologies Inc."`. The surrounding quotation marks in the latter two are literal characters in ERPNext document IDs; the corrected pipeline retains them.

## Root cause and first source of 75

**75 first appeared in the raw Claude response.** It was not introduced by a frontend fallback, copied from the first supplier, or produced by the weighted calculation.

Before changing scoring behavior, a live replay of the current ERP quotation inputs through the original prompt and configured backend reproduced three raw scores of 75. All three raw rows contained dimensions **price 100, delivery 72, quality 75, reliability 80**. Under the existing weights, these total **85**, not 75:

`round((100 × 40 + 72 × 25 + 75 × 20 + 80 × 15) / 100) = 85`

The parser discarded Claude's quality score. The RFQ page then preserved Claude's unvalidated overall score while borrowing quality 100 and source metadata from the separate local engine. Thus the original database/UI showed **75** alongside a **100 / 72 / 100 / 80** breakdown, which would total **90**. The saved winner was also changed on ties without updating the original narrative/verdict.

The original prompt falsely described attachments as verified and supplied an assumed 7–14 day lead time. It also asked for different overall scores when prices matched, even when no genuine distinguishing input was present.

Repository searches found no active overall-score fallback of 75. The separate `recommendSuppliersCore.ts` uses 75 as a pre-invitation supplier shortlisting cutoff; that code is not the quotation-evaluation pipeline and was left unchanged. The existing neutral delivery rule of 70–75 remains only for cases where both quoted delivery and usable history are unavailable, and is explicitly described as an assumption.

## Supplier inputs: equal quotation values, different actual histories

Each quotation was a separate object with its own quotation and supplier IDs. There was no shared quotation-object reuse. All three current quotations contain:

- AP001 / Brake Disc, quantity 1, rate and total USD 15.
- `lead_time_days = 0`; no actual quoted delivery commitment was persisted.
- No populated payment terms, warranty note or terms note in the fields consumed by evaluation.
- Warranty, terms and insurance attachments present. Attachment contents and legal validity are not verified by AI scoring.

The earlier prompt effectively gave Claude identical evaluation evidence except for supplier identity. Supplier history was fetched by display name instead of the actual ERP supplier ID, omitting the quoted-name IDs. Historical data also was not included in the Claude input. Additionally, the history calculator compared receipts against an unrelated first purchase order and used order completion percentages as if they were physical quantities.

Corrected read-only ERP history inspection:

| Supplier | POs / receipts / invoices | On time / late | Ordered / received quantity | Rejected | Historical delivery / quality / reliability |
|---|---|---|---|---:|---|
| FEMSA | 3 / 3 / 3 | 3 / 0 | 565 / 565 | 0 | 100 / 100 / 100 |
| Titan | 2 / 2 / 1 | 2 / 0 | 1320 / 1320 | 0 | 100 / 100 / 100 |
| Eagle Peak | 2 / 2 / 1 | 1 / 1 | 10 / 10 | 0 | 35 / 100 / 100 |

Eagle receipt `MAT-PRE-2026-00010`, posted 4 July 2026, references PO `PUR-ORD-2026-00003`, due 29 June: **five days late**. The previous first-order lookup incorrectly compared that receipt with a newer July order.

The existing delivery-history formula yields 35 for Eagle. Its final score is therefore:

`round((100 × 40 + 35 × 25 + 100 × 20 + 100 × 15) / 100) = 84`

FEMSA and Titan legitimately tie at 100 because all four scoring dimensions are 100. Their transaction counts differ, but the existing weighted formula does not manufacture an extra score difference from those counts. Claude ranked FEMSA first based on its larger history; the UI now preserves that ranking.

Quality history here measures received/accepted quantities and rejections, not an independent certification of product quality. Invoice timeliness uses posting date versus due date; actual payment history is explicitly unavailable.

## Fix applied

1. The Claude gateway and browser parser share strict quotation/supplier/run validation and the existing 40/25/20/15 weighted calculation. Raw model overall scores are retained separately for diagnosis. Invalid or truncated evaluations return HTTP 422.
2. All four dimensions, including quality, survive parsing. Valid zero scores remain zero. Missing or invalid evaluations show unavailable/incomplete instead of a fabricated AI score.
3. Opaque IDs retain case, punctuation and embedded quotation marks. Results are joined by IDs, never array index. Conflicting or mixed runs are rejected.
4. Historical queries use actual supplier IDs. Receipts match their actual PO/PO item; quantity calculations use document child rows. Missing data remains unavailable.
5. The prompt evaluates each quotation independently, allows legitimate ties, includes supplier-specific history, and distinguishes quoted data from historical evidence and assumptions.
6. The RFQ page converts the complete AI evaluation to persistence rows without mixing local-engine dimensions or sources. Saving awaits ERPNext readback verification before publishing the result.
7. Existing `analysis_snapshot` stores quotation IDs, supplier IDs, run ID, raw/calculated scores, dimensions, risk, verdict and narrative together. No DocType fields or migrations were added.
8. The frontend always checks ERPNext for a newer evaluation. Saved winner, rank, risk, verdict and per-supplier breakdown remain together. Main RFQ cards no longer re-rank ties or fill missing AI rows with local scores.
9. Detailed diagnostics are development-only. The actual Anthropic request and response both reported **claude-haiku-4-5-20251001**. The Anthropic key remains server-side.

## Verification

- Live baseline raw request/response and parsed result: `scratch/ai-score-baseline-live.json`.
- Actual quotation/DocType evidence: `scratch/ai-score-rfq91-source.json`.
- Corrected PO/receipt history evidence: `scratch/ai-score-current-histories.json`.
- Post-fix request, raw response, parsed result, saved ERP document and final snapshot API response: `scratch/ai-score-current-verified.json`.
- Live browser console showed the same run ID and three supplier-specific objects as ERPNext. Refresh showed FEMSA 100, Titan 100, Eagle 84. Cards showed ranks 1, 2 and 3 respectively.
- Recommendation Results displayed three rows, FEMSA's explicitly labelled breakdown, and the current run's executive summary. Eagle's detail showed 84, Medium risk and its own 100/35/100/100 breakdown. Page width equalled viewport width (1280px).
- Current RFQ and all three quotations retained identical modified timestamps, status, docstatus and item data: `scratch/ai-score-unchanged-source-check.json`.
- Production build passed. Full regression run: **2054 passed, 4 pre-existing failures, 1 intentionally skipped live integration test**. Failures remain exclusively in `src/api/approvalWorkflow.test.ts`; these are the same Legal/Finance handoff failures recorded before this scoring task. See `scratch/ai-score-full-tests.json`.
- The manual live integration test passed separately with explicit opt-in. Normal tests never call Claude or create ERP scoring records.

The live replay used the existing evaluation functions/gateway and persistence API, then verified the real browser's report after refresh. The existing pre-selection Re-run button has an unrelated guard requiring a selected supplier; the trigger policy was left unchanged as requested. A pre-existing `Supplier RFQ Response` DocType 404 still appears during RFQ-page loading. No post-refresh scoring/module/runtime error was observed after final fixes.

Only the scoring result was created. No supplier was awarded, no quotation was edited, and no RFQ/Legal/Finance/PO/Business Case transition was performed. Workflow logic and PDF/e-signature code were not changed in this task.
