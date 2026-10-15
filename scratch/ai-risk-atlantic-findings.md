# Atlantic risk evidence — 23 September 2026

This was a read-only ERPNext inspection. No scoring run, RFQ, quotation, PO, receipt, invoice or workflow record was created or changed.

## Saved evaluation

- RFQ: `PUR-RFQ-2026-00094`
- Evaluation: `SCORE-PUR-RFQ-2026-00094-00120`
- Run: `2bb6e50d-78b2-4967-9cdd-1e9d0652fbe7`
- Quotation: `PUR-SQTN-2026-00265`
- Supplier ID: `"Atlantic Precision Manufacturing."` (quotation marks are part of the ERP document ID).
- Stored overall score: 91; dimensions: price 100, delivery 100, quality 59, reliability 95; weights: 40/25/20/15.
- Stored `raw_ai_score`: 73; risk: High; verdict: AVOID.
- Stored rationale attributes risk to 142 of 242 ordered units received, 58.7% quantity accuracy, 100 units unreceived, and only three of four POs completed.

## Corroborated ERP documents

| Purchase Order | Ordered / received | State | Receipt |
| --- | ---: | --- | --- |
| PUR-ORD-2026-00002 | 106 / 106 | Completed | MAT-PRE-2026-00001 |
| PUR-ORD-2026-00016 | 18 / 18 | Completed | MAT-PRE-2026-00014 |
| PUR-ORD-2026-00017 | 18 / 18 | Completed | MAT-PRE-2026-00016 |
| PUR-ORD-2026-00027 | 100 / 0 | To Receive and Bill | No submitted receipt found |

The first PO was due 27 June and received 20 June. The other two completed POs were due and received 16 July. All three receipts record zero rejected quantities. The entire 100-unit gap is the last open PO: item `APSU005`, schedule date 11 September 2026, `per_received = 0`. It was overdue at this 23 September inspection.

Invoices `ACC-PINV-2026-00001`, `ACC-PINV-2026-00012`, and `ACC-PINV-2026-00013` each have posting dates on their due date. Their current status is Paid. The scoring input evaluates posting date against due date, not the dates of payment; it cannot establish that payment happened on time.

Quotation `PUR-SQTN-2026-00265` is submitted, for RFQ94, item `ENG002`, quantity 100, unit rate 25, total 2500. It is a different item from the unreceived PO's `APSU005`.

## Interpretation boundaries

The aggregate 242 ordered / 142 received / zero rejections is factual. The saved narrative's language about partial shipments or short delivery is an inference: the inspected records show three fully received POs and one wholly unreceived PO, not a partly received shipment or rejected material.

`src/api/supplierPerformance.ts` computes the established quality metric from accepted receipts divided by every submitted PO's quantities, including open POs. This explains the 59 historical quantity score; it is not proof of an inspection defect. The current task does not change that scoring formula.

The saved snapshot has quotation identities/totals, not a full original historical input or raw Claude response. `raw_ai_score = 73` survives, while the original Claude ranking, recommendedSupplier, summary and complete response do not. Accordingly, the original raw model response cannot be reconstructed or claimed to contain the final score 91 or the final recommendation. A new Claude call would be a new run and cannot prove what this run returned.

Evidence: `scratch/ai-risk-atlantic-evidence.json`, fetched 2026-09-23T06:12:10.602Z; all relevant PO/receipt/invoice modification dates precede the saved scoring run.
