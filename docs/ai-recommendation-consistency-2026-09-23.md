# AI evaluation, risk, verdict and recommendation consistency

> Follow-up policy: the user subsequently required AVOID suppliers to be non-awardable. That rule and its backend enforcement are documented in [Supplier award eligibility](supplier-award-eligibility-2026-09-23.md). The investigation below records the earlier presentation-only fix.

## Result and scope

The affected evaluation is RFQ **PUR-RFQ-2026-00094**, scoring result **SCORE-PUR-RFQ-2026-00094-00120**, run **2bb6e50d-78b2-4967-9cdd-1e9d0652fbe7**. Its ERPNext snapshot was read on 23 September 2026. The problem is that the application used a weighted-score leader as an unconditional supplier recommendation while retaining that same supplier's High Risk / AVOID assessment.

The correction separates **AI top-ranked** from an award recommendation. It preserves scores, ranking, quote totals, risk and verdict. Atlantic remains rank 1 at 91 and visibly requires review because its evaluation says High Risk / AVOID. No alternate supplier is promoted, and no new award or reverse-bidding eligibility restriction is introduced.

RFQ workflow, quotation, reverse bidding, Legal verification, e-signature, Finance approval, PO creation, Business Case and supplier onboarding are outside this change.

## SCORE CALCULATION: VALID

The configured weights are price 40%, delivery 25%, quality 20%, reliability 15%. The shared calculation remains unchanged:

`round((price × 40 + delivery × 25 + quality × 20 + reliability × 15) / 100)`

**ATLANTIC SCORE: 91**

`round(100 × 0.40 + 100 × 0.25 + 59 × 0.20 + 95 × 0.15) = round(91.05) = 91`

The stored evaluation is:

| Supplier | Quotation | Stored raw AI overall | Validated score | Dimensions: price / delivery / quality / reliability | Risk | Verdict | Quote total |
| --- | --- | ---: | ---: | --- | --- | --- | ---: |
| Atlantic Precision Manufacturing. | PUR-SQTN-2026-00265 | 73 | 91 | 100 / 100 / 59 / 95 | High | AVOID | USD 2,500 |
| FEMSA | PUR-SQTN-2026-00267 | 95 | 87 | 67 / 100 / 100 / 100 | Low | GOOD OPTION | USD 2,600 |
| Blue Ridge Manufacturing Inc | PUR-SQTN-2026-00269 | 82 | 85 | 100 / 41 / 100 / 100 | Medium | GOOD OPTION | USD 2,500 |

`raw_ai_score` is separate from the validated score. Atlantic's raw value is **73**, not 91. The application correctly replaces invalid overall arithmetic with the configured weighted total. This task does not change the scoring formula or its supplied dimensions.

## RISK SOURCE

For the current Claude pipeline, risk is the provider's per-quotation `risk` field. The gateway requires an explicit `Low`, `Medium` or `High`; it does not compute risk from the overall score. The parser retains that field and the UI reads the risk from the same evaluation row.

Atlantic's stored explanation attributes High Risk / AVOID to **142 received units out of 242 ordered units**, quantity accuracy **58.7%**, and only three completed POs out of four. This is the actual recorded rationale; missing certificates, warranty or compliance failures are not its stated basis.

### Corroborated Atlantic ERPNext evidence

The supplier's ERP ID is `"Atlantic Precision Manufacturing."`; the quotation marks are literal characters in the ID.

| Purchase Order | Ordered / received | State | Matching receipt |
| --- | ---: | --- | --- |
| PUR-ORD-2026-00002 | 106 / 106 | Completed | MAT-PRE-2026-00001 |
| PUR-ORD-2026-00016 | 18 / 18 | Completed | MAT-PRE-2026-00014 |
| PUR-ORD-2026-00017 | 18 / 18 | Completed | MAT-PRE-2026-00016 |
| PUR-ORD-2026-00027 | 100 / 0 | To Receive and Bill | No submitted receipt found |

The entire 100-unit gap comes from **PUR-ORD-2026-00027**, item **APSU005**, scheduled for **11 September 2026**, with `per_received = 0`. It was overdue at the 23 September inspection. The other three POs are fully received, all three receipts are on time against their actual PO commitments, and all received quantities have **zero rejections**.

This supports an **overdue unreceived order**. It does not establish a physical quality defect or observed partial shipment. The saved narrative's statements about partial shipment or unacceptable future short delivery are model inferences, not additional ERP facts. The current quotation concerns **ENG002**, quantity 100 at USD 25, whereas the unreceived historical PO concerns **APSU005**.

The established historical quality metric in `src/api/supplierPerformance.ts` is accepted receipt quantity divided by all submitted PO quantities, including open orders. Its calculation is `round(142 / 242 × 100) = 59`. That metric remains unchanged. It must not be presented as independent inspection or compliance verification.

Invoices **ACC-PINV-2026-00001**, **ACC-PINV-2026-00012**, and **ACC-PINV-2026-00013** each have a posting date on their due date and currently show Paid. The scoring input uses posting date versus due date. It does not establish when payment occurred. Consequently, the model's phrase “invoices paid on time” is stronger than the evidence used by the evaluation.

## VERDICT SOURCE

The Claude prompt requests one of `BEST VALUE`, `GOOD OPTION`, `EXPENSIVE`, `AVOID`, or `QUOTE INCOMPLETE`. It reserves `AVOID` for severe risk, non-compliance, missing quote or unacceptable terms; it explicitly disallows assigning AVOID merely because a supplier is last-ranked.

The shared `validateAndScoreEvaluation` function in `src/utils/aiEvaluationScore.ts` retains an explicit AVOID verdict while validating identities and recomputing weighted overall scores. Thus Atlantic's AVOID verdict survives its arithmetic correction from raw 73 to validated 91.

### BEST VALUE logic — unchanged

The existing normalization is:

1. Missing price becomes `QUOTE INCOMPLETE`, except that an explicit `AVOID` is retained.
2. The weighted-score leader becomes `BEST VALUE` unless its existing verdict is `AVOID` or `QUOTE INCOMPLETE`.
3. A displaced `BEST VALUE` becomes `GOOD OPTION`.
4. Other valid provider verdicts are retained.

BEST VALUE is therefore not independently calculated from the lowest quotation amount. It is a score-ranking label in this implemented contract. Atlantic and Blue Ridge both quoted USD 2,500, but their delivery and quality dimensions differ. Atlantic's retained AVOID prevents its rank-1 BEST VALUE label. No supplier in this saved result has BEST VALUE. The original provider verdict for FEMSA cannot be recovered from the normalized snapshot, so this report does not assert that Claude originally assigned it BEST VALUE.

The separate local fallback has its own rank-to-verdict mapping in `src/api/ai.ts`; it is not the source of the inspected Claude evaluation. That mapping and the normal BEST VALUE rules were not rewritten as part of this fix.

## RECOMMENDED BADGE SOURCE

Before the correction, the chain was:

1. `validateAndScoreEvaluation` sorted valid-price results by calculated weighted score, preserving the model's rank for genuine ties.
2. It set the legacy fields `recommendedSupplier`, `recommended_quotation_id` and `recommended_supplier_id` to the first row, even if that row had High Risk / AVOID.
3. `src/api/ai.ts` mapped the same row into `AIRecommendation`.
4. `src/api/supplierScoringResults.ts` persisted that identity and the complete analysis snapshot in ERPNext.
5. `findRecommendationWinner` in `src/utils/aiRecommendationNormalization.ts` resolved the saved identity by quotation/supplier IDs.
6. `SupplierLeaderboard` in `src/components/AIAnalysisModal.tsx` displayed Recommended whenever the row matched that identity and had valid pricing. It did not inspect risk or verdict.

The badge was not independently based on the lowest price. It was the presentation of a backend-selected **weighted-score leader**. The hero banner, compact panel and RFQ decision summary also described that leader as a recommendation, widening the contradiction.

## RAW CLAUDE OUTPUT

**The complete original raw Claude response is unavailable for this saved run.** The ERPNext snapshot retains `raw_ai_score` values, per-supplier normalized risk/verdict/reasoning, and the final validated evaluation. It does not retain the original raw JSON, original ranking, original `recommendedSupplier`, or original summary. Its quotation snapshot contains quotation IDs, supplier IDs and totals, not the entire historical input prompt.

The stored raw overall values are Atlantic 73, FEMSA 95 and Blue Ridge 82. These are not sufficient to reconstruct the missing original recommendation. It would be incorrect to claim that Claude returned “Atlantic 91, High, AVOID, recommended true.” There is no provider `recommended: true` flag in the implemented schema.

`api/ai-claude.ts` separates provider text from processed text and can return the untouched provider response through explicitly enabled development diagnostics. Those diagnostics were not saved in this ERP evaluation. A new model call would be a different run and could not prove what the original run returned. This investigation did not rerun Claude.

## BACKEND OUTPUT

The inspected ERP scoring record stores Atlantic as `recommended_supplier`, Atlantic rank 1 with score 91, High Risk and AVOID. The snapshot summary was already rewritten by the arithmetic validator to say that Atlantic ranks first with weighted score 91 and to list the configured weights. It is not the original provider summary.

The corrected gateway keeps the compatibility fields identifying the weighted-score leader and adds a consistent interpretation to each evaluated row:

- Stable quotation ID, supplier ID and evaluation run ID.
- Score, risk, verdict and existing reasoning.
- `is_top_ranked` and `recommendation_basis: "weighted_score"`.
- `recommendation_status`: `TOP_RANKED`, `RANKED_ALTERNATIVE`, `REQUIRES_REVIEW`, or `NOT_EVALUATED`.
- An explanation that weighted ranking is not an award recommendation or approval.

Atlantic becomes `is_top_ranked: true` and `recommendation_status: "REQUIRES_REVIEW"`. FEMSA and Blue Ridge remain ranked alternatives with their existing Low/Medium risk and GOOD OPTION verdicts. The statuses describe the evaluation; they do not grant or revoke workflow permissions.

## FRONTEND OUTPUT

The corrected presentation labels the score leader **AI top-ranked**, shows High Risk and AVOID beside Atlantic's unchanged 91, and displays **Requires review**. Details explain the score, recorded risk/verdict and interpretation from the same supplier evaluation. A missing explicit risk is shown as unavailable rather than manufactured from score or reliability.

The leaderboard, hero, compact analysis panel and RFQ summary use the same decision projection. The visible executive summary is built from these same rows, including each supplier's score, risk, verdict, quote total, interpretation and recorded reasoning. A preserved provider/prior summary is diagnostic context rather than a second authoritative recommendation. A prior summary preserved from an old snapshot is not represented as verified raw Claude output.

The selected-supplier summary resolves the selected supplier's own evaluation, rather than inheriting the score leader's confidence, risk, price or narrative. It no longer infers technical compliance from a numerical score. Recorded selection history remains separate from AI evaluation facts. The compact report's risk section also uses these exact rows, without mislabelling all provider explanations as cost risk. The PDF uses **AI Top-Ranked Supplier**; its separate confidence measure remains unchanged.

## ROOT CAUSE

Two different concepts shared one label:

- The backend's `recommendedSupplier` meant the supplier with the highest validated weighted score.
- The frontend's Recommended/AI Pick wording conveyed supplier suitability or an award recommendation.

Risk and verdict remained separate model assessments, and AVOID intentionally survived score recalculation. That allowed **Recommended + High Risk + AVOID**. Risk was not copied from FEMSA or another quotation in the inspected result; the contradictory fields belong to the same Atlantic row and run. The score correction exposed the semantic mismatch without causing an arithmetic error.

The arithmetic validator also replaced the model summary after correcting totals. Without a summary generated from the final rows, this could leave a score-leader statement detached from retained supplier warnings.

## FIX AND BUSINESS-POLICY CHOICE

The implemented resolution is **option B**: Atlantic remains AI top-ranked while its High Risk / AVOID warning and recorded explanation remain visible. The existing prompt and validator explicitly tied the legacy recommendation field to rank 1. Repository inspection found **no global configured rule that High Risk alone overrides score ranking or prohibits supplier selection**.

One reverse-bidding candidate list excludes AVOID, but that is a specific existing workflow rule and does not establish a universal award policy. This task preserves existing selection and workflow behavior. It does not silently promote FEMSA, change score weights, or invent a compliance threshold.

`src/utils/aiEvaluationDecision.ts` supplies the shared per-row projection and summary. The gateway, parser and display paths consume that interpretation. The prompt now clarifies the established rank-leader meaning, requires evidence-based risk explanations, and forbids presenting High Risk / AVOID as an unqualified procurement recommendation.

Normalization also preserves the gateway's existing complete-price priority before comparing weighted scores. An incomplete-price quotation, whose score uses different available dimensions, therefore cannot acquire displayed rank 1 while another quotation remains the gateway's leader. New snapshots persist the same decision fields verified by readback; old snapshots are projected on read without rewriting ERPNext history.

Whether the product should adopt a separate, enforced risk-based supplier eligibility policy remains **unresolved by the existing requirements**. That policy is not silently introduced by this consistency fix.

## Validation

### Automated checks

- Production TypeScript/Vite build passed. Existing Vite configuration and bundle-size warnings remain.
- Final focused run: **172 tests passed in 16 files**, covering gateway, score calculation, decision projection, parsing, normalization, persistence/readback, report rendering, selected-supplier identity/summary, RFQ display, reverse-bidding selection helpers, sidebar and ECR regression checks.
- The broad suite completed with 2,526 passed, 6 failed and 3 skipped. Two failures were 5-second import timeouts in Sidebar and ECR tests; both suites passed on the targeted retry. The remaining four are previously existing assertions in `src/api/approvalWorkflow.test.ts` concerning Legal/Finance/Procurement stage interpretation. That workflow implementation was not changed by this task.
- Final build passed after the selected-supplier and compact-risk presentation changes. Logs: `scratch/ai-recommendation-build-final.log`, `scratch/ai-recommendation-final-tests.log`, and `scratch/ai-recommendation-full-tests.log`.

### Live read-only acceptance

The user signed in as Procurement Manager in the local preview. RFQ94 was opened against its existing ERPNext data; no supplier was selected or awarded, no auction was created and Claude was not rerun.

- Main RFQ card and procurement-status display show **AI top-ranked: Atlantic**.
- A full page refresh/re-fetch retained the same scores and risk/verdict guidance; the verified report was left open in the preview.
- Report hero and leaderboard show **91 / High Risk / AVOID / Requires review**, with no unqualified Recommended badge.
- FEMSA shows **87 / Low Risk / GOOD OPTION / USD 2,600**.
- Blue Ridge shows **85 / Medium Risk / GOOD OPTION / USD 2,500**.
- Each supplier's Details view retained its own scores, quote, risk, verdict and saved reasoning. Atlantic's explanation is labelled evaluation reasoning, not a strength.
- Executive summary uses those same supplier facts and explicitly describes the score ranking as distinct from an award recommendation.
- The viewed page and dialog each had client width and scroll width **647px**, with no horizontal overflow.
- Browser diagnostics showed an existing `Supplier RFQ Response` HTTP 404; the report loaded successfully and no new module/runtime exception was observed. This task does not repair that unrelated endpoint.

The full original model response remains unavailable. The live check verifies correct rendering of the saved run; mocked gateway tests verify current raw-response validation and mapping without representing those fixtures as the historical Claude response.

Read-only evidence collection completed:

- `scratch/ai-recommendation-PUR-RFQ-2026-00094-SCORE-PUR-RFQ-2026-00094-00120.json`: original ERP scoring document and parsed snapshot.
- `scratch/ai-risk-atlantic-evidence.json`: exact PO, receipt, invoice and quotation evidence fetched at 2026-09-23T06:12:10.602Z.
- `scratch/ai-risk-atlantic-findings.md`: bounded evidence audit and interpretation limits.

The inspected source documents' modification dates precede the saved scoring run. Evidence collection used GET requests only, wrote local diagnostic artifacts, and made no ERPNext business-record changes.
