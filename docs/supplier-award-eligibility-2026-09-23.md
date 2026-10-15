# Supplier award eligibility — RFQ94

## Business rule

This change implements the user's explicit follow-up policy: **AVOID is not award eligible**, regardless of AI score or rank. It supersedes the earlier presentation-only interpretation documented in `ai-recommendation-consistency-2026-09-23.md`.

| Supplier | Score | Rank | Risk | Verdict | Award eligible |
| --- | ---: | ---: | --- | --- | --- |
| Atlantic Precision Manufacturing. | 91 | 1 | High | AVOID | No |
| FEMSA | 87 | 2 | Low | GOOD OPTION | Yes, subject to existing approvals |
| Blue Ridge Manufacturing Inc | 85 | 3 | Medium | GOOD OPTION | Yes, subject to existing approvals |

The scoring formula, dimension values, ordering and saved model assessments remain unchanged. No alternative supplier is promoted to rank one. No risk-override workflow exists or was introduced. High risk without AVOID remains subject to the existing review policy; no separate High-only veto was found in the authoritative application rules.

## Implementation

- `src/utils/supplierAwardEligibility.ts` defines the shared rule. It ignores caller-supplied eligibility flags and rejects AVOID or incomplete/unavailable assessments.
- The canonical evaluation projection adds `awardEligible` and `awardIneligibilityReason`. The executive summary states that Atlantic is the numerical leader and is ineligible for supplier selection, reverse bidding and PO creation.
- The leaderboard retains Atlantic, its score, rank, risk, verdict and Details action. Its checkbox and selection/PO actions are disabled with: “Supplier is currently marked AVOID due to high risk and cannot be selected for award.”
- Reverse-bidding counts and selections use only eligible current quotation identities. Handlers recheck stale selected IDs, and service preflights re-fetch the saved evaluation before mutations.
- Client PO paths require a submitted quotation linked to the correct RFQ and supplier. An unrelated supplier's quoted price cannot substitute for a missing winning quotation.

## Authoritative backend enforcement

`api/supplierAwardEligibilityGuard.ts` reads ERPNext itself: RFQ, submitted Supplier Quotation and the latest Supplier Scoring Result, ordered consistently with the report. It matches exact RFQ/supplier/quotation/run identities. Choosing an older quotation cannot hide the same supplier's active AVOID verdict.

The guard is wired into both application gateways (`api/proxy.ts` and Vite), Legal review creation as the supplier-award entry, and RFQ-linked PO creation/submission. It covers supported generic Frappe mutations as well as resource writes, including GET-based mutation RPCs, stale auction activation/winner approval and PO submission without posted `docstatus`. Replacing an existing PO's supplier or quotation also rechecks eligibility. Direct child writes cannot bypass the parent checks.

Client fields such as `awardEligible: true` or `verdict: "BEST VALUE"` are not evidence. Lookup errors, conflicting identities and existing malformed/stale evaluations block the operation. A successful empty scoring-result lookup preserves established legacy manual workflows; it is not used as a fallback when lookup fails.

Existing authorization, quotation membership, CLM, Legal, e-signature, Finance and Procurement approval gates remain in force. Passing eligibility alone does not authorize a PO. Read/cancel actions and unchanged historical record edits retain their existing handling.

This is application-backend enforcement. No ERPNext app deployment, database schema change or business-record migration was performed.

## Verification

- A live **read-only** ERPNext-backed probe for RFQ `PUR-RFQ-2026-00094` rejected Atlantic quotation `PUR-SQTN-2026-00265` with a 403-class AVOID error. FEMSA `00267` and Blue Ridge `00269` passed eligibility.
- The same generic reverse-bidding request guard rejected Atlantic + FEMSA and accepted FEMSA + Blue Ridge for eligibility checks. These validation functions made GET requests only; no request was forwarded to create an auction, award or PO.
- The signed-in preview showed Atlantic's checkbox disabled, FEMSA and Blue Ridge enabled, Atlantic still at 91/#1 and the eligible supplier count at two.
- Automated checks cover forged flags, stale quotations and runs, missing/malformed evaluations, selection identity, disabled controls, existing approval gates, PO creation, submission RPCs and replacement quotations.

### Final results

- **337 targeted tests passed across 21 files**, covering shared policy/projection, score preservation, client preflights, stale reverse-bidding selections, UI controls, backend mutation guards, PO, Legal and existing contract metadata behavior.
- **Production TypeScript/Vite build passed**. Existing bundle-size warnings remain.
- The broader run completed with **2,613 passed, 5 failed and 4 skipped**. Four failures are the previously existing `src/api/approvalWorkflow.test.ts` stage assertions. The fifth was an outdated proxy fixture that assumed the first ERP request was a PUT; it was updated to supply the new authoritative eligibility reads, and the affected suite passed in the final targeted run. No approval-workflow implementation was changed to resolve those unrelated failures.
- The live preview verified **2 of 2 selected** for FEMSA + Blue Ridge and an enabled Start Reverse Bidding action for that eligible pair. Atlantic's checkbox stayed disabled. The test selections were then cleared; no auction was started.
- Atlantic's Details opened successfully while **Select Supplier** and its leader-targeted **Create Purchase Order** action remained disabled. Its 91/#1/High/AVOID values remained visible. The final report was left open with no selection.
- Page client width and scroll width were both **647px**, with no horizontal overflow.

Logs: `scratch/supplier-award-targeted-tests.log`, `scratch/supplier-award-full-tests.log`, `scratch/supplier-award-build.log`.

Read-only evidence: `scratch/supplier-award-eligibility-live.json`. Repeatable opt-in probe: `api/supplierAwardEligibility.live.test.ts` (`RUN_LIVE_AWARD_ELIGIBILITY=1`). Normal test runs skip it.
