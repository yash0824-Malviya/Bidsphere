# Initial RFQ Contract Request schema prerequisite

**Applied and verified on 24 September 2026 after explicit user approval.**
The exact seven-field REST configuration succeeded; the subsequent check
returned no pending operations. Backup and result:
`scratch/rfq-clm-initial-request-schema-2026-09-24T07-43-17-902Z/`.
See [live Request/queue verification](rfq-contract-request-live-verification-2026-09-24.md).

## Why the existing schema needs a change

The existing ERPNext `Contract Request` is a custom DocType with supplier, contract type, dates and values marked mandatory. Those facts may not exist when an RFQ is created. An initial RFQ request must leave unknown facts unset; it must not manufacture a supplier, contract type, dates or an award value.

The plan updates only these existing Request fields:

- `contract_type`
- `supplier`
- `contract_start_date`
- `contract_end_date`
- `contract_value`
- `estimated_contract_value`
- `currency`

Each receives `reqd = 0` plus a Desk `mandatory_depends_on` expression. The expression exempts only an explicitly marked initial RFQ request with `rfq_source.stage = rfq_created`, `rfq_source.prepared` not true, matching RFQ, Contract Required true, no award/quotation/Contract, and the exact persisted pending Procurement Team assignment. Malformed, legacy, standalone, prepared or award-linked requests remain mandatory in Desk.

`department`, `requester`, `request_date`, `company`, `contract_purpose` and `description` remain mandatory in the existing ERP schema. Department is required by the initial-request business rule and must be resolved from the RFQ or its Material Request. Initial Contract Purpose and Description do not require user-entered contract terms: the gateway truthfully populates them from the RFQ reference and scope. Their existing ERP requirements therefore do not block an initial Request, and this patch leaves them unchanged. All standard `Contract` fields, roles, permissions, workflows, existing business records, defaults and Select options remain unchanged. No fields or DocTypes are created.

## Native REST validation limitation

**This condition is not conditional validation in the ERP server.** Frappe 16's server mandatory check examines `reqd`; its Desk JavaScript evaluates `mandatory_depends_on`. Direct ERP REST callers therefore gain optional access to these seven Request fields after this change. BidSphere's gateway must separately require the complete existing fields for standalone Request saves/submissions and award-to-Contract conversion before the change is applied. The actual standard Contract requirements remain intact.

Primary source: [Frappe server mandatory validation](https://github.com/frappe/frappe/blob/version-16/frappe/model/base_document.py), [Desk dependency evaluation](https://github.com/frappe/frappe/blob/version-16/frappe/public/js/frappe/form/layout.js).

The gateway must send explicit empty strings for unknown Select/Link fields. Omitting a Select value can cause Frappe to choose its first option; this must not turn an unknown contract type into Supplier Agreement or an unknown currency into USD. Frappe stores unset numeric Currency values as zero; the persisted initial-request marker must keep the application from presenting this as an awarded value. [Frappe defaults](https://github.com/frappe/frappe/blob/version-16/frappe/model/create_new.py).

## Review and apply

From the project directory, inspect the current site without writing:

```powershell
node scripts/setup-rfq-clm-initial-request.mjs --check
```

Only after reviewing this limitation, deploying the accompanying gateway validation and receiving the required production approval:

```powershell
node scripts/setup-rfq-clm-initial-request.mjs --apply --gateway-validation-confirmed
```

The runner uses the configured ERP integration account. It saves complete before/after evidence under `scratch/rfq-clm-initial-request-schema-<timestamp>/`, rechecks for concurrent changes before writing, saves the existing custom Request DocType once using `frappe.client.save`, then verifies the exact seven-field change and preservation of required Department, records/workflows/permissions. A repeated run is a no-op. It does not use SSH, Bench, an app installation or validation bypass flags.

## Local verification

```powershell
npx vitest run scripts/rfq-clm-initial-request-schema.test.mjs
```

43 tests passed: narrow marker matching, invalid/standalone/prepared/award-stage non-exemption, exact seven-field plan, required Department preservation, read-only default, backup enforcement, explicit validation acknowledgement, idempotency, concurrency refusal, real error propagation and preservation checks.
