# RFQ CLM extension deployment check — 2026-09-21

## Confirmed live blocker

The configured remote ERPNext site returned HTTP 417 from
`bidsphere_workflows.rfq_clm.decide`: **App bidsphere_workflows is not installed**.
Installed Applications independently lists only Frappe 16.20.0 and ERPNext
16.22.0. This is an actual missing deployment, not a frontend error.

RFQ `PUR-RFQ-2026-00093` remains Submitted. No linked Contract Request or Contract
exists, and no saved contract decision has advanced it. All checks in this
follow-up were read-only.

## Access investigation

- No Windows SSH configuration or existing remote deployment connection was found.
- Local Docker has no running engine.
- Ubuntu contains `/home/victus/frappe-bench`, but this is a separate Frappe
  15.100.1 / ERPNext 15.98.1 site named `erp.local`, configured for port 8000.
  Its local database is stopped. It is not the configured remote Frappe 16 site.
- The local site was not started, installed into or migrated.

Deployment needs the remote host's SSH/deployment connection, Bench path and
site name. ERP REST credentials do not provide a host shell or Python app
installation capability. The requested live Yes/No and signature acceptance
cannot run until that installation is completed.

## Permissions checked

The current ERP service identity is `Administrator`. Read/write checks for the
current RFQ and award, read/create/write checks for Contract Request and Contract,
and read/create checks for File all passed through `frappe.client.has_permission`.
No permissions or roles were changed. End-user action checks remain enforced by
the existing secured Node API. Gateway configuration on the actual Bench host
must match the existing API credential's identity.

Evidence: `scratch/rfq-extension-permission-audit.json` and the refreshed
`scratch/rfq-finalization-deployment-audit.json`.

## Implementation and error handling

The packaged extension contains the atomic real Contract Draft transaction,
rollback/idempotency checks, permanent source links, Legal/signature gate, and
RFQ/award lifecycle synchronization.

All twelve requested values use existing persisted fields:

| Value | Persisted location |
| --- | --- |
| RFQ, award, supplier, quotation identifiers | Contract native source links and `custom_clm_data.rfq_context` |
| Contract required | RFQ decision and Contract context |
| Contract type | `Contract.custom_contract_type` and context |
| Purpose | `Contract.custom_contract_title`; original Request `contract_purpose` |
| Description | `Contract.contract_terms`; original Request `description` |
| Start/end dates | `Contract.start_date` / `end_date` |
| CLM ID | Contract name, RFQ decision and RFQ/award lifecycle mirrors |
| CLM status | `Contract.custom_contract_status` and RFQ/award mirrors |

The transport error classifier was narrowed so genuine document-not-found,
validation, permission and internal dependency errors retain their backend
message/status. Actual missing app/module/transaction errors still block the
operation with the existing deployment message. No alternate writes or fake
success paths were added. All 16 focused transport tests passed.

Use `scratch/bidsphere_workflows-rfq-finalization-2026-09-21.zip` with
`erpnext_apps/bidsphere_workflows/README.md` once the correct host connection is
available. Installation, migration, cache clearing, worker restart and live
acceptance remain outstanding.
