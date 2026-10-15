# Contract Detail lifecycle visibility

## Scope and source of truth

Contract Detail now displays the existing RFQ-linked Contract lifecycle as a compact tracker. It reads `custom_clm_data.rfq_workflow.version = 1` and the saved `phase` through the existing workflow reader. Existing supported legacy status mappings remain available. Unknown and standalone workflows retain their existing presentation.

No backend transition, action permission, RFQ/PO gate, native Contract status, or persisted data is changed by this presentation.

| Saved phase | Current status shown | Stage | Responsibility | Next stage |
| --- | --- | --- | --- | --- |
| `draft` | Draft | Contract Preparation | Procurement Team | Legal Review |
| `legal_review` | Pending Legal Review | Legal Review | Legal Manager | E-Signature |
| `signature` | Pending Signatures | E-Signature | Legal Manager | Finance Approval |
| `finance_review` | Pending Finance Approval | Finance Approval | Finance Manager | Procurement Finalization |
| `procurement` | Pending Procurement Finalization | Procurement Finalization | Procurement Team | Completed |
| `completed` | Completed | Completed | None / Completed | None |

The first completed milestone is labelled Procurement Team Creation. These labels describe the existing stages; they do not add backend statuses. Finance/Procurement display labels are confined to Contract Detail so notification text and backend consumers of the existing reader remain unchanged.

## Display and refresh

- Completed stages have checkmarks; the current stage has a blue highlight and CURRENT badge; the immediate next stage has a NEXT badge.
- Every stage shows its responsible role. Current status, stage, responsibility and next status/stage are grouped above the tracker.
- Send-back resets progress from the saved Draft phase. Rejected, termination-review and terminal records do not promise an incorrect next stage.
- Native Active/Executed alone never means procurement is Completed.
- Active internal RFQ Contract details refresh every 15 seconds while visible and on focus. Successful local actions continue to use their returned persisted detail and cache invalidation.
- Authoring pauses automatic refresh and preserves entered terms and their original editing revision, keeping the existing stale-write validation effective.

## Files

- `src/utils/rfqClmWorkflow.ts`: detail-only lifecycle projection.
- `src/components/contracts/RfqContractWorkflow.tsx`: responsive lifecycle tracker.
- `src/components/contracts/ClmRecordWorkspace.tsx`: header status and active-record refresh.
- Regression coverage in `src/utils/rfqClmLifecycle.test.ts`, `src/components/contracts/RfqContractWorkflow.test.tsx`, `src/components/contracts/ClmRecordWorkspace.request.test.tsx`, and `src/components/contracts/clmSupplierHandoff.test.tsx`.

## Verification

- Model, rendering, backend Contract transition, notification, RFQ synchronization and PO guard suite: **249 passed, 0 failed** across 7 files. Report: `scratch/clm-lifecycle-regression-tests.json`.
- Contract components/pages suite: **186 passed, 0 failed** across 14 files. Includes refresh scope, late-read authoring protection, original editing revision, successful-save revision update, standalone behavior, and supplier handoff. Report: `scratch/clm-lifecycle-frontend-tests.json`.
- The two suites cover **424 distinct test names**, with overlapping lifecycle rendering coverage.
- Browser check used the real tracker with explicitly labelled isolated sample records: signatures, Finance, Procurement and Completed all showed the correct current/next state and roles.
- Desktop and 375px iframe layouts inspected. The narrow tracker had equal client/scroll width (348px), with no horizontal overflow. A fresh preview load produced no warning/error console entries.
- No live ERPNext Contract was advanced, signed or modified during these checks.

`npm run build` passed (TypeScript and Vite, exit 0). The build emitted native-config and bundle-size warnings; it reported no compilation errors. Log: `scratch/clm-lifecycle-build.log`.
