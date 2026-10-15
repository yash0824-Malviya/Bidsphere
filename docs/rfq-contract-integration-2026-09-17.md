# RFQ → Contract Request integration

## Scope and schema audit

This adds optional contract initiation after the existing RFQ supplier selection. RFQ creation, quotations, evaluation, AI recommendation, award, Legal/Finance review and PO transitions retain their existing handlers. Contract Requests continue through the existing CLM action engine and dynamic approval matrix.

The live audit found no equivalent RFQ contract-requirement field. Contract Request already had `custom_rfq`, `custom_supplier_quotation`, `custom_purchase_order`, `custom_project`, `custom_business_unit`, supplier, value, currency and contract type. Those fields are reused.

Applied with `node scripts/setup-rfq-contract.mjs --apply`:

- RFQ Custom Field `contract_required`: Select `Yes` / `No`, default `No`, mandatory.
- Unique constraint on the existing optional `Contract Request.custom_rfq` link. No duplicate source field or DocType.

The migration backed up full schemas and records to `scratch/rfq-contract-migration-2026-09-17T10-09-47-723Z/`. Verification preserved all 87 existing RFQs, their original timestamps/data, five workflows, roles and permissions. The new column reads `No` for every existing RFQ. The second migration plan contained no operations.

The migration discovers equivalent field names and refuses ambiguous/incompatible definitions. This deployment resolved canonical bindings `contract_required` and `custom_rfq`; a different deployment must review noncanonical bindings before deploying the corresponding application mapping. It refuses duplicate existing RFQ source links instead of deleting or rewriting data.

Frappe normalizes empty unique field values to SQL NULL when saving, allowing multiple standalone requests without an RFQ. This is implemented in [Frappe's document serialization](https://github.com/frappe/frappe/blob/version-15/frappe/model/base_document.py). Existing stored duplicate blanks are checked before adding the index.

## Behavior

- New RFQ's final review step has a compact Yes/No section, default No.
- Both direct and Material Request creation save the choice in the initial ERP document, then re-fetch and verify it.
- A failed verification read returns the saved RFQ plus a frontend-only warning. Existing target-price/cost-breakdown writes and Business Intake source linkage still finish. New RFQ shows the warning and opens the existing record instead of encouraging another create attempt.
- Existing gateway permissions remain in place. RFQ metadata accepts exact Yes/No; omitted new values default No. Partial workflow updates do not reset a previously saved Yes.
- No Contract or Contract Request is created during RFQ creation.
- The RFQ detail page displays a server-derived CLM summary. Missing/legacy values mean No / Not Required.
- Only existing RFQ managers (Procurement Manager and Administrator) can initiate from an eligible saved award. Supplier users cannot access these controls.
- The existing Contract Request schema requires information that RFQs do not reliably supply, including department, contract type, purpose and dates. The creation dialog pre-fills verified award data and asks for missing details without inventing values or weakening validation.
- Supplier, quotation, award value, currency and source references come from persisted server data. Source attachment references retain their original authorization and are not copied into misleading Contract Request attachment fields.
- Database uniqueness, existing-request lookup and uncertain-response recovery prevent duplicate Contract Requests. Existing requests are returned without overwriting manually entered data.
- Mapped source fields are protected against later detachment or substitution. Project and Business Unit supplied manually remain editable. The existing RFQ source picker opens the secured RFQ action for Contract Requests; standalone requests and other source types retain their authoring flows.
- Refresh award lets the user recover from a stale source revision without losing entered request details. Creation errors are logged server-side with safe status/category information.
- Contract status is derived from the linked Request/Contract; no additional RFQ contract lifecycle is stored.

## Deployment

Run the read-only check first:

```powershell
node scripts/setup-rfq-contract.mjs --check
```

Apply the reviewed additive plan before deploying application changes:

```powershell
node scripts/setup-rfq-contract.mjs --apply
```

Creation fails clearly if the required unique source constraint has not been applied. No approval matrix rows, roles, workflow states or business records are created by this setup script.

## Verification

Automated coverage includes both initial-save paths, exact Yes/No/default values, source linkage and UOM/target-price preservation, unavailable verification reads, No/legacy/pre-award gating, all existing roles, quoted Supplier DocNames, inactive/foreign quotation rounds, negotiated and zero awards, missing required fields, forged source/runtime fields, concurrent creation, response lost after commit, unchanged existing drafts, audit readback, source permissions, dynamic CLM status and the existing CLM authoring providers.

Live checks:

- Actual New RFQ completed all four form steps through final review. Default No and Yes helper text were checked. The review retained Cold Rolled Steel 10 / DIR-STE-020, Qty 20, Kg, Target Price 100, Show to Supplier Yes and two selected suppliers. No RFQ was submitted during this UI check.
- Existing `PUR-RFQ-2026-00089` displays No / Not Required and has no Contract Request creation action. Both checked pages had document scroll width equal to viewport width (1280 px).
- Two read-only ERP integration checks passed. One checked the real legacy RFQ summary; the other exercised eligibility using an in-memory Yes value while reading the actual saved award, Supplier, quotation `PUR-SQTN-2026-00249`, award value 2500 USD, PO `PUR-ORD-2026-00027`, mandatory request fields and source attachment references. The live RFQ remained No.
- Final schema check returned an empty operation list.
- The live RFQ-sourced New Contract Request page correctly offers Open RFQ and omits the generic save form. The original user contract form was preserved; the temporary verification tab was closed.

Live verification was read-only apart from the audited schema migration. New award/Contract Request writes and concurrency were tested with isolated automated fixtures, not by awarding a live RFQ or inventing real contract terms.

Existing console diagnostics were observed for optional `Supplier RFQ Response` and `Item-custom_part_name` schema lookups. No new CLM request or module error was observed in the live RFQ summary.

Final validation:

- `npm run build`: passed (existing bundle-size/config warnings remain).
- `npm test -- --maxWorkers=4 --reporter=json --outputFile=scratch/rfq-clm-final-tests.json`: 1,964 passed / 1,968 total.
- The remaining four failures are the same baseline failures in `src/api/approvalWorkflow.test.ts` (existing RFQ signature/Finance/Procurement handoff expectations). Those unrelated workflow implementations and tests were not changed by this integration. No new test failures remain.
- `npx vitest run --config scratch/rfq-clm-live.vitest.mjs`: two read-only integration checks passed.
- `node scripts/setup-rfq-contract.mjs --check`: no operations pending.
