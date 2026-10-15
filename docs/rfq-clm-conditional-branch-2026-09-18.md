# RFQ → CLM conditional branch

## Status

Implementation and local regression checks are complete. **ERP deployment and live acceptance are still pending.** No live RFQ, award, quotation, contract, signature, PO, schema or role was changed during this task.

The read-only check at **2026-09-18 16:01 IST** found Frappe 16.20.0 / ERPNext 16.22.0, Server Scripts disabled, and no installed `bidsphere_workflows` app. The attempted read of its method reported that the app is not installed. See [deployment evidence](../erpnext_apps/bidsphere_workflows/audit/read-only-preflight-2026-09-18.json).

## Root cause

The existing RFQ `contract_required` Yes/No field was an initial preference. The CLM panel separately offered Create Contract Request only for Yes. Neither the RFQ workflow derivation nor the PO guard consumed CLM execution, so the RFQ could continue regardless of that flag. The existing REST adapter also could not update the RFQ and insert a Contract Request in one transaction.

## Changes

- The awarded RFQ now presents **Yes — Create CLM** and **No — No Contract**. An initial creation preference is distinguished from a recorded award decision.
- Yes reuses the existing mandatory Contract Request form. Its save calls one secured ERP transaction, creates or retrieves one request, records the decision, and opens the existing CLM route.
- No records the decision without creating a request or contract. Decision buttons disappear after either saved choice.
- Decisions are saved in the existing RFQ `custom_approval_data.contract_decision`, alongside `contract_required`. Existing RFQ state fields are preserved. The existing RFQ timeline derives its conditional Contract Decision/CLM stages from saved evidence and the linked CLM status.
- The existing unique Contract Request RFQ link and an RFQ database row lock prevent duplicate creation. ERP exceptions roll back request insertion and the RFQ update together. The API does not fall back to separate writes when the extension is absent.
- Business Case, ECR when applicable, RFQ, award/review, quotation and exact Supplier identities are verified and retained in the existing `custom_clm_data.rfq_source`. Source evidence survives request-to-contract conversion and appears in CLM traceability.
- Both Node gateways and the ERP extension prevent direct decision tampering and premature RFQ completion/PO continuation. Yes requires the matching Executed/Active CLM, approved route, unchanged approved content and both signatures. Existing RFQ Legal/signature/Finance checks remain additional requirements.
- Existing completed POs without a contract decision retain their established edit behavior only after the server verifies that no conflicting CLM exists. Existing audited RFQ-linked CLM requests remain usable.
- Existing CLM review, e-signature and Procurement notification logic is reused. No new roles, DocTypes, RFQ workflow statuses or replacement CLM system were introduced.

## Deployment

Install the packaged Frappe extension using its [deployment instructions](../erpnext_apps/bidsphere_workflows/README.md). The package includes a checked local-source installation route and a read-only-first Bench registration helper.

After the extension is installed and its existing ERP gateway identity is configured, run the narrow schema check/apply from this repository:

```sh
node scripts/setup-rfq-clm-branch.mjs --check
node scripts/setup-rfq-clm-branch.mjs --apply
```

The inspected schema requires exactly one adjustment: `Request for Quotation.contract_required.allow_on_submit = 1`, so the decision can be saved after award on a submitted RFQ. No record migration, default change, duplicate field, role or permission change is planned. The script backs up and compares records, schema, workflows and permissions.

## Verification

- Final production build: **passed** (`scratch/rfq-clm-branch-final-build.log`).
- Full application suite: **2,224 passed, 4 failed, 3 skipped** out of 2,231 (`scratch/rfq-clm-branch-final-tests.json`). All four failures are the previously observed `src/api/approvalWorkflow.test.ts` baseline: blank Finance status, Legal/Finance queue split, unverified legacy approval, and Finance-to-Procurement handoff. This task does not change that policy.
- Focused checks cover pending/Yes/No routing, exact source links, rollback, duplicate/concurrent conflicting decisions, missing deployment, permission denial, generic proxy bypass, required signatures, PO holds, historical records, and approval-state decision preservation.
- A fixture-backed integration test runs the existing request submit/approve → Contract authoring → assigned Legal approval → supplier signature → internal signature → Executed sequence. It proves the CLM hold remains before execution and releases afterwards; signature providers and persistence are test doubles, not live legal signatures.
- ERP extension: **33 portable Python tests passed**, including whole-request rollback, modeled row serialization, readback failure and native document guards (`scratch/rfq-clm-branch-python-tests.log`). These do not prove live MariaDB behavior.
- Narrow schema planner: **4 tests passed** (`scratch/rfq-clm-branch-schema-tests.log`).
- The browser preview remains signed out at `/supplier/login`; authenticated RFQ UI actions were not performed. Source/layout checks retain wrapped controls, constrained modal width and existing internal table scrolling.

## Remaining acceptance

ERP host access or an administrator installation is required. After deployment, verify authorized test RFQs through Yes and No, duplicate retries, actual ERP readback and rollback, the existing assigned CLM review/signature process, and existing Legal/Finance/PO continuation. Those live outcomes are **not yet verified**. The extension README provides the detailed sequence.
